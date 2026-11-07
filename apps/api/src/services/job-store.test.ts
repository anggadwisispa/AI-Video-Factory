import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  writes: [] as Array<{ op: 'set' | 'update' | 'create'; path: string; data: Record<string, unknown> }>
}));

vi.mock('../lib/firebase.js', () => ({
  initializeFirebase: () => ({ initialized: true, app: {} })
}));

// Only Firestore itself is replaced; Timestamp and FieldValue stay real.
vi.mock('firebase-admin/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase-admin/firestore')>();

  const snapshot = (path: string) => {
    const data = fake.docs.get(path);
    return { exists: Boolean(data), data: () => data, get: (field: string) => data?.[field] };
  };
  const ref = (path: string) => ({
    path,
    get: async () => snapshot(path),
    create: async (data: Record<string, unknown>) => {
      if (fake.docs.has(path)) throw new Error('ALREADY_EXISTS');
      fake.writes.push({ op: 'create', path, data });
      fake.docs.set(path, data);
    }
  });

  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(`${name}/${id}`) }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        get: async (r: { path: string }) => snapshot(r.path),
        update: (r: { path: string }, data: Record<string, unknown>) => {
          fake.writes.push({ op: 'update', path: r.path, data });
          fake.docs.set(r.path, { ...fake.docs.get(r.path), ...data });
        },
        set: (r: { path: string }, data: Record<string, unknown>) => {
          fake.writes.push({ op: 'set', path: r.path, data });
          fake.docs.set(r.path, data);
        }
      })
  };

  return { ...actual, getFirestore: () => db };
});

import { createFirestoreJobStore, type PersistedJobContent } from './job-store.js';

const NOW = 1_700_000_000_000;

function seedJob(jobId: string, over: Record<string, unknown> = {}) {
  fake.docs.set(`video_jobs/${jobId}`, {
    jobId,
    userId: 'owner',
    topic: 'Cara kerja jantung manusia',
    title: null,
    durationMinutes: 5,
    targetAudience: 'umum',
    difficultyLevel: 'dasar',
    status: 'pending',
    progress: 0,
    error: null,
    runId: undefined,
    createdAt: Timestamp.fromMillis(NOW),
    updatedAt: Timestamp.fromMillis(NOW),
    ...over
  });
}

function content(jobId: string): PersistedJobContent {
  return {
    jobId,
    userId: 'owner',
    topicAnalysis: { topicTitle: 'Judul dari model', category: 'Biologi' },
    research: { topicTitle: 'r', summary: 's', keyFacts: [], technicalConcepts: [], references: [], uncertainClaims: [], verificationNotes: 'v' },
    script: { title: 't', language: 'id', narrationSections: [], totalEstimatedDurationSeconds: 60, summary: 's' },
    characterBible: { projectTitle: 'p', characters: [{ characterId: 'char-01', characterName: 'Aksa' }] },
    storyboard: { title: 'sb', totalDurationSeconds: 60, scenes: [{ sceneId: 'scene-001', sceneNumber: 1, title: 'Awal' }] },
    visualPrompts: []
  } as unknown as PersistedJobContent;
}

beforeEach(() => {
  fake.docs.clear();
  fake.writes.length = 0;
});

describe('claimJob', () => {
  const store = createFirestoreJobStore();
  const staleBefore = NOW - 1;

  it('claims a pending job for its owner and stamps a run id', async () => {
    seedJob('job-1');
    const result = await store.claimJob('job-1', 'owner', staleBefore);

    expect(result.kind).toBe('claimed');
    const stored = fake.docs.get('video_jobs/job-1')!;
    expect(stored).toMatchObject({ status: 'researching', progress: 5, error: null });
    expect(typeof stored.runId).toBe('string');
    if (result.kind === 'claimed') expect(result.runId).toBe(stored.runId);
  });

  it('answers not_found for a missing job and for another user\'s job, writing nothing', async () => {
    seedJob('job-1');

    expect(await store.claimJob('job-missing', 'owner', staleBefore)).toEqual({ kind: 'not_found' });
    expect(await store.claimJob('job-1', 'intruder', staleBefore)).toEqual({ kind: 'not_found' });
    expect(fake.writes).toHaveLength(0);
  });

  it('refuses a finished job and a fresh in-flight job', async () => {
    seedJob('job-done', { status: 'content_ready' });
    seedJob('job-busy', { status: 'scripting', updatedAt: Timestamp.fromMillis(NOW) });

    expect(await store.claimJob('job-done', 'owner', staleBefore)).toEqual({ kind: 'conflict', status: 'content_ready' });
    expect(await store.claimJob('job-busy', 'owner', staleBefore)).toEqual({ kind: 'conflict', status: 'scripting' });
    expect(fake.writes).toHaveLength(0);
  });

  it('reclaims a failed job and a stale in-flight job', async () => {
    seedJob('job-failed', { status: 'failed', error: 'boom' });
    seedJob('job-stale', { status: 'storyboarding', updatedAt: Timestamp.fromMillis(NOW - 10_000) });

    expect((await store.claimJob('job-failed', 'owner', staleBefore)).kind).toBe('claimed');
    expect((await store.claimJob('job-stale', 'owner', staleBefore)).kind).toBe('claimed');
    expect(fake.docs.get('video_jobs/job-failed')).toMatchObject({ status: 'researching', error: null });
  });
});

describe('updateJob', () => {
  const store = createFirestoreJobStore();

  it('writes only while the caller still holds the run id', async () => {
    seedJob('job-1', { status: 'researching', runId: 'run-a' });

    expect(await store.updateJob('job-1', 'run-b', { status: 'failed', progress: 20, error: 'x' })).toBe(false);
    expect(fake.writes).toHaveLength(0);

    expect(await store.updateJob('job-1', 'run-a', { status: 'scripting', progress: 20 })).toBe(true);
    expect(fake.docs.get('video_jobs/job-1')).toMatchObject({ status: 'scripting', progress: 20, error: null });
  });
});

describe('saveContent', () => {
  const store = createFirestoreJobStore();
  const patch = { status: 'content_ready' as const, progress: 40 };

  it('prefixes scene and character document ids with the job id and keeps the user\'s topic', async () => {
    seedJob('job-1', { status: 'storyboarding', runId: 'run-a' });

    expect(await store.saveContent(content('job-1'), 'run-a', patch)).toBe(true);

    expect(fake.docs.has('video_scenes/job-1-scene-001')).toBe(true);
    expect(fake.docs.has('characters/job-1-char-01')).toBe(true);
    expect(fake.docs.has('video_scenes/scene-001')).toBe(false);
    expect(fake.docs.has('characters/char-01')).toBe(false);

    // The model's own ids are still kept inside the documents.
    expect(fake.docs.get('video_scenes/job-1-scene-001')).toMatchObject({ sceneId: 'scene-001', jobId: 'job-1', userId: 'owner' });

    const job = fake.docs.get('video_jobs/job-1')!;
    expect(job).toMatchObject({ topic: 'Cara kerja jantung manusia', topicTitle: 'Judul dari model', status: 'content_ready', progress: 40 });
  });

  it('keeps two jobs that share model-generated ids from overwriting each other', async () => {
    seedJob('job-1', { runId: 'run-a' });
    seedJob('job-2', { userId: 'other', runId: 'run-b' });

    await store.saveContent(content('job-1'), 'run-a', patch);
    await store.saveContent({ ...content('job-2'), userId: 'other' }, 'run-b', patch);

    expect(fake.docs.get('video_scenes/job-1-scene-001')).toMatchObject({ userId: 'owner' });
    expect(fake.docs.get('video_scenes/job-2-scene-001')).toMatchObject({ userId: 'other' });
  });

  it('writes nothing when the run id or the owner does not match', async () => {
    seedJob('job-1', { runId: 'run-a' });

    expect(await store.saveContent(content('job-1'), 'run-zombie', patch)).toBe(false);
    expect(await store.saveContent({ ...content('job-1'), userId: 'intruder' }, 'run-a', patch)).toBe(false);
    expect(fake.writes).toHaveLength(0);
  });
});

describe('addUsage', () => {
  const store = createFirestoreJobStore();
  const usage = { model: 'gpt-4o-mini', calls: 6, promptTokens: 1000, completionTokens: 500, estimatedCostUsd: 0.00045 };

  it('creates the usage document once, then adds to it', async () => {
    await store.addUsage('job-1', 'owner', usage);
    await store.addUsage('job-1', 'owner', usage);

    const [first, second] = fake.writes.filter((w) => w.path === 'usage/job-1-usage');
    expect(first.op).toBe('set');
    expect(first.data).toMatchObject({ usageId: 'job-1-usage', jobId: 'job-1', userId: 'owner', costKnown: true });
    expect(first.data.createdAt).toBeInstanceOf(Timestamp);
    expect((first.data.promptTokens as { isEqual(o: unknown): boolean }).isEqual(FieldValue.increment(1000))).toBe(true);

    expect(second.op).toBe('update');
    expect(second.data.createdAt).toBeUndefined();
  });

  it('flags the dollar total as incomplete when the model has no known rate', async () => {
    await store.addUsage('job-2', 'owner', { ...usage, estimatedCostUsd: null });
    expect(fake.docs.get('usage/job-2-usage')).toMatchObject({ costKnown: false });
  });
});
