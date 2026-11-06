export type TopicAnalysis = {
  topicTitle: string;
  category: string;
  learningObjectives: string[];
  targetAudience: string;
  keyConcepts: string[];
  recommendedDurationMinutes: number;
  suggestedEducationalApproach: string;
};

export type ResearchReference = {
  title: string;
  url: string;
  note?: string;
};

export type ResearchFact = {
  fact: string;
  sourceUrl?: string;
  confidence: 'verified' | 'uncertain';
};

export type ResearchReport = {
  topicTitle: string;
  summary: string;
  keyFacts: ResearchFact[];
  technicalConcepts: Array<{
    concept: string;
    explanation: string;
  }>;
  references: ResearchReference[];
  uncertainClaims: string[];
  verificationNotes: string;
};

export type ScriptSection = {
  section: 'opening' | 'introduction' | 'main' | 'examples' | 'applications' | 'summary' | 'closing';
  title: string;
  narration: string;
  estimatedDurationSeconds: number;
};

export type GeneratedScript = {
  title: string;
  language: 'id';
  narrationSections: ScriptSection[];
  totalEstimatedDurationSeconds: number;
  summary: string;
};

export type CharacterBibleEntry = {
  characterId: string;
  characterName: string;
  genderPresentation: string;
  ageAppearance: string;
  facialFeatures: string;
  hairstyle: string;
  clothing: string;
  bodyDescription: string;
  personality: string;
  colorPalette: string[];
  visualStyle: string;
  referenceImagePrompt: string;
};

export type SceneStoryboardItem = {
  sceneId: string;
  sceneNumber: number;
  title: string;
  learningObjective: string;
  durationSeconds: number;
  narration: string;
  visualDescription: string;
  characters: string[];
  environment: string;
  cameraMovement: string;
  lighting: string;
  animationStyle: string;
  transition: string;
  subtitleText: string;
  videoGenerationPrompt: string;
};

export type Storyboard = {
  title: string;
  totalDurationSeconds: number;
  scenes: SceneStoryboardItem[];
};

export type ScenePromptItem = {
  sceneNumber: number;
  prompt: string;
  negativePrompt: string;
  style: string;
};

export type ContentGenerationResult = {
  topicAnalysis: TopicAnalysis;
  research: ResearchReport;
  script: GeneratedScript;
  characterBible: {
    projectTitle: string;
    characters: CharacterBibleEntry[];
  };
  storyboard: Storyboard;
  visualPrompts: ScenePromptItem[];
};
