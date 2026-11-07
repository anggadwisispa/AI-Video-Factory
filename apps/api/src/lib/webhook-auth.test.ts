import { describe, expect, it } from 'vitest';

import { isValidWebhookSecret } from './webhook-auth.js';

describe('isValidWebhookSecret', () => {
  it('accepts only the exact configured secret', () => {
    expect(isValidWebhookSecret('s3cret-value', 's3cret-value')).toBe(true);
    expect(isValidWebhookSecret('s3cret-valuE', 's3cret-value')).toBe(false);
    expect(isValidWebhookSecret('s3cret', 's3cret-value')).toBe(false);
    expect(isValidWebhookSecret('s3cret-value-and-more', 's3cret-value')).toBe(false);
  });

  it('fails closed when no secret is configured, even if the request sends none', () => {
    expect(isValidWebhookSecret(undefined, undefined)).toBe(false);
    expect(isValidWebhookSecret('', '')).toBe(false);
    expect(isValidWebhookSecret('anything', undefined)).toBe(false);
    expect(isValidWebhookSecret(undefined, '')).toBe(false);
  });

  it('rejects a missing or non-string header value', () => {
    expect(isValidWebhookSecret(undefined, 's3cret')).toBe(false);
    expect(isValidWebhookSecret('', 's3cret')).toBe(false);
    expect(isValidWebhookSecret(['s3cret'], 's3cret')).toBe(false);
  });
});
