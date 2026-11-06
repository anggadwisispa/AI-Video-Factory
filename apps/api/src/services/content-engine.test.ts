import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAnalyzeTopic = vi.fn();
const mockGenerateResearch = vi.fn();
const mockGenerateScript = vi.fn();
const mockGenerateCharacterBible = vi.fn();
const mockGenerateStoryboard = vi.fn();
const mockGenerateScenePrompts = vi.fn();

vi.mock('@ai-video-factory/ai-content', () => ({
  createOpenAIService: () => ({
    analyzeTopic: mockAnalyzeTopic,
    generateResearch: mockGenerateResearch,
    generateScript: mockGenerateScript,
    generateCharacterBible: mockGenerateCharacterBible,
    generateStoryboard: mockGenerateStoryboard,
    generateScenePrompts: mockGenerateScenePrompts
  })
}));

describe('content engine generation flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAnalyzeTopic.mockResolvedValue({
      topicTitle: 'Cara kerja jantung manusia',
      category: 'Biologi',
      learningObjectives: ['Memahami fungsi jantung'],
      targetAudience: 'pelajar SMA',
      keyConcepts: ['pompa darah', 'sirkulasi'],
      recommendedDurationMinutes: 5,
      suggestedEducationalApproach: 'visualisasi 3D dengan analogi sederhana'
    });

    mockGenerateResearch.mockResolvedValue({
      topicTitle: 'Cara kerja jantung manusia',
      summary: 'Jantung memompa darah ke seluruh tubuh untuk oksigenasi.',
      keyFacts: [{ fact: 'Jantung memompa darah secara ritmis.', sourceUrl: 'https://example.com', confidence: 'verified' }],
      technicalConcepts: [{ concept: 'sistol', explanation: 'kondisi kontraksi' }],
      references: [{ title: 'Referensi kesehatan', url: 'https://example.com', note: 'sumber primer' }],
      uncertainClaims: [],
      verificationNotes: 'Semua fakta utama diverifikasi dengan sumber yang relevan.'
    });

    mockGenerateScript.mockResolvedValue({
      title: 'Cara kerja jantung manusia',
      language: 'id',
      narrationSections: [
        { section: 'opening', title: 'Hook', narration: 'Apakah kalian tahu jantung bekerja tanpa henti?', estimatedDurationSeconds: 25 }
      ],
      totalEstimatedDurationSeconds: 180,
      summary: 'Ringkasan dasar'
    });

    mockGenerateCharacterBible.mockResolvedValue({
      projectTitle: 'Cara kerja jantung manusia',
      characters: [{
        characterId: 'char-01',
        characterName: 'Aksa',
        genderPresentation: 'male',
        ageAppearance: '20s',
        facialFeatures: 'oval face, soft eyes',
        hairstyle: 'short dark hair',
        clothing: 'light blue lab coat',
        bodyDescription: 'slim, energetic',
        personality: 'curious and calm',
        colorPalette: ['#3B82F6', '#E0F2FE'],
        visualStyle: 'modern 3D educational character',
        referenceImagePrompt: '3D educational mentor character sitting in front of a heart model'
      }]
    });

    mockGenerateStoryboard.mockResolvedValue({
      title: 'Cara kerja jantung manusia',
      totalDurationSeconds: 180,
      scenes: [{
        sceneId: 'scene-001',
        sceneNumber: 1,
        title: 'Pendahuluan',
        learningObjective: 'Memahami jantung sebagai pompa',
        durationSeconds: 30,
        narration: 'Jantung adalah organ utama yang memompa darah.',
        visualDescription: 'Karakter menjelaskan jantung yang berdetak di dalam tubuh.',
        characters: ['Aksa'],
        environment: 'studio medis 3D',
        cameraMovement: 'tracking slow motion',
        lighting: 'soft cinematic lighting',
        animationStyle: '3D educational',
        transition: 'fade',
        subtitleText: 'Jantung adalah pompa tubuh',
        videoGenerationPrompt: '3D educational animation of heart pumping blood' 
      }]
    });

    mockGenerateScenePrompts.mockResolvedValue([{ sceneNumber: 1, prompt: '3D modern educational animation of heart pumping blood', negativePrompt: 'distorted anatomy, text artifacts', style: 'cinematic 3D educational' }]);
  });

  it('produces a complete content package from a topic', async () => {
    const { generateContentForJob } = await import('./content-engine.js');

    const content = await generateContentForJob({
      jobId: 'job-123',
      topic: 'Cara kerja jantung manusia',
      durationMinutes: 5,
      targetAudience: 'pelajar SMA'
    });

    expect(content.topicAnalysis.topicTitle).toContain('jantung');
    expect(content.script.language).toBe('id');
    expect(content.storyboard.scenes.length).toBeGreaterThan(0);
    expect(content.visualPrompts[0]?.prompt).toContain('3D');
  });
});
