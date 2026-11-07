import { z } from 'zod';

import { createOpenAIService, type OpenAIService } from '@ai-video-factory/ai-content';

import {
  createFirestoreJobStore,
  type JobStatus,
  type JobStore,
  type PersistedJobContent,
  type StoredJob
} from './job-store.js';

export type { JobStatus, PersistedJobContent, StoredJob } from './job-store.js';

/**
 * Progress covers the content phase only (0-40). Voice, rendering and
 * publishing own the rest of the range when they are built.
 */
export const CONTENT_PROGRESS = {
  /** Set by the claim; the job is 'researching' from this point. */
  claimed: 5,
  scripting: 20,
  storyboarding: 30,
  content_ready: 40
} as const;

/**
 * A job that has sat in an in-flight status this long is treated as abandoned
 * (e.g. the process restarted). One stage can hold three OpenAI calls with
 * retries, so this is deliberately well above a normal whole-run time.
 */
export const STALE_JOB_MS = 30 * 60 * 1000;

export class JobValidationError extends Error {}
export class JobNotFoundError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} was not found.`);
  }
}
export class JobConflictError extends Error {
  constructor(jobId: string, public readonly status: JobStatus) {
    super(`Job ${jobId} cannot be started while it is '${status}'.`);
  }
}
export class ServiceConfigError extends Error {}

class ClaimLostError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} was taken over by another run.`);
  }
}

export function validateVerifiedUserId(userId?: string): string {
  const candidate = userId?.trim();
  if (!candidate || !/^[A-Za-z0-9_.:-]+$/.test(candidate)) {
    throw new Error('A valid verified Firebase UID is required for content generation.');
  }

  return candidate;
}

export function validateJobId(jobId: string): string {
  const candidate = jobId.trim();
  if (!candidate || !/^job-[A-Za-z0-9_.:-]+$/.test(candidate)) {
    throw new JobValidationError('Invalid jobId format.');
  }
  return candidate;
}

const JobRequestSchema = z.object({
  topic: z.string().trim().min(3, 'Topic must contain at least 3 characters.').max(300),
  title: z.string().trim().min(1).max(200).optional(),
  durationMinutes: z.coerce.number().int().min(1).max(30).default(5),
  targetAudience: z.string().trim().min(1).max(100).default('umum'),
  difficultyLevel: z.string().trim().min(1).max(100).default('dasar')
});

export function parseJobRequest(input: unknown) {
  const parsed = JobRequestSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
    throw new JobValidationError(detail);
  }
  return parsed.data;
}

export type ContentJobOutcome =
  | { ok: true; content: PersistedJobContent }
  | { ok: false; error: string };

type ContentOpenAI = Pick<
  OpenAIService,
  | 'analyzeTopic'
  | 'generateResearch'
  | 'generateScript'
  | 'generateCharacterBible'
  | 'generateStoryboard'
  | 'generateScenePrompts'
  | 'getUsage'
>;

export type ContentEngineDeps = {
  store: JobStore;
  /** One instance per job, so `getUsage()` reports that job's usage only. */
  createOpenAI: () => ContentOpenAI;
  now: () => number;
};

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown content generation error';
  return message.length > 300 ? `${message.slice(0, 297)}...` : message;
}

export function createContentEngine(overrides: Partial<ContentEngineDeps> = {}) {
  const deps: ContentEngineDeps = {
    store: overrides.store ?? createFirestoreJobStore(),
    createOpenAI: overrides.createOpenAI ?? createOpenAIService,
    now: overrides.now ?? Date.now
  };

  async function createJob(userId: string, request: unknown): Promise<StoredJob> {
    const verifiedUserId = validateVerifiedUserId(userId);
    const parsed = parseJobRequest(request);
    const now = deps.now();

    const job: StoredJob = {
      ...parsed,
      jobId: `job-${crypto.randomUUID()}`,
      userId: verifiedUserId,
      status: 'pending',
      progress: 0,
      error: null,
      createdAtMs: now,
      updatedAtMs: now
    };

    await deps.store.createJob(job);
    return job;
  }

  /** Returns the job only to its owner; anyone else gets the same error as for a missing job. */
  async function getJob(jobId: string, userId: string): Promise<StoredJob> {
    const id = validateJobId(jobId);
    const verifiedUserId = validateVerifiedUserId(userId);

    const job = await deps.store.getJob(id);
    if (!job || job.userId !== verifiedUserId) {
      throw new JobNotFoundError(id);
    }
    return job;
  }

  /**
   * Claims the job and starts generating its content in the background.
   * Resolves as soon as the claim succeeds; progress is tracked on the job
   * document. `onSettled` runs once the background run finishes either way.
   *
   * The run lives in this process. Durable state is in the store, so a crash
   * leaves the job in an in-flight status that becomes claimable again after
   * STALE_JOB_MS. Replace the `void run(...)` call below with a queue
   * (Cloud Tasks, BullMQ, ...) when jobs must survive restarts or be spread
   * across instances.
   */
  async function submitContentJob(
    input: { jobId: string; userId: string },
    onSettled?: (outcome: ContentJobOutcome) => void | Promise<void>
  ): Promise<StoredJob> {
    const jobId = validateJobId(input.jobId);
    const userId = validateVerifiedUserId(input.userId);

    // Fail before claiming anything if the generator cannot run at all.
    let openAI: ContentOpenAI;
    try {
      openAI = deps.createOpenAI();
    } catch (error) {
      throw new ServiceConfigError(describeError(error));
    }

    const claim = await deps.store.claimJob(jobId, userId, deps.now() - STALE_JOB_MS);
    if (claim.kind === 'not_found') {
      throw new JobNotFoundError(jobId);
    }
    if (claim.kind === 'conflict') {
      throw new JobConflictError(jobId, claim.status);
    }

    void run(claim.job, claim.runId, openAI)
      .then(async (outcome) => {
        await onSettled?.(outcome);
      })
      .catch((error) => {
        console.error(`Content job ${jobId} callback failed:`, describeError(error));
      });

    return claim.job;
  }

  async function run(job: StoredJob, runId: string, openAI: ContentOpenAI): Promise<ContentJobOutcome> {
    const { jobId, userId } = job;
    let progress: number = CONTENT_PROGRESS.claimed;

    const advance = async (status: JobStatus, nextProgress: number) => {
      progress = nextProgress;
      if (!(await deps.store.updateJob(jobId, runId, { status, progress }))) {
        throw new ClaimLostError(jobId);
      }
    };

    try {
      // The claim already moved the job to 'researching'.
      const topicAnalysis = await openAI.analyzeTopic({
        topic: job.topic,
        targetAudience: job.targetAudience,
        durationMinutes: job.durationMinutes,
        difficultyLevel: job.difficultyLevel
      });
      const research = await openAI.generateResearch({
        topic: job.topic,
        category: topicAnalysis.category,
        difficultyLevel: job.difficultyLevel
      });

      await advance('scripting', CONTENT_PROGRESS.scripting);
      const script = await openAI.generateScript({
        topic: job.topic,
        title: job.title ?? topicAnalysis.topicTitle,
        durationMinutes: job.durationMinutes,
        audience: topicAnalysis.targetAudience,
        researchSummary: research.summary
      });

      await advance('storyboarding', CONTENT_PROGRESS.storyboarding);
      const characterBible = await openAI.generateCharacterBible({
        topic: job.topic,
        title: job.title ?? topicAnalysis.topicTitle
      });
      const storyboard = await openAI.generateStoryboard({ topic: job.topic, script });
      const visualPrompts = await openAI.generateScenePrompts({ topic: job.topic, storyboard });

      const content: PersistedJobContent = {
        jobId,
        userId,
        topicAnalysis,
        research,
        script,
        characterBible,
        storyboard,
        visualPrompts
      };

      progress = CONTENT_PROGRESS.content_ready;
      const saved = await deps.store.saveContent(content, runId, {
        status: 'content_ready',
        progress: CONTENT_PROGRESS.content_ready
      });
      if (!saved) {
        throw new ClaimLostError(jobId);
      }

      return { ok: true, content };
    } catch (error) {
      const message = describeError(error);
      console.error(`Content job ${jobId} failed at ${progress}%:`, message);

      // A run that lost its claim must not write to a job another run now owns.
      if (!(error instanceof ClaimLostError)) {
        try {
          await deps.store.updateJob(jobId, runId, { status: 'failed', progress, error: message });
        } catch (updateError) {
          console.error(`Could not mark job ${jobId} as failed:`, describeError(updateError));
        }
      }

      return { ok: false, error: message };
    } finally {
      // Tokens are billed even when the run fails, so usage is always recorded.
      const usage = openAI.getUsage();
      if (usage.calls > 0) {
        try {
          await deps.store.addUsage(jobId, userId, usage);
        } catch (usageError) {
          console.error(`Could not record usage for job ${jobId}:`, describeError(usageError));
        }
      }
    }
  }

  return { createJob, getJob, submitContentJob };
}

let defaultEngine: ReturnType<typeof createContentEngine> | undefined;

/** Lazily built so importing this module never touches Firebase or OpenAI. */
export function getContentEngine() {
  defaultEngine ??= createContentEngine();
  return defaultEngine;
}
