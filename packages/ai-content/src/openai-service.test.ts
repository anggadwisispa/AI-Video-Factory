import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('openai', () => ({
  default: class MockOpenAI {
    public chat = {
      completions: {
        create: async () => ({
          choices: [{ message: { content: JSON.stringify({
            topicTitle: 'Cara kerja jantung manusia',
            category: 'Biologi',
            learningObjectives: ['Memahami fungsi jantung'],
            targetAudience: 'pelajar SMA',
            keyConcepts: ['pompa', 'darah'],
            recommendedDurationMinutes: 5,
            suggestedEducationalApproach: 'visual 3D dengan analogi sederhana'
          }) } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 80
          }
        })
      }
    };
  }
}));

import { OpenAIService } from './openai-service.js';
import { TopicAnalysisSchema } from './schemas.js';

describe('OpenAIService', () => {
  it('validates topic analysis with Zod', async () => {
    const service = new OpenAIService({ apiKey: 'test-key' });
    const result = await service.analyzeTopic({ topic: 'Cara kerja jantung manusia' });

    expect(TopicAnalysisSchema.parse(result)).toEqual(result);
    expect(result.category).toBe('Biologi');
  });

  it('throws when the API key is missing', () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    expect(() => new OpenAIService()).toThrow('OPENAI_API_KEY is not configured.');

    if (previous) {
      process.env.OPENAI_API_KEY = previous;
    }
  });
});
