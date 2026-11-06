import { z } from 'zod';

export const TopicAnalysisSchema = z.object({
  topicTitle: z.string(),
  category: z.string(),
  learningObjectives: z.array(z.string()),
  targetAudience: z.string(),
  keyConcepts: z.array(z.string()),
  recommendedDurationMinutes: z.number().min(1),
  suggestedEducationalApproach: z.string()
});

export const ResearchReportSchema = z.object({
  topicTitle: z.string(),
  summary: z.string(),
  keyFacts: z.array(z.object({
    fact: z.string(),
    sourceUrl: z.string().url().optional(),
    confidence: z.enum(['verified', 'uncertain'])
  })),
  technicalConcepts: z.array(z.object({
    concept: z.string(),
    explanation: z.string()
  })),
  references: z.array(z.object({
    title: z.string(),
    url: z.string().url(),
    note: z.string().optional()
  })),
  uncertainClaims: z.array(z.string()),
  verificationNotes: z.string()
});

export const ScriptSectionSchema = z.object({
  section: z.enum(['opening', 'introduction', 'main', 'examples', 'applications', 'summary', 'closing']),
  title: z.string(),
  narration: z.string(),
  estimatedDurationSeconds: z.number().min(5)
});

export const GeneratedScriptSchema = z.object({
  title: z.string(),
  language: z.literal('id'),
  narrationSections: z.array(ScriptSectionSchema),
  totalEstimatedDurationSeconds: z.number().min(30),
  summary: z.string()
});

export const CharacterBibleEntrySchema = z.object({
  characterId: z.string(),
  characterName: z.string(),
  genderPresentation: z.string(),
  ageAppearance: z.string(),
  facialFeatures: z.string(),
  hairstyle: z.string(),
  clothing: z.string(),
  bodyDescription: z.string(),
  personality: z.string(),
  colorPalette: z.array(z.string()),
  visualStyle: z.string(),
  referenceImagePrompt: z.string()
});

export const StoryboardSceneSchema = z.object({
  sceneId: z.string(),
  sceneNumber: z.number().min(1),
  title: z.string(),
  learningObjective: z.string(),
  durationSeconds: z.number().min(5),
  narration: z.string(),
  visualDescription: z.string(),
  characters: z.array(z.string()),
  environment: z.string(),
  cameraMovement: z.string(),
  lighting: z.string(),
  animationStyle: z.string(),
  transition: z.string(),
  subtitleText: z.string(),
  videoGenerationPrompt: z.string()
});

export const StoryboardSchema = z.object({
  title: z.string(),
  totalDurationSeconds: z.number().min(30),
  scenes: z.array(StoryboardSceneSchema)
});

export const ScenePromptSchema = z.object({
  sceneNumber: z.number().min(1),
  prompt: z.string(),
  negativePrompt: z.string(),
  style: z.string()
});
