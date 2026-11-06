import { getFirestore } from 'firebase-admin/firestore';

import { createOpenAIService } from '@ai-video-factory/ai-content';

import { initializeFirebase } from '../lib/firebase.js';

export type JobContentInput = {
  jobId: string;
  topic: string;
  durationMinutes?: number;
  targetAudience?: string;
  difficultyLevel?: string;
  title?: string;
};

export async function generateContentForJob(input: JobContentInput) {
  const openAIAgent = createOpenAIService();

  const topicAnalysis = await openAIAgent.analyzeTopic({
    topic: input.topic,
    targetAudience: input.targetAudience ?? 'umum',
    durationMinutes: input.durationMinutes ?? 5,
    difficultyLevel: input.difficultyLevel ?? 'dasar'
  });

  const research = await openAIAgent.generateResearch({
    topic: input.topic,
    category: topicAnalysis.category,
    difficultyLevel: input.difficultyLevel ?? 'dasar'
  });

  const script = await openAIAgent.generateScript({
    topic: input.topic,
    title: input.title ?? topicAnalysis.topicTitle,
    durationMinutes: input.durationMinutes ?? topicAnalysis.recommendedDurationMinutes,
    audience: topicAnalysis.targetAudience,
    researchSummary: research.summary
  });

  const characterBible = await openAIAgent.generateCharacterBible({
    topic: input.topic,
    title: input.title ?? topicAnalysis.topicTitle
  });

  const storyboard = await openAIAgent.generateStoryboard({
    topic: input.topic,
    script
  });

  const visualPrompts = await openAIAgent.generateScenePrompts({
    topic: input.topic,
    storyboard
  });

  const result = {
    topicAnalysis,
    research,
    script,
    characterBible,
    storyboard,
    visualPrompts
  };

  await persistGeneratedContent({
    jobId: input.jobId,
    ...result
  });

  return result;
}

async function persistGeneratedContent(payload: {
  jobId: string;
  topicAnalysis: any;
  research: any;
  script: any;
  characterBible: any;
  storyboard: any;
  visualPrompts: any[];
}) {
  const firebaseState = initializeFirebase();

  if (!firebaseState.initialized || !firebaseState.app) {
    console.warn('Firebase not configured; skipping persistence of generated content.', firebaseState.reason);
    return;
  }

  const db = getFirestore(firebaseState.app);

  await db.collection('video_jobs').doc(payload.jobId).set({
    jobId: payload.jobId,
    topic: payload.topicAnalysis.topicTitle,
    category: payload.topicAnalysis.category,
    status: 'scripting',
    script: payload.script,
    storyboard: payload.storyboard,
    researchReport: payload.research,
    characterBible: payload.characterBible,
    visualPrompts: payload.visualPrompts,
    processingStatus: 'completed',
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    source: 'ai-content-engine'
  }, { merge: true });

  for (const scene of payload.storyboard.scenes) {
    await db.collection('video_scenes').doc(scene.sceneId).set({
      sceneId: scene.sceneId,
      jobId: payload.jobId,
      sceneNumber: scene.sceneNumber,
      title: scene.title,
      narration: scene.narration,
      visualDescription: scene.visualDescription,
      prompt: scene.videoGenerationPrompt,
      subtitleText: scene.subtitleText,
      status: 'ready',
      createdAt: new Date().toISOString()
    }, { merge: true });
  }

  for (const character of payload.characterBible.characters) {
    await db.collection('characters').doc(character.characterId).set({
      characterId: character.characterId,
      jobId: payload.jobId,
      name: character.characterName,
      description: character.personality,
      visualStyle: character.visualStyle,
      referenceImageUrl: '',
      voiceId: 'pending',
      colorPalette: character.colorPalette,
      createdAt: new Date().toISOString()
    }, { merge: true });
  }
}
