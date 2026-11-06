import { describe, expect, it } from 'vitest';

import { getFirebaseConfigStatus } from './env.js';

describe('getFirebaseConfigStatus', () => {
  it('detects missing Firebase environment variables when they are not configured', () => {
    const status = getFirebaseConfigStatus();

    expect(status.configured).toBe(false);
    expect(status.missing).toContain('FIREBASE_PROJECT_ID');
    expect(status.missing).toContain('FIREBASE_PRIVATE_KEY');
  });
});
