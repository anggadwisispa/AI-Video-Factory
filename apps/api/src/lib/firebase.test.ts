import { describe, expect, it } from 'vitest';

import { initializeFirebase } from './firebase.js';

describe('initializeFirebase', () => {
  it('returns a disabled state when required Firebase credentials are missing', async () => {
    const state = initializeFirebase();

    expect(state.initialized).toBe(false);
    expect(state.reason).toContain('Missing Firebase environment variables');
  });
});
