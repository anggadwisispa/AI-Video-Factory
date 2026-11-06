import express from 'express';

import { env } from './config/env.js';
import { testFirebaseConnection } from './lib/firebase.js';
import { createTelegramBot } from './lib/telegram.js';
import { generateContentForJob } from './services/content-engine.js';

const app = express();
app.use(express.json());

const bot = (() => {
  try {
    return createTelegramBot();
  } catch (error) {
    console.warn('Telegram bot is disabled:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
})();

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'ai-video-factory-api',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

app.get('/ready', async (_req, res) => {
  const firebaseStatus = await testFirebaseConnection();

  res.json({
    ok: firebaseStatus.ok,
    firebase: firebaseStatus,
    telegram: {
      enabled: Boolean(bot),
      allowlist: env.TELEGRAM_ALLOWED_USER_IDS || 'not configured'
    }
  });
});

app.post('/jobs/create', async (req, res) => {
  const { topic, durationMinutes, targetAudience, difficultyLevel, title } = req.body ?? {};
  const verifiedUserId = typeof req.headers['x-firebase-uid'] === 'string' ? req.headers['x-firebase-uid'] : undefined;

  if (!verifiedUserId) {
    res.status(401).json({ ok: false, message: 'A verified backend Firebase UID is required.' });
    return;
  }

  if (!topic || typeof topic !== 'string') {
    res.status(400).json({ ok: false, message: 'A valid topic is required.' });
    return;
  }

  const jobId = `job-${Date.now()}`;

  res.status(201).json({
    ok: true,
    jobId,
    userId: verifiedUserId,
    status: 'pending',
    topic,
    durationMinutes: Number(durationMinutes ?? 5),
    targetAudience: targetAudience ?? 'umum',
    difficultyLevel: difficultyLevel ?? 'dasar',
    title: title ?? topic
  });
});

app.post('/jobs/content', async (req, res) => {
  const { jobId, topic, durationMinutes, targetAudience, difficultyLevel, title } = req.body ?? {};
  const verifiedUserId = typeof req.headers['x-firebase-uid'] === 'string' ? req.headers['x-firebase-uid'] : undefined;

  if (!verifiedUserId) {
    res.status(401).json({ ok: false, message: 'A verified backend Firebase UID is required.' });
    return;
  }

  if (!jobId || !topic) {
    res.status(400).json({ ok: false, message: 'jobId and topic are required.' });
    return;
  }

  try {
    const result = await generateContentForJob({
      jobId,
      userId: verifiedUserId,
      verifiedUserId,
      topic,
      durationMinutes: Number(durationMinutes ?? 5),
      targetAudience,
      difficultyLevel,
      title
    });

    res.status(200).json({ ok: true, jobId, userId: verifiedUserId, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown content generation error';
    res.status(500).json({ ok: false, message });
  }
});

app.post('/telegram/webhook', async (req, res) => {
  const secretToken = req.headers['x-telegram-bot-api-secret-token'];

  if (env.TELEGRAM_WEBHOOK_SECRET && secretToken !== env.TELEGRAM_WEBHOOK_SECRET) {
    res.status(403).json({ ok: false, message: 'Webhook secret mismatch.' });
    return;
  }

  if (!bot) {
    res.status(503).json({ ok: false, message: 'Telegram bot not configured.' });
    return;
  }

  await bot.handleUpdate(req.body as never, req.rawHeaders as never);
  res.status(200).json({ ok: true });
});

const server = app.listen(env.PORT, async () => {
  console.log(`AI Video Factory API listening on port ${env.PORT}`);

  const firebaseStatus = await testFirebaseConnection();
  console.log(`Firebase status: ${firebaseStatus.message}`);

  if (bot) {
    try {
      await bot.launch();
      console.log('Telegram bot launched successfully.');
    } catch (error) {
      console.error('Telegram launch error:', error);
    }
  }
});

process.on('SIGINT', () => {
  server.close(() => {
    process.exit(0);
  });
});
