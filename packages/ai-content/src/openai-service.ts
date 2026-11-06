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

function estimateTokensCost(inputTokens: number, outputTokens: number, model: string): number {
  const unit = model.includes('gpt-4o-mini') ? 0.000002 : model.includes('gpt-4o') ? 0.00001 : 0.000004;
  return Number(((inputTokens * unit) + (outputTokens * unit * 2.5)).toFixed(6));
}

export class OpenAIService {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

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

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('OpenAI returned an empty response.');
      }

      const usage = completion.usage;
      if (usage) {
        const estimatedCost = estimateTokensCost(
          usage.prompt_tokens ?? 0,
          usage.completion_tokens ?? 0,
          this.model
        );

        console.info('OpenAI usage logged', {
          model: this.model,
          promptTokens: usage.prompt_tokens ?? 0,
          completionTokens: usage.completion_tokens ?? 0,
          estimatedCostUSD: estimatedCost
        });
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
