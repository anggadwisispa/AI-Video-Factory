import { describe, expect, it, vi } from 'vitest';

import type { OpenAIUsage } from '@ai-video-factory/ai-content';

import {
  createContentEngine,
  JobConflictError,
  JobNotFoundError,
  JobValidationError,
  ServiceConfigError,
  STALE_JOB_MS,
  type ContentJobOutcome
} from './content-engine.js';
import type { ClaimResult, JobPatch, JobStatus, JobStore, PersistedJobContent, StoredJob } from './job-store.js';
import { IN_FLIGHT_STATUSES } from './job-store.js';

/** In-memory JobStore with the same claim / runId semantics as the Firestore one. */
function createMemoryStore() {
  const jobs = new Map<string, StoredJob & { runId?: string }>();
  const saved = new Map<string, PersistedJobContent>();
  const usage: Array<{ jobId: string; userId: string; usage: OpenAIUsage }> = [];
  const history: Array<{ jobId: string; status: JobStatus; progress: number }> = [];
  let tick = 1;

  const store: JobStore = {
    async createJob(job) {
      if (jobs.has(job.jobId)) throw new Error('ALREADY_EXISTS');
      jobs.set(job.jobId, { ...job });
    },
    async getJob(jobId) {
      return jobs.get(jobId) ?? null;
    },
    async claimJob(jobId, userId, staleBeforeMs): Promise<ClaimResult> {
      const job = jobs.get(jobId);
      if (!job || job.userId !== userId) return { kind: 'not_found' };
      const claimable =
        job.status === 'pending' ||
        job.status === 'failed' ||
        (IN_FLIGHT_STATUSES.has(job.status) && job.updatedAtMs < staleBeforeMs);
      if (!claimable) return { kind: 'conflict', status: job.status };

      job.status = 'researching';
      job.progress = 5;
      job.error = null;
      job.runId = `run-${tick++}`;
      history.push({ jobId, status: job.status, progress: job.progress });
      return { kind: 'claimed', job: { ...job }, runId: job.runId };
    },
    async updateJob(jobId, runId, patch: JobPatch) {
      const job = jobs.get(jobId);
      if (!job || job.runId !== runId) return false;
      job.status = patch.status;
      job.progress = patch.progress;
      job.error = patch.error ?? null;
      history.push({ jobId, status: patch.status, progress: patch.progress });
      return true;
    },
    async saveContent(content, runId, patch) {
      const job = jobs.get(content.jobId);
      if (!job || job.runId !== runId) return false;
      saved.set(content.jobId, content);
      job.status = patch.status;
      job.progress = patch.progress;
      history.push({ jobId: content.jobId, status: patch.status, progress: patch.progress });
      return true;
    },
    async addUsage(jobId, userId, u) {
      usage.push({ jobId, userId, usage: u });
    }
  };

  return { store, jobs, saved, usage, history };
}

function createFakeOpenAI(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const track = <T,>(name: string, value: T) => async () => {
    calls.push(name);
    return value;
  };

  const ai = {
    analyzeTopic: track('analyzeTopic', {
      topicTitle: 'Cara kerja jantung manusia',
      category: 'Biologi',
      learningObjectives: ['Memahami fungsi jantung'],
      targetAudience: 'pelajar SMA',
      keyConcepts: ['pompa darah'],
      recommendedDurationMinutes: 5,
      suggestedEducationalApproach: 'visual 3D'
    }),
    generateResearch: track('generateResearch', {
      topicTitle: 'Cara kerja jantung manusia',
      summary: 'Jantung memompa darah.',
      keyFacts: [],
      technicalConcepts: [],
      references: [],
      uncertainClaims: [],
      verificationNotes: 'ok'
    }),
    generateScript: track('generateScript', {
      title: 'Cara kerja jantung manusia',
      language: 'id',
      narrationSections: [],
      totalEstimatedDurationSeconds: 180,
      summary: 'Ringkasan'
    }),
    generateCharacterBible: track('generateCharacterBible', { projectTitle: 'Jantung', characters: [] }),
    generateStoryboard: track('generateStoryboard', { title: 'Jantung', totalDurationSeconds: 180, scenes: [] }),
    generateScenePrompts: track('generateScenePrompts', []),
    getUsage: (): OpenAIUsage => ({
      model: 'gpt-4o-mini',
      calls: calls.length,
      promptTokens: calls.length * 100,
      completionTokens: calls.length * 50,
      estimatedCostUsd: calls.length * 0.00001
    }),
    ...overrides
  };

  return { ai: ai as never, calls };
}

async function runToCompletion(
  submit: (cb: (o: ContentJobOutcome) => void) => Promise<unknown>
): Promise<ContentJobOutcome> {
  return new Promise((resolve, reject) => {
    submit(resolve).catch(reject);
  });
}

function setup(openAIOverrides: Record<string, unknown> = {}, now = () => 1_000_000) {
  const mem = createMemoryStore();
  const fake = createFakeOpenAI(openAIOverrides);
  const engine = createContentEngine({ store: mem.store, createOpenAI: () => fake.ai, now });
  return { ...mem, ...fake, engine };
}

describe('createJob', () => {
  it('stores a pending job with defaults and an id that is not time-based', async () => {
    const { engine, jobs } = setup();

    const a = await engine.createJob('user-1', { topic: 'Cara kerja jantung manusia' });
    const b = await engine.createJob('user-1', { topic: 'Cara kerja jantung manusia' });

    expect(a.status).toBe('pending');
    expect(a.progress).toBe(0);
    expect(a.durationMinutes).toBe(5);
    expect(a.targetAudience).toBe('umum');
    expect(a.jobId).not.toBe(b.jobId);
    expect(jobs.get(a.jobId)?.userId).toBe('user-1');
  });

  it.each([
    ['too short a topic', { topic: 'ab' }],
    ['missing topic', {}],
    ['zero duration', { topic: 'Jantung', durationMinutes: 0 }],
    ['huge duration', { topic: 'Jantung', durationMinutes: 999 }],
    ['non-numeric duration', { topic: 'Jantung', durationMinutes: 'abc' }]
  ])('rejects %s', async (_label, body) => {
    const { engine, jobs } = setup();
    await expect(engine.createJob('user-1', body)).rejects.toBeInstanceOf(JobValidationError);
    expect(jobs.size).toBe(0);
  });

  it('rejects an invalid user identity', async () => {
    const { engine } = setup();
    await expect(engine.createJob('   ', { topic: 'Jantung' })).rejects.toThrow('A valid verified Firebase UID is required');
  });
});

describe('submitContentJob', () => {
  it('returns right after the claim, then walks the job through its stages to content_ready', async () => {
    const { engine, history, saved, usage, calls } = setup();
    const job = await engine.createJob('user-1', { topic: 'Cara kerja jantung manusia' });

    let outcome: ContentJobOutcome | undefined;
    const claimed = await engine.submitContentJob({ jobId: job.jobId, userId: 'user-1' }, (o) => {
      outcome = o;
    });

    expect(claimed.status).toBe('researching');
    expect(outcome).toBeUndefined(); // not finished when the call returns

    await vi.waitFor(() => expect(outcome).toBeDefined());
    expect(outcome?.ok).toBe(true);

    expect(history.map((h) => h.status)).toEqual(['researching', 'scripting', 'storyboarding', 'content_ready']);
    expect(history.map((h) => h.progress)).toEqual([5, 20, 30, 40]);
    expect(saved.get(job.jobId)?.userId).toBe('user-1');
    expect(calls).toEqual([
      'analyzeTopic',
      'generateResearch',
      'generateScript',
      'generateCharacterBible',
      'generateStoryboard',
      'generateScenePrompts'
    ]);
    expect(usage).toHaveLength(1);
    expect(usage[0].usage.promptTokens).toBe(600);
  });

  it('marks the job failed with the error, keeps progress, and still records the tokens it spent', async () => {
    const { engine, jobs, usage, saved } = setup({
      generateScript: async () => {
        throw new Error('OpenAI request failed: boom');
      }
    });
    const job = await engine.createJob('user-1', { topic: 'Cara kerja jantung manusia' });

    const outcome = await runToCompletion((cb) => engine.submitContentJob({ jobId: job.jobId, userId: 'user-1' }, cb));

    expect(outcome).toEqual({ ok: false, error: 'OpenAI request failed: boom' });
    expect(jobs.get(job.jobId)).toMatchObject({ status: 'failed', error: 'OpenAI request failed: boom', progress: 20 });
    expect(saved.has(job.jobId)).toBe(false);
    expect(usage).toHaveLength(1);
  });

  it('lets a failed job be started again', async () => {
    const mem = createMemoryStore();
    let failScript = true;
    const fake = createFakeOpenAI({
      generateScript: async () => {
        if (failScript) throw new Error('first attempt fails');
        return { title: 'T', language: 'id', narrationSections: [], totalEstimatedDurationSeconds: 60, summary: 's' };
      }
    });
    const engine = createContentEngine({ store: mem.store, createOpenAI: () => fake.ai, now: () => 1 });
    const job = await engine.createJob('user-1', { topic: 'Jantung manusia' });

    const first = await runToCompletion((cb) => engine.submitContentJob({ jobId: job.jobId, userId: 'user-1' }, cb));
    expect(first.ok).toBe(false);

    failScript = false;
    const second = await runToCompletion((cb) => engine.submitContentJob({ jobId: job.jobId, userId: 'user-1' }, cb));
    expect(second.ok).toBe(true);
    expect(mem.jobs.get(job.jobId)).toMatchObject({ status: 'content_ready', error: null });
  });

  it('treats another user\'s job exactly like a missing one and never calls OpenAI', async () => {
    const { engine, calls, jobs } = setup();
    const job = await engine.createJob('owner', { topic: 'Cara kerja jantung manusia' });

    await expect(engine.submitContentJob({ jobId: job.jobId, userId: 'intruder' })).rejects.toBeInstanceOf(JobNotFoundError);
    await expect(engine.submitContentJob({ jobId: 'job-does-not-exist', userId: 'owner' })).rejects.toBeInstanceOf(JobNotFoundError);

    expect(calls).toEqual([]);
    expect(jobs.get(job.jobId)).toMatchObject({ userId: 'owner', status: 'pending' });
  });

  it('rejects a job that is already running or finished', async () => {
    const { engine, jobs } = setup();
    const job = await engine.createJob('user-1', { topic: 'Cara kerja jantung manusia' });

    for (const status of ['researching', 'scripting', 'content_ready', 'rendering'] as const) {
      jobs.get(job.jobId)!.status = status;
      jobs.get(job.jobId)!.updatedAtMs = 1_000_000;
      await expect(engine.submitContentJob({ jobId: job.jobId, userId: 'user-1' })).rejects.toBeInstanceOf(JobConflictError);
    }
  });

  it('takes over a job abandoned in flight after STALE_JOB_MS, but not before', async () => {
    let clock = 10_000_000;
    const { engine, jobs } = setup({}, () => clock);
    const job = await engine.createJob('user-1', { topic: 'Cara kerja jantung manusia' });
    Object.assign(jobs.get(job.jobId)!, { status: 'storyboarding', updatedAtMs: clock });

    clock += STALE_JOB_MS - 1000;
    await expect(engine.submitContentJob({ jobId: job.jobId, userId: 'user-1' })).rejects.toBeInstanceOf(JobConflictError);

    clock += 2000;
    const outcome = await runToCompletion((cb) => engine.submitContentJob({ jobId: job.jobId, userId: 'user-1' }, cb));
    expect(outcome.ok).toBe(true);
  });

  it('fails fast without touching the job when OpenAI is not configured', async () => {
    const mem = createMemoryStore();
    const engine = createContentEngine({
      store: mem.store,
      createOpenAI: () => {
        throw new Error('OPENAI_API_KEY is not configured.');
      }
    });
    const job = await engine.createJob('user-1', { topic: 'Cara kerja jantung manusia' });

    await expect(engine.submitContentJob({ jobId: job.jobId, userId: 'user-1' })).rejects.toBeInstanceOf(ServiceConfigError);
    expect(mem.jobs.get(job.jobId)?.status).toBe('pending');
  });

  it('a run that lost its claim does not overwrite the run that replaced it', async () => {
    const mem = createMemoryStore();
    let stolen = false;
    const fake = createFakeOpenAI({
      generateScript: async () => {
        // Simulate another instance taking the job over while this run is mid-flight.
        const job = [...mem.jobs.values()][0];
        job.runId = 'someone-else';
        job.status = 'researching';
        stolen = true;
        return { title: 'T', language: 'id', narrationSections: [], totalEstimatedDurationSeconds: 60, summary: 's' };
      }
    });
    const engine = createContentEngine({ store: mem.store, createOpenAI: () => fake.ai, now: () => 1 });
    const job = await engine.createJob('user-1', { topic: 'Jantung manusia' });

    const outcome = await runToCompletion((cb) => engine.submitContentJob({ jobId: job.jobId, userId: 'user-1' }, cb));

    expect(stolen).toBe(true);
    expect(outcome.ok).toBe(false);
    expect(mem.jobs.get(job.jobId)).toMatchObject({ runId: 'someone-else', status: 'researching' });
    expect(mem.saved.has(job.jobId)).toBe(false);
  });
});

describe('getJob', () => {
  it('returns the job to its owner only', async () => {
    const { engine } = setup();
    const job = await engine.createJob('owner', { topic: 'Cara kerja jantung manusia' });

    await expect(engine.getJob(job.jobId, 'owner')).resolves.toMatchObject({ jobId: job.jobId });
    await expect(engine.getJob(job.jobId, 'intruder')).rejects.toBeInstanceOf(JobNotFoundError);
  });
});
