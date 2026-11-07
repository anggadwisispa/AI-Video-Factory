import OpenAI from 'openai';
import { z } from 'zod';

import {
  CharacterBibleEntrySchema,
  GeneratedScriptSchema,
  ResearchReportSchema,
  ScenePromptSchema,
  StoryboardSchema,
  TopicAnalysisSchema
} from './schemas.js';
import type {
  CharacterBibleEntry,
  ContentGenerationResult,
  GeneratedScript,
  ResearchReport,
  ScenePromptItem,
  Storyboard,
  TopicAnalysis
} from './types.js';

export type OpenAIServiceConfig = {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  timeoutMs?: number;
  maxRetries?: number;
};

export type OpenAIUsage = {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  /** Estimated from token counts and per-model rates; null when no rate is known for the model. */
  estimatedCostUsd: number | null;
};

type TokenRates = { inputPer1M: number; outputPer1M: number };

// USD per 1M tokens. Matched by model-name prefix, longest prefix first so that
// "gpt-4o-mini" is not priced as "gpt-4o". Rates change: override them with
// OPENAI_INPUT_COST_PER_1M_USD / OPENAI_OUTPUT_COST_PER_1M_USD.
const DEFAULT_RATES: Array<[prefix: string, rates: TokenRates]> = [
  ['gpt-4o-mini', { inputPer1M: 0.15, outputPer1M: 0.6 }],
  ['gpt-4o', { inputPer1M: 2.5, outputPer1M: 10 }]
];

function resolveRates(model: string): TokenRates | null {
  const input = Number(process.env.OPENAI_INPUT_COST_PER_1M_USD);
  const output = Number(process.env.OPENAI_OUTPUT_COST_PER_1M_USD);
  if (process.env.OPENAI_INPUT_COST_PER_1M_USD && process.env.OPENAI_OUTPUT_COST_PER_1M_USD
    && Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0) {
    return { inputPer1M: input, outputPer1M: output };
  }

  const match = DEFAULT_RATES.find(([prefix]) => model.startsWith(prefix));
  return match ? match[1] : null;
}

export function estimateTokensCost(inputTokens: number, outputTokens: number, model: string): number | null {
  const rates = resolveRates(model);
  if (!rates) {
    return null;
  }

  const cost = (inputTokens * rates.inputPer1M + outputTokens * rates.outputPer1M) / 1_000_000;
  return Number(cost.toFixed(6));
}

export class OpenAIService {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private calls = 0;
  private promptTokens = 0;
  private completionTokens = 0;

  constructor(config: OpenAIServiceConfig = {}) {
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured.');
    }

    this.model = config.model ?? process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    this.maxRetries = config.maxRetries ?? Number(process.env.OPENAI_MAX_RETRIES ?? '3');
    this.timeoutMs = config.timeoutMs ?? Number(process.env.OPENAI_TIMEOUT_MS ?? '120000');

    this.client = new OpenAI({
      apiKey,
      baseURL: config.baseURL ?? process.env.OPENAI_BASE_URL,
      timeout: this.timeoutMs,
      maxRetries: 0
    });
  }

  async analyzeTopic(input: {
    topic: string;
    targetAudience?: string;
    durationMinutes?: number;
    difficultyLevel?: string;
  }): Promise<TopicAnalysis> {
    const system = `Anda adalah ahli kurikulum dan penyusun konten edukasi. Utamakan fakta, bahasa Indonesia, dan struktur pendidikan yang jelas.`;
    const user = `Analisis topik berikut dan hasilkan format JSON yang valid. Topik: ${input.topic}. Target audiens: ${input.targetAudience ?? 'umum'}. Durasi video: ${input.durationMinutes ?? 5} menit. Tingkat kesulitan: ${input.difficultyLevel ?? 'dasar'}.`;

    const result = await this.callJson<TopicAnalysis>(system, user, TopicAnalysisSchema);
    return result;
  }

  async generateResearch(input: {
    topic: string;
    category?: string;
    difficultyLevel?: string;
  }): Promise<ResearchReport> {
    const system = `Anda adalah peneliti konten edukasi. Jelaskan fakta utama, konsep teknis, sumber, dan tanda keraguan. Jangan mengarang statistik. Selalu pisahkan informasi yang sudah diverifikasi dari klaim yang belum didukung. Jangan memperlakukan referensi yang dibuat AI sebagai sumber yang terverifikasi. Untuk topik ilmiah, medis, finansial, atau berdampak tinggi, minta verifikasi sumber yang lebih kuat dan tandai klaim yang tidak kuat.`;
    const user = `Buat laporan penelitian untuk topik: ${input.topic}. Kategori: ${input.category ?? 'Pendidikan'}; tingkat kesulitan: ${input.difficultyLevel ?? 'umum'}. Gunakan bahasa Indonesia dan hasilkan JSON valid.`;

    return this.callJson<ResearchReport>(system, user, ResearchReportSchema);
  }

  async generateScript(input: {
    topic: string;
    title?: string;
    durationMinutes?: number;
    audience?: string;
    researchSummary?: string;
  }): Promise<GeneratedScript> {
    const system = `Anda adalah penulis naskah edukasi 3D. Tulis dalam bahasa Indonesia yang natural, menarik, dan informatif. Setiap bagian harus jelas, ilmiah bila perlu, dan sesuai durasi.`;
    const user = `Buat naskah edukasi untuk topik: ${input.topic}. Judul proposal: ${input.title ?? input.topic}. Durasi target: ${input.durationMinutes ?? 5} menit. Target audiens: ${input.audience ?? 'umum'}. Ringkasan riset: ${input.researchSummary ?? 'gunakan prinsip edukasi umum'}. Output harus berupa JSON valid.`;

    return this.callJson<GeneratedScript>(system, user, GeneratedScriptSchema);
  }

  async generateStoryboard(input: {
    script: GeneratedScript;
    topic: string;
  }): Promise<Storyboard> {
    const system = `Anda adalah sutradara storyboard untuk animasi pendidikan 3D. Setiap adegan harus berhubungan dengan bagian naskah, realistis durasinya, dan konsisten dengan karakter yang sama.`;
    const user = `Buat storyboard berdasarkan naskah berikut. Topik: ${input.topic}. Naskah: ${JSON.stringify(input.script)}. Hasilkan JSON valid.`;

    return this.callJson<Storyboard>(system, user, StoryboardSchema);
  }

  async generateCharacterBible(input: {
    topic: string;
    title?: string;
  }): Promise<{ projectTitle: string; characters: CharacterBibleEntry[] }> {
    const system = `Anda adalah konsultan desain karakter 3D untuk animasi edukasi. Desain karakter harus konsisten dalam visual, warna, pakaian, dan kepribadian.`;
    const user = `Buat karakter bible untuk proyek: ${input.title ?? input.topic}. Tema: ${input.topic}. Kembalikan JSON dengan field projectTitle dan characters.`;

    const payload = await this.callJson<{ projectTitle: string; characters: CharacterBibleEntry[] }>(system, user, z.object({
      projectTitle: z.string(),
      characters: z.array(CharacterBibleEntrySchema)
    }));

    return payload;
  }

  async generateScenePrompts(input: {
    storyboard: Storyboard;
    topic: string;
  }): Promise<ScenePromptItem[]> {
    const system = `Anda adalah prompt engineer untuk animasi 3D. Kembangkan prompt visual yang profesional, jelas, konsisten secara karakter, dan siap dipakai pada model video generatif.`;
    const user = `Buat prompt visual untuk setiap adegan dari storyboard berikut. Topik: ${input.topic}. Storyboard: ${JSON.stringify(input.storyboard)}. Kembalikan array prompt per adegan.`;

    const payload = await this.callJson<{ scenes: ScenePromptItem[] }>(system, user, z.object({
      scenes: z.array(ScenePromptSchema)
    }));

    return payload.scenes.map((scene) => ({
      sceneNumber: scene.sceneNumber,
      prompt: scene.prompt,
      negativePrompt: scene.negativePrompt,
      style: scene.style
    }));
  }

  /**
   * Token usage accumulated by this instance across every request it made,
   * including retried and unparseable responses (they were billed too).
   * Create one service per job to get per-job usage.
   */
  getUsage(): OpenAIUsage {
    return {
      model: this.model,
      calls: this.calls,
      promptTokens: this.promptTokens,
      completionTokens: this.completionTokens,
      estimatedCostUsd: estimateTokensCost(this.promptTokens, this.completionTokens, this.model)
    };
  }

  private async callJson<T>(system: string, user: string, schema: z.ZodType<T>): Promise<T> {
    const rawResponse = await this.withRetry(async () => {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      });

      // Count usage as soon as the response arrives, before any parsing can throw.
      const usage = completion.usage;
      this.calls += 1;
      if (usage) {
        const promptTokens = usage.prompt_tokens ?? 0;
        const completionTokens = usage.completion_tokens ?? 0;
        this.promptTokens += promptTokens;
        this.completionTokens += completionTokens;

        console.info('OpenAI usage logged', {
          model: this.model,
          promptTokens,
          completionTokens,
          estimatedCostUSD: estimateTokensCost(promptTokens, completionTokens, this.model)
        });
      }

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('OpenAI returned an empty response.');
      }

      return JSON.parse(content) as T;
    });

    return schema.parse(rawResponse);
  }

  private async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;

    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (attempt >= this.maxRetries) {
          throw error;
        }

        attempt += 1;
        console.warn(`OpenAI request failed. Retry ${attempt}/${this.maxRetries}.`, error instanceof Error ? error.message : error);
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
}

export function createOpenAIService(): OpenAIService {
  return new OpenAIService();
}

export type { ContentGenerationResult, TopicAnalysis, ResearchReport, GeneratedScript, CharacterBibleEntry, Storyboard, ScenePromptItem };

