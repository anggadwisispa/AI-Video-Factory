import { getFirestore, Timestamp, type WriteBatch } from 'firebase-admin/firestore';

import {
  createOpenAIService,
  type CharacterBibleEntry,
  type GeneratedScript,
  type ResearchReport,
  type ScenePromptItem,
  type Storyboard,
  type TopicAnalysis
} from '@ai-video-factory/ai-content';

import { initializeFirebase } from '../lib/firebase.js';

export type JobStatus =
  | 'pending'
  | 'researching'
  | 'scripting'
  | 'storyboarding'
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

export type JobContentInput = {
  jobId: string;
  userId?: string;
  verifiedUserId?: string;
  topic: string;
  durationMinutes?: number;
  targetAudience?: string;
  difficultyLevel?: string;
  title?: string;
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
    throw new Error('Invalid jobId format.');
  }
  return candidate;
}

function validateTopic(topic: string): string {
  const candidate = topic.trim();
  if (!candidate || candidate.length < 3) {
    throw new Error('Topic must contain at least 3 characters.');
  }
  return candidate;
}

function buildUsageRecord(jobId: string, userId: string, costUsd: number): Record<string, unknown> {
  return {
    usageId: `usage-${jobId}`,
    jobId,
    userId,
    provider: 'openai',
    operation: 'content_generation',
    creditsUsed: 0,
    estimatedCost: costUsd,
    actualCost: costUsd,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  };
}

export async function generateContentForJob(input: JobContentInput): Promise<PersistedJobContent> {
  const jobId = validateJobId(input.jobId);
  const verifiedUserId = validateVerifiedUserId(input.verifiedUserId ?? input.userId);
  const topic = validateTopic(input.topic);

  const openAIAgent = createOpenAIService();

  const topicAnalysis = await openAIAgent.analyzeTopic({
    topic,
    targetAudience: input.targetAudience ?? 'umum',
    durationMinutes: input.durationMinutes ?? 5,
    difficultyLevel: input.difficultyLevel ?? 'dasar'
  });

  const research = await openAIAgent.generateResearch({
    topic,
    category: topicAnalysis.category,
    difficultyLevel: input.difficultyLevel ?? 'dasar'
  });

  const script = await openAIAgent.generateScript({
    topic,
    title: input.title ?? topicAnalysis.topicTitle,
    durationMinutes: input.durationMinutes ?? topicAnalysis.recommendedDurationMinutes,
    audience: topicAnalysis.targetAudience,
    researchSummary: research.summary
  });

  const characterBible = await openAIAgent.generateCharacterBible({
    topic,
    title: input.title ?? topicAnalysis.topicTitle
  });

  const storyboard = await openAIAgent.generateStoryboard({
    topic,
    script
  });

  const visualPrompts = await openAIAgent.generateScenePrompts({
    topic,
    storyboard
  });

  const result: PersistedJobContent = {
    jobId,
    userId: verifiedUserId,
    topicAnalysis,
    research,
    script,
    characterBible,
    storyboard,
    visualPrompts
  };

  await persistGeneratedContent(result);
  return result;
}

async function persistGeneratedContent(payload: PersistedJobContent): Promise<void> {
  const firebaseState = initializeFirebase();

  if (!firebaseState.initialized || !firebaseState.app) {
    throw new Error(firebaseState.reason ?? 'Firebase is not configured.');
  }

  const db = getFirestore(firebaseState.app);
  const createdAt = Timestamp.now();
  const updatedAt = Timestamp.now();

  const researchDocId = `${payload.jobId}-research`;
  const scriptDocId = `${payload.jobId}-script`;
  const storyboardDocId = `${payload.jobId}-storyboard`;
  const usageDocId = `${payload.jobId}-usage`;

  const jobRecord = {
    jobId: payload.jobId,
    userId: payload.userId,
    topic: payload.topicAnalysis.topicTitle,
    category: payload.topicAnalysis.category,
    status: 'scripting' as JobStatus,
    createdAt,
    updatedAt,
    progress: 30,
    error: null,
    source: 'ai-content-engine'
  };

  const scriptRecord = {
    scriptId: scriptDocId,
    jobId: payload.jobId,
    userId: payload.userId,
    title: payload.script.title,
    language: payload.script.language,
    totalEstimatedDurationSeconds: payload.script.totalEstimatedDurationSeconds,
    narrationSections: payload.script.narrationSections,
    summary: payload.script.summary,
    createdAt,
    updatedAt
  };

  const storyboardRecord = {
    storyboardId: storyboardDocId,
    jobId: payload.jobId,
    userId: payload.userId,
    title: payload.storyboard.title,
    totalDurationSeconds: payload.storyboard.totalDurationSeconds,
    scenes: payload.storyboard.scenes,
    createdAt,
    updatedAt
  };

  const researchRecord = {
    researchId: researchDocId,
    jobId: payload.jobId,
    userId: payload.userId,
    topicTitle: payload.research.topicTitle,
    summary: payload.research.summary,
    keyFacts: payload.research.keyFacts,
    technicalConcepts: payload.research.technicalConcepts,
    references: payload.research.references,
    uncertainClaims: payload.research.uncertainClaims,
    verificationNotes: payload.research.verificationNotes,
    createdAt,
    updatedAt
  };

  const usageRecord = buildUsageRecord(payload.jobId, payload.userId, 0.01);

  const batch: WriteBatch = db.batch();

  batch.set(db.collection('video_jobs').doc(payload.jobId), jobRecord, { merge: true });
  batch.set(db.collection('research').doc(researchDocId), researchRecord, { merge: true });
  batch.set(db.collection('scripts').doc(scriptDocId), scriptRecord, { merge: true });
  batch.set(db.collection('storyboards').doc(storyboardDocId), storyboardRecord, { merge: true });
  batch.set(db.collection('usage').doc(usageDocId), usageRecord, { merge: true });

  for (const scene of payload.storyboard.scenes) {
    const sceneDoc = {
      sceneId: scene.sceneId,
      jobId: payload.jobId,
      userId: payload.userId,
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
      status: 'ready',
      createdAt,
      updatedAt
    };

    batch.set(db.collection('video_scenes').doc(scene.sceneId), sceneDoc, { merge: true });
  }

  for (const character of payload.characterBible.characters) {
    const characterDoc = {
      characterId: character.characterId,
      jobId: payload.jobId,
      userId: payload.userId,
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
      generatedReferenceImageUrl: null,
      createdAt,
      updatedAt
    };

    batch.set(db.collection('characters').doc(character.characterId), characterDoc, { merge: true });
  }

  try {
    await batch.commit();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Content persistence failed';
    throw new Error(`Failed to persist generated content: ${message}`);
  }
}
