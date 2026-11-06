import { Telegraf, type Context } from 'telegraf';

import { env, getAllowedUserIds, getTelegramBotToken, resolveTelegramUserId } from '../config/env.js';
import { generateContentForJob } from '../services/content-engine.js';

export type VideoRequest = {
  topic: string;
  durationMinutes: number;
  aspectRatio: '16:9' | '9:16';
  language: 'id';
  rawText: string;
};

export function normalizeUserId(input?: string | number): string | null {
  if (input === undefined || input === null) {
    return null;
  }

  return String(input);
}

export function isAuthorizedUser(userId?: string | number): boolean {
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

    const text = ctx.message?.text ?? '';
    const parsed = parseVideoRequest(text.replace(/^\/new\s*/i, ''));
    const jobId = `job-${Date.now()}`;

    await ctx.reply(
      `✅ Job video dibuat.\nID: ${jobId}\nTopik: ${parsed.topic}\nDurasi: ${parsed.durationMinutes} menit\nFormat: ${parsed.aspectRatio}`
    );

    try {
      const result = await generateContentForJob({
        jobId,
        userId: verifiedUserId,
        verifiedUserId,
        topic: parsed.topic,
        durationMinutes: parsed.durationMinutes,
        targetAudience: 'umum',
        difficultyLevel: 'dasar',
        title: parsed.topic
      });

      await ctx.reply(
        `📚 Konten AI sudah diproses.\nJob ID: ${jobId}\nJudul: ${result.script.title}\nStatus: script, storyboard, dan karakter bible tersimpan.\nDurasi estimasi: ${Math.ceil(result.script.totalEstimatedDurationSeconds / 60)} menit.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await ctx.reply(`⚠️ Gagal menghasilkan konten AI untuk job ${jobId}.\nDetail: ${message}`);
    }
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
    const text = ctx.message?.text ?? '';

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

    const parsed = parseVideoRequest(text);
    const jobId = `job-${Date.now()}`;

    await ctx.reply(
      `📦 Request diterima.\nJob ID: ${jobId}\nTopik: ${parsed.topic}\nDurasi: ${parsed.durationMinutes} menit\nAspek: ${parsed.aspectRatio}`
    );

    try {
      const result = await generateContentForJob({
        jobId,
        userId: verifiedUserId,
        verifiedUserId,
        topic: parsed.topic,
        durationMinutes: parsed.durationMinutes,
        targetAudience: 'umum',
        difficultyLevel: 'dasar',
        title: parsed.topic
      });

      await ctx.reply(
        `✅ Pipeline konten AI selesai.\nJob ID: ${jobId}\nJudul: ${result.script.title}\nScene: ${result.storyboard.scenes.length}\nKarakter: ${result.characterBible.characters.length}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await ctx.reply(`⚠️ Proses pembuatan konten gagal.\n${message}`);
    }
  });

  return bot;
}
