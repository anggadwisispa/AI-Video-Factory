import { afterEach, describe, expect, it, vi } from 'vitest';

import { isAuthorizedUser, parseVideoRequest } from './telegram.js';

describe('parseVideoRequest', () => {
  it('extracts a topic, duration, and Indonesian context from a natural-language request', () => {
    const request = parseVideoRequest('Buatkan video edukasi 3 menit tentang cara kerja jantung manusia');

    expect(request.language).toBe('id');
    expect(request.durationMinutes).toBe(3);
    expect(request.topic.toLowerCase()).toContain('jantung');
    expect(request.aspectRatio).toBe('16:9');
  });

  it('uses portrait mode for short-form vertical content', () => {
    const request = parseVideoRequest('Buat video reels 45 detik tentang sistem pencernaan');

    expect(request.durationMinutes).toBe(1);
    expect(request.aspectRatio).toBe('9:16');
  });
});

describe('isAuthorizedUser', () => {
  it('rejects users outside the configured allowlist', () => {
    expect(isAuthorizedUser('user-999')).toBe(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('resolves a Telegram user to a verified backend UID through the configured mapping', async () => {
    // `env` is parsed once when the module loads, so the variable must be set before importing it.
    vi.resetModules();
    vi.stubEnv('TELEGRAM_USER_MAPPING', '123456=firebase-user-123');
    const { resolveTelegramUserId } = await import('../config/env.js');

    expect(resolveTelegramUserId('123456')).toBe('firebase-user-123');
    expect(resolveTelegramUserId('999')).toBeUndefined();
  });
});
