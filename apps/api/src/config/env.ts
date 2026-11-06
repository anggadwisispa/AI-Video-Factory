import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_ALLOWED_USER_IDS: z.string().default(''),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  MAX_VIDEO_BUDGET_USD: z.coerce.number().default(75),
  MAX_RETRY_COUNT: z.coerce.number().default(3),
  PREFERRED_VIDEO_PROVIDER: z.string().default('gemini'),
  PREFERRED_QUALITY: z.string().default('high')
});

export const env = envSchema.parse(process.env);

export function getAllowedUserIds(): string[] {
  return env.TELEGRAM_ALLOWED_USER_IDS
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function getTelegramBotToken(): string | undefined {
  return env.TELEGRAM_BOT_TOKEN?.trim() || undefined;
}

export function getFirebaseConfigStatus(): { configured: boolean; missing: string[] } {
  const missing: string[] = [];

  if (!env.FIREBASE_PROJECT_ID) missing.push('FIREBASE_PROJECT_ID');
  if (!env.FIREBASE_CLIENT_EMAIL) missing.push('FIREBASE_CLIENT_EMAIL');
  if (!env.FIREBASE_PRIVATE_KEY) missing.push('FIREBASE_PRIVATE_KEY');
  if (!env.FIREBASE_STORAGE_BUCKET) missing.push('FIREBASE_STORAGE_BUCKET');

  return {
    configured: missing.length === 0,
    missing
  };
}
