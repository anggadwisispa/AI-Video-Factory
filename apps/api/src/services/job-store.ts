import { FieldValue, getFirestore, Timestamp, type DocumentData, type Firestore } from 'firebase-admin/firestore';

import type {
  CharacterBibleEntry,
  GeneratedScript,
  OpenAIUsage,
  ResearchReport,
  ScenePromptItem,
  Storyboard,
  TopicAnalysis
} from '@ai-video-factory/ai-content';

import { initializeFirebase } from '../lib/firebase.js';

export type JobStatus =
  | 'pending'
  | 'researching'
  | 'scripting'
  | 'storyboarding'
  /** Phase 2 output (research, script, storyboard, characters, prompts) is saved. */
  | 'content_ready'
  | 'generating_characters'
  | 'generating_scenes'
  | 'generating_voice'
  | 'rendering'
  | 'quality_check'
  | 'completed'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled';

/** Statuses a content run moves through while it is actively working. */
export const IN_FLIGHT_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'researching',
  'scripting',
  'storyboarding'
]);

export type JobRequest = {
  topic: string;
  title?: string;
  durationMinutes: number;
  targetAudience: string;
  difficultyLevel: string;
};

export type StoredJob = JobRequest & {
  jobId: string;
  userId: string;
  status: JobStatus;
  progress: number;
  error: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type PersistedJobContent = {
  jobId: string;
  userId: string;
  topicAnalysis: TopicAnalysis;
  research: ResearchReport;
  script: GeneratedScript;
  characterBible: { projectTitle: string; characters: CharacterBibleEntry[] };
  storyboard: Storyboard;
  visualPrompts: ScenePromptItem[];
};

export type ClaimResult =
  | { kind: 'claimed'; job: StoredJob; runId: string }
  | { kind: 'not_found' }
  | { kind: 'conflict'; status: JobStatus };

export type JobPatch = { status: JobStatus; progress: number; error?: string | null };

/**
 * Persistence boundary for jobs. The Firestore implementation is the default;
 * tests use an in-memory one. Every write after `claimJob` carries the `runId`
 * returned by the claim, so a run that lost its claim (stale takeover) cannot
 * overwrite the run that replaced it.
 */
export interface JobStore {
  /** Fails if a job with this id already exists. */
  createJob(job: StoredJob): Promise<void>;
  getJob(jobId: string): Promise<StoredJob | null>;
  /**
   * Atomically moves a job owned by `userId` into 'researching' when it is
   * pending, failed, or has been in flight since before `staleBeforeMs`.
   */
  claimJob(jobId: string, userId: string, staleBeforeMs: number): Promise<ClaimResult>;
  /** Returns false when `runId` no longer owns the job (nothing was written). */
  updateJob(jobId: string, runId: string, patch: JobPatch): Promise<boolean>;
  /** Writes research, script, storyboard, scenes and characters, and marks the job content_ready, in one batch. */
  saveContent(content: PersistedJobContent, runId: string, patch: JobPatch): Promise<boolean>;
  /** Adds to the job's running usage totals; safe to call after a failed run. */
  addUsage(jobId: string, userId: string, usage: OpenAIUsage): Promise<void>;
}

const JOBS = 'video_jobs';

function firestore(): Firestore {
  const state = initializeFirebase();
  if (!state.initialized || !state.app) {
    throw new Error(state.reason ?? 'Firebase is not configured.');
  }
  return getFirestore(state.app);
}

function toStoredJob(data: DocumentData): StoredJob {
  return {
    jobId: data.jobId,
    userId: data.userId,
    topic: data.topic,
    title: data.title ?? undefined,
    durationMinutes: data.durationMinutes,
    targetAudience: data.targetAudience,
    difficultyLevel: data.difficultyLevel,
    status: data.status,
    progress: data.progress ?? 0,
    error: data.error ?? null,
    createdAtMs: (data.createdAt as Timestamp).toMillis(),
    updatedAtMs: (data.updatedAt as Timestamp).toMillis()
  };
}

export function createFirestoreJobStore(): JobStore {
  return {
    async createJob(job) {
      await firestore().collection(JOBS).doc(job.jobId).create({
        jobId: job.jobId,
        userId: job.userId,
        topic: job.topic,
        title: job.title ?? null,
        durationMinutes: job.durationMinutes,
        targetAudience: job.targetAudience,
        difficultyLevel: job.difficultyLevel,
        status: job.status,
        progress: job.progress,
        error: null,
        source: 'ai-content-engine',
        createdAt: Timestamp.fromMillis(job.createdAtMs),
        updatedAt: Timestamp.fromMillis(job.updatedAtMs)
      });
    },

    async getJob(jobId) {
      const snap = await firestore().collection(JOBS).doc(jobId).get();
      return snap.exists ? toStoredJob(snap.data() as DocumentData) : null;
    },

    async claimJob(jobId, userId, staleBeforeMs) {
      const db = firestore();
      const ref = db.collection(JOBS).doc(jobId);

      return db.runTransaction<ClaimResult>(async (tx) => {
        const snap = await tx.get(ref);

        // A job owned by someone else looks exactly like a missing one.
        if (!snap.exists || snap.get('userId') !== userId) {
          return { kind: 'not_found' };
        }

        const job = toStoredJob(snap.data() as DocumentData);
        const claimable =
          job.status === 'pending' ||
          job.status === 'failed' ||
          (IN_FLIGHT_STATUSES.has(job.status) && job.updatedAtMs < staleBeforeMs);

        if (!claimable) {
          return { kind: 'conflict', status: job.status };
        }

        const runId = crypto.randomUUID();
        const now = Timestamp.now();
        tx.update(ref, { status: 'researching', progress: 5, error: null, runId, updatedAt: now });

        return {
          kind: 'claimed',
          runId,
          job: { ...job, status: 'researching', progress: 5, error: null, updatedAtMs: now.toMillis() }
        };
      });
    },

    async updateJob(jobId, runId, patch) {
      const db = firestore();
      const ref = db.collection(JOBS).doc(jobId);

      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.get('runId') !== runId) {
          return false;
        }

        tx.update(ref, {
          status: patch.status,
          progress: patch.progress,
          error: patch.error ?? null,
          updatedAt: Timestamp.now()
        });
        return true;
      });
    },

    async saveContent(content, runId, patch) {
      const db = firestore();
      const jobRef = db.collection(JOBS).doc(content.jobId);

      return db.runTransaction(async (tx) => {
        const snap = await tx.get(jobRef);
        if (!snap.exists || snap.get('runId') !== runId || snap.get('userId') !== content.userId) {
          return false;
        }

        const now = Timestamp.now();
        const base = { jobId: content.jobId, userId: content.userId, createdAt: now, updatedAt: now };

        // Child documents live in global collections, so their ids are prefixed
        // with the job id. Model-generated ids such as "scene-001" or "char-01"
        // repeat across jobs and would otherwise overwrite other users' data.
        const childId = (modelId: string) => `${content.jobId}-${modelId}`;

        // `topic` stays as the user wrote it: a retried run reads it back.
        tx.update(jobRef, {
          topicTitle: content.topicAnalysis.topicTitle,
          category: content.topicAnalysis.category,
          status: patch.status,
          progress: patch.progress,
          error: null,
          updatedAt: now
        });

        tx.set(db.collection('research').doc(`${content.jobId}-research`), {
          ...base,
          researchId: `${content.jobId}-research`,
          topicTitle: content.research.topicTitle,
          summary: content.research.summary,
          keyFacts: content.research.keyFacts,
          technicalConcepts: content.research.technicalConcepts,
          references: content.research.references,
          uncertainClaims: content.research.uncertainClaims,
          verificationNotes: content.research.verificationNotes
        });

        tx.set(db.collection('scripts').doc(`${content.jobId}-script`), {
          ...base,
          scriptId: `${content.jobId}-script`,
          title: content.script.title,
          language: content.script.language,
          totalEstimatedDurationSeconds: content.script.totalEstimatedDurationSeconds,
          narrationSections: content.script.narrationSections,
          summary: content.script.summary
        });

        tx.set(db.collection('storyboards').doc(`${content.jobId}-storyboard`), {
          ...base,
          storyboardId: `${content.jobId}-storyboard`,
          title: content.storyboard.title,
          totalDurationSeconds: content.storyboard.totalDurationSeconds,
          scenes: content.storyboard.scenes
        });

        for (const scene of content.storyboard.scenes) {
          tx.set(db.collection('video_scenes').doc(childId(scene.sceneId)), {
            ...base,
            sceneId: scene.sceneId,
            sceneNumber: scene.sceneNumber,
            title: scene.title,
            learningObjective: scene.learningObjective,
            durationSeconds: scene.durationSeconds,
            narration: scene.narration,
            visualDescription: scene.visualDescription,
            characters: scene.characters,
            environment: scene.environment,
            cameraMovement: scene.cameraMovement,
            lighting: scene.lighting,
            animationStyle: scene.animationStyle,
            transition: scene.transition,
            subtitleText: scene.subtitleText,
            videoGenerationPrompt: scene.videoGenerationPrompt,
            status: 'ready'
          });
        }

        for (const character of content.characterBible.characters) {
          tx.set(db.collection('characters').doc(childId(character.characterId)), {
            ...base,
            characterId: character.characterId,
            name: character.characterName,
            genderPresentation: character.genderPresentation,
            ageAppearance: character.ageAppearance,
            facialFeatures: character.facialFeatures,
            hairstyle: character.hairstyle,
            clothing: character.clothing,
            bodyDescription: character.bodyDescription,
            personality: character.personality,
            colorPalette: character.colorPalette,
            visualStyle: character.visualStyle,
            referenceImagePrompt: character.referenceImagePrompt,
            generatedReferenceImageUrl: null
          });
        }

        return true;
      });
    },

    async addUsage(jobId, userId, usage) {
      const db = firestore();
      const ref = db.collection('usage').doc(`${jobId}-usage`);

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const now = Timestamp.now();

        const totals = {
          calls: FieldValue.increment(usage.calls),
          promptTokens: FieldValue.increment(usage.promptTokens),
          completionTokens: FieldValue.increment(usage.completionTokens),
          // Dollar figures are an estimate from token counts and configured rates;
          // they are not reconciled with the provider's invoice.
          estimatedCost: FieldValue.increment(usage.estimatedCostUsd ?? 0),
          updatedAt: now
        };

        if (snap.exists) {
          // Once any run had an unknown rate, the dollar total is a lower bound.
          tx.update(ref, usage.estimatedCostUsd === null ? { ...totals, costKnown: false } : totals);
          return;
        }

        tx.set(ref, {
          usageId: `${jobId}-usage`,
          jobId,
          userId,
          provider: 'openai',
          operation: 'content_generation',
          model: usage.model,
          creditsUsed: 0,
          costKnown: usage.estimatedCostUsd !== null,
          createdAt: now,
          ...totals
        });
      });
    }
  };
}
