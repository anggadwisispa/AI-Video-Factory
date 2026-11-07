import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compares the secret Telegram sends in `X-Telegram-Bot-Api-Secret-Token` with
 * the configured one. Fails closed: an unset or empty expected secret never
 * matches, so a missing configuration cannot turn the webhook into an open door.
 */
export function isValidWebhookSecret(provided: unknown, expected: string | undefined): boolean {
  if (!expected || typeof provided !== 'string' || !provided) {
    return false;
  }

  // Hash both sides so the comparison is constant-time and length-independent.
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
