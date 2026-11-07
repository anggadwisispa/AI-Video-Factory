import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { AuthUnavailableError, createRequireAuth, extractBearerToken, getAuthenticatedUserId } from './auth.js';

async function run(headers: Record<string, string>, verify: Parameters<typeof createRequireAuth>[0]) {
  const res = {
    locals: {} as Record<string, unknown>,
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    }
  };
  const next = vi.fn();

  await createRequireAuth(verify)({ headers } as unknown as Request, res as unknown as Response, next);
  return { res, next };
}

describe('extractBearerToken', () => {
  it('reads a Bearer token and rejects anything else', () => {
    expect(extractBearerToken('Bearer abc.def')).toBe('abc.def');
    expect(extractBearerToken('bearer abc')).toBe('abc');
    expect(extractBearerToken('Basic abc')).toBeNull();
    expect(extractBearerToken('Bearer')).toBeNull();
    expect(extractBearerToken('Bearer a b')).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
  });
});

describe('requireAuth', () => {
  it('rejects a request with no token without calling the verifier', async () => {
    const verify = vi.fn();
    const { res, next } = await run({}, verify);

    expect(res.statusCode).toBe(401);
    expect(verify).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('ignores a spoofed x-firebase-uid header: identity comes only from the verified token', async () => {
    const verify = vi.fn().mockResolvedValue({ uid: 'real-user' });
    const { res, next } = await run({ authorization: 'Bearer good-token', 'x-firebase-uid': 'victim' }, verify);

    expect(verify).toHaveBeenCalledWith('good-token');
    expect(next).toHaveBeenCalledOnce();
    expect(getAuthenticatedUserId(res as unknown as Response)).toBe('real-user');
  });

  it('rejects an x-firebase-uid header on its own', async () => {
    const verify = vi.fn();
    const { res, next } = await run({ 'x-firebase-uid': 'victim' }, verify);

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('answers 401 for an invalid or expired token', async () => {
    const { res, next } = await run(
      { authorization: 'Bearer bad' },
      vi.fn().mockRejectedValue(new Error('verifier-internal-detail-7f3a'))
    );

    expect(res.statusCode).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('verifier-internal-detail-7f3a');
    expect(next).not.toHaveBeenCalled();
  });

  it('answers 503, not 401, when Firebase cannot verify anything', async () => {
    const { res, next } = await run(
      { authorization: 'Bearer anything' },
      vi.fn().mockRejectedValue(new AuthUnavailableError('Missing Firebase environment variables'))
    );

    expect(res.statusCode).toBe(503);
    expect(JSON.stringify(res.body)).not.toContain('Missing Firebase');
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a verified token that carries no uid', async () => {
    const { res, next } = await run({ authorization: 'Bearer t' }, vi.fn().mockResolvedValue({ uid: '' }));

    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
});
