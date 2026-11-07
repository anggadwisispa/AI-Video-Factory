import express, { type Response } from 'express';

import { env, getAllowedUserIds } from './config/env.js';
import { testFirebaseConnection } from './lib/firebase.js';
import { createTelegramBot } from './lib/telegram.js';
import { isValidWebhookSecret } from './lib/webhook-auth.js';
import { createRequireAuth, getAuthenticatedUserId } from './middleware/auth.js';
import {
  getContentEngine,
  JobConflictError,
  JobNotFoundError,
  JobValidationError,
  ServiceConfigError,
  type StoredJob
} from './services/content-engine.js';

const app = express();
app.use(express.json());

const requireAuth = createRequireAuth();

const bot = (() => {
  try {
    return createTelegramBot();
  } catch (error) {
    console.warn('Telegram bot is disabled:', error instanceof Error ? error.message : 'Unknown error');
    return null;
  }
})();

function publicJob(job: StoredJob) {
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    error: job.error,
    topic: job.topic,
    title: job.title ?? job.topic,
    durationMinutes: job.durationMinutes,
    targetAudience: job.targetAudience,
    difficultyLevel: job.difficultyLevel,
    createdAt: new Date(job.createdAtMs).toISOString(),
    updatedAt: new Date(job.updatedAtMs).toISOString()
  };
}

function sendJobError(res: Response, error: unknown) {
  if (error instanceof JobValidationError) {
    res.status(400).json({ ok: false, message: error.message });
  } else if (error instanceof JobNotFoundError) {
    // Also returned for jobs owned by someone else, so ids cannot be probed.
    res.status(404).json({ ok: false, message: 'Job not found.' });
  } else if (error instanceof JobConflictError) {
    res.status(409).json({ ok: false, message: error.message, status: error.status });
  } else if (error instanceof ServiceConfigError) {
    console.error('Content generation is not configured:', error.message);
    res.status(503).json({ ok: false, message: 'Content generation is not available right now.' });
  } else {
    console.error('Unexpected job error:', error);
    res.status(500).json({ ok: false, message: 'Internal server error.' });
  }
}

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

  // Unauthenticated: report that the allowlist is configured, never who is on it.
  res.json({
    ok: firebaseStatus.ok,
    firebase: firebaseStatus,
    telegram: {
      enabled: Boolean(bot),
      allowlistConfigured: getAllowedUserIds().length > 0
    }
  });
});

// Creates the job record only. Nothing is generated until POST /jobs/content.
app.post('/jobs/create', requireAuth, async (req, res) => {
  try {
    const job = await getContentEngine().createJob(getAuthenticatedUserId(res), req.body);
    res.status(201).json({ ok: true, ...publicJob(job) });
  } catch (error) {
    sendJobError(res, error);
  }
});

// Starts content generation for a job the caller owns and returns at once (202).
// Poll GET /jobs/:jobId for status ('researching' ... 'content_ready' or 'failed').
app.post('/jobs/content', requireAuth, async (req, res) => {
  const jobId = typeof req.body?.jobId === 'string' ? req.body.jobId : '';

  try {
    const job = await getContentEngine().submitContentJob({
      jobId,
      userId: getAuthenticatedUserId(res)
    });
    res.status(202).json({ ok: true, ...publicJob(job) });
  } catch (error) {
    sendJobError(res, error);
  }
});

app.get('/jobs/:jobId', requireAuth, async (req, res) => {
  try {
    const job = await getContentEngine().getJob(String(req.params.jobId), getAuthenticatedUserId(res));
    res.json({ ok: true, ...publicJob(job) });
  } catch (error) {
    sendJobError(res, error);
  }
});

app.post('/telegram/webhook', async (req, res) => {
  // Fail closed: without a configured secret nobody can prove a request came from Telegram.
  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    res.status(503).json({ ok: false, message: 'Telegram webhook is not configured.' });
    return;
  }

  if (!isValidWebhookSecret(req.headers['x-telegram-bot-api-secret-token'], env.TELEGRAM_WEBHOOK_SECRET)) {
    res.status(403).json({ ok: false, message: 'Webhook secret mismatch.' });
    return;
  }

  if (!bot) {
    res.status(503).json({ ok: false, message: 'Telegram bot not configured.' });
    return;
  }

  try {
    await bot.handleUpdate(req.body as never);
    res.status(200).json({ ok: true });
  } catch (error) {
    // Express 4 does not catch async errors; an unhandled rejection would stop the process.
    console.error('Telegram update failed:', error instanceof Error ? error.message : error);
    res.status(500).json({ ok: false, message: 'Update handling failed.' });
  }
});

const server = app.listen(env.PORT, async () => {
  console.log(`AI Video Factory API listening on port ${env.PORT}`);

  if (!env.TELEGRAM_WEBHOOK_SECRET) {
    console.warn('TELEGRAM_WEBHOOK_SECRET is not set: /telegram/webhook rejects every request.');
  }

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
