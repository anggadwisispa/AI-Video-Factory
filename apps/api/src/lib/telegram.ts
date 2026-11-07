import { Telegraf, type Context } from 'telegraf';

import { getAllowedUserIds, getTelegramBotToken, resolveTelegramUserId } from '../config/env.js';
import { getContentEngine, JobValidationError } from '../services/content-engine.js';

export type VideoRequest = {
  topic: string;
  durationMinutes: number;
  aspectRatio: '16:9' | '9:16';
  language: 'id';
  rawText: string;
};

export function normalizeUserId(input?: string | number | null): string | null {
  if (input === undefined || input === null) {
    return null;
  }

  return String(input);
}

function getMessageText(ctx: Context): string {
  const message = ctx.message;
  return message && 'text' in message ? message.text : '';
}

export function isAuthorizedUser(userId?: string | number | null): boolean {
  const normalizedUserId = normalizeUserId(userId);

  if (!normalizedUserId) {
    return false;
  }

  const allowedIds = getAllowedUserIds();
  return allowedIds.includes(normalizedUserId);
}

export function parseVideoRequest(rawText: string): VideoRequest {
  const input = rawText.replace(/\s+/g, ' ').trim();
  const minutesMatch = input.match(/(\d+)\s*(?:menit|min|minute|mins|m)/i);
  const secondsMatch = input.match(/(\d+)\s*(?:detik|sec|second|seconds|s)/i);

  const durationMinutes = minutesMatch
    ? Number.parseInt(minutesMatch[1], 10)
    : secondsMatch
      ? Math.max(1, Math.ceil(Number.parseInt(secondsMatch[1], 10) / 60))
      : 5;

  const aspectRatio: '16:9' | '9:16' = /portrait|reels|shorts|vertical|tiktok/i.test(input)
    ? '9:16'
    : '16:9';

  let topic = input
    .replace(/\/new|\/help|\/status|\/preview|\/retry|\/publish|\/history|\/cost|\/settings|\/cancel/gi, '')
    .replace(/(buat|buatkan|membuat|video|animasi|edukasi|3d|tentang|mengirimkan)/gi, ' ')
    .replace(/\b\d+\s*(?:menit|min|minute|mins|m)\b/gi, ' ')
    .replace(/\b(portrait|landscape|reels|shorts|tiktok|vertical)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const fallbackTopic = 'Sistem pendidikan dan pembelajaran interaktif';

  return {
    topic: topic || fallbackTopic,
    durationMinutes,
    aspectRatio,
    language: 'id',
    rawText: input
  };
}

/**
 * Creates the job and starts content generation without waiting for it, so the
 * Telegram handler returns quickly. The final message is sent when the run ends.
 * Error details stay in the logs and on the job document, not in the chat.
 */
async function startVideoJob(ctx: Context, userId: string, parsed: VideoRequest, intro: string): Promise<void> {
  const engine = getContentEngine();

  try {
    const job = await engine.createJob(userId, {
      topic: parsed.topic,
      title: parsed.topic,
      durationMinutes: parsed.durationMinutes,
      targetAudience: 'umum',
      difficultyLevel: 'dasar'
    });

    await ctx.reply(
      `${intro}\nID: ${job.jobId}\nTopik: ${parsed.topic}\nDurasi: ${parsed.durationMinutes} menit\nFormat: ${parsed.aspectRatio}\nKonten sedang dibuat, hasilnya akan dikirim di sini.`
    );

    await engine.submitContentJob({ jobId: job.jobId, userId }, async (outcome) => {
      if (outcome.ok) {
        const { content } = outcome;
        await ctx.reply(
          `✅ Konten AI selesai.\nJob ID: ${job.jobId}\nJudul: ${content.script.title}\nScene: ${content.storyboard.scenes.length}\nKarakter: ${content.characterBible.characters.length}\nDurasi estimasi: ${Math.ceil(content.script.totalEstimatedDurationSeconds / 60)} menit.`
        );
      } else {
        await ctx.reply(`⚠️ Pembuatan konten gagal untuk job ${job.jobId}. Detail ada di catatan job; coba lagi nanti.`);
      }
    });
  } catch (error) {
    if (error instanceof JobValidationError) {
      await ctx.reply(`⚠️ Permintaan tidak valid: ${error.message}`);
      return;
    }

    console.error('Failed to start video job from Telegram:', error instanceof Error ? error.message : error);
    await ctx.reply('⚠️ Job tidak dapat dimulai saat ini. Coba lagi nanti.');
  }
}

export function createTelegramBot() {
  const token = getTelegramBotToken();

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
  }

  const bot = new Telegraf(token);

  bot.start((ctx: Context) => {
    const userId = normalizeUserId(ctx.from?.id);

    if (!isAuthorizedUser(userId)) {
      return ctx.reply('Akses ditolak. User ID Anda belum diizinkan untuk menggunakan bot ini.');
    }

    return ctx.reply('AI Video Factory aktif. Kirim topik video atau gunakan perintah /new.');
  });

  bot.help((ctx: Context) => {
    const userId = normalizeUserId(ctx.from?.id);

    if (!isAuthorizedUser(userId)) {
      return ctx.reply('Akses ditolak.');
    }

    return ctx.reply([
      '/start — memulai bot',
      '/help — bantuan perintah',
      '/new — buat job video baru',
      '/status — cek status job',
      '/preview — pratinjau render',
      '/retry — ulang stage gagal',
      '/publish — kirim ke platform',
      '/settings — konfigurasi default',
      '/cancel — batalkan job',
      '/history — riwayat job',
      '/cost — ringkasan biaya'
    ].join('\n'));
  });

  bot.command('new', async (ctx: Context) => {
    const userId = normalizeUserId(ctx.from?.id);

    if (!isAuthorizedUser(userId)) {
      return ctx.reply('Akses ditolak.');
    }

    const verifiedUserId = resolveTelegramUserId(userId ?? undefined);
    if (!verifiedUserId) {
      return ctx.reply('Akun Telegram belum dipetakan ke identitas backend yang valid. Hubungi administrator untuk konfigurasi mapping user.');
    }

    const parsed = parseVideoRequest(getMessageText(ctx).replace(/^\/new\s*/i, ''));
    await startVideoJob(ctx, verifiedUserId, parsed, '✅ Job video dibuat.');
  });

  bot.command('status', (ctx: Context) => {
    const userId = normalizeUserId(ctx.from?.id);

    if (!isAuthorizedUser(userId)) {
      return ctx.reply('Akses ditolak.');
    }

    return ctx.reply('Status: job belum dimulai. Integrasi job runner akan dibuat pada fase berikutnya.');
  });

  bot.on('text', async (ctx: Context) => {
    const userId = normalizeUserId(ctx.from?.id);
    const text = getMessageText(ctx);

    if (!text || text.startsWith('/')) {
      return;
    }

    if (!isAuthorizedUser(userId)) {
      await ctx.reply('Akses ditolak.');
      return;
    }

    const verifiedUserId = resolveTelegramUserId(userId ?? undefined);
    if (!verifiedUserId) {
      await ctx.reply('Akun Telegram belum dipetakan ke identitas backend yang valid.');
      return;
    }

    await startVideoJob(ctx, verifiedUserId, parseVideoRequest(text), '📦 Request diterima.');
  });

  return bot;
}
