import { describe, expect, it } from 'vitest';

import { validateJobId, validateVerifiedUserId } from './content-engine.js';

describe('content engine ownership validation', () => {
  it('accepts a valid user uid and job id', () => {
    expect(validateVerifiedUserId('firebase-user-101')).toBe('firebase-user-101');
    expect(validateJobId('job-123')).toBe('job-123');
  });

  it('rejects invalid uid values and malformed job ids', () => {
    expect(() => validateVerifiedUserId('')).toThrow('A valid verified Firebase UID is required');
    expect(() => validateJobId('invalid')).toThrow('Invalid jobId format');
  });
});
