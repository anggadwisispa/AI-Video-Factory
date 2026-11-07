import { describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  content: JSON.stringify({
    topicTitle: 'Cara kerja jantung manusia',
    category: 'Biologi',
    learningObjectives: ['Memahami fungsi jantung'],
    targetAudience: 'pelajar SMA',
    keyConcepts: ['pompa', 'darah'],
    recommendedDurationMinutes: 5,
    suggestedEducationalApproach: 'visual 3D dengan analogi sederhana'
  })
}));

vi.mock('openai', () => ({
  default: class MockOpenAI {
    public chat = {
      completions: {
        create: async () => ({
          choices: [{ message: { content: mock.content } }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 80
          }
        })
      }
    };
  }
}));

import { estimateTokensCost, OpenAIService } from './openai-service.js';
import { TopicAnalysisSchema } from './schemas.js';

describe('OpenAIService', () => {
  it('validates topic analysis with Zod', async () => {
    const service = new OpenAIService({ apiKey: 'test-key' });
    const result = await service.analyzeTopic({ topic: 'Cara kerja jantung manusia' });

    expect(TopicAnalysisSchema.parse(result)).toEqual(result);
    expect(result.category).toBe('Biologi');
  });

  it('accumulates token usage across requests and prices it per model', async () => {
    const service = new OpenAIService({ apiKey: 'test-key', model: 'gpt-4o-mini' });
    await service.analyzeTopic({ topic: 'Cara kerja jantung manusia' });
    await service.analyzeTopic({ topic: 'Sistem pencernaan' });

    // 200 input tokens at $0.15/1M + 160 output tokens at $0.60/1M
    expect(service.getUsage()).toEqual({
      model: 'gpt-4o-mini',
      calls: 2,
      promptTokens: 200,
      completionTokens: 160,
      estimatedCostUsd: 0.000126
    });
  });

  it('counts tokens from a response that could not be parsed, because they were billed', async () => {
    const valid = mock.content;
    mock.content = 'this is not json';
    try {
      const service = new OpenAIService({ apiKey: 'test-key', maxRetries: 0 });
      await expect(service.analyzeTopic({ topic: 'Jantung' })).rejects.toThrow();
      expect(service.getUsage()).toMatchObject({ calls: 1, promptTokens: 100, completionTokens: 80 });
    } finally {
      mock.content = valid;
    }
  });

  it('reports no dollar estimate for a model without a known rate instead of guessing', async () => {
    const service = new OpenAIService({ apiKey: 'test-key', model: 'some-future-model' });
    await service.analyzeTopic({ topic: 'Jantung' });

    expect(service.getUsage()).toMatchObject({ promptTokens: 100, completionTokens: 80, estimatedCostUsd: null });
  });

  it('prices gpt-4o-mini separately from gpt-4o and lets env rates override the table', () => {
    expect(estimateTokensCost(1_000_000, 1_000_000, 'gpt-4o-mini')).toBe(0.75);
    expect(estimateTokensCost(1_000_000, 1_000_000, 'gpt-4o')).toBe(12.5);

    process.env.OPENAI_INPUT_COST_PER_1M_USD = '1';
    process.env.OPENAI_OUTPUT_COST_PER_1M_USD = '2';
    try {
      expect(estimateTokensCost(1_000_000, 1_000_000, 'some-future-model')).toBe(3);
    } finally {
      delete process.env.OPENAI_INPUT_COST_PER_1M_USD;
      delete process.env.OPENAI_OUTPUT_COST_PER_1M_USD;
    }
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
