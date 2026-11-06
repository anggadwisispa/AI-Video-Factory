import { describe, expect, it } from 'vitest';

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
});
