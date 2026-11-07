import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';

import { initializeFirebase } from '../lib/firebase.js';

export type VerifiedIdentity = { uid: string };

/** Verifies a Firebase ID token and returns the identity it proves. Throws if the token is not valid. */
export type VerifyIdToken = (idToken: string) => Promise<VerifiedIdentity>;

export class AuthUnavailableError extends Error {}

export const verifyFirebaseIdToken: VerifyIdToken = async (idToken) => {
  const state = initializeFirebase();
  if (!state.initialized || !state.app) {
    throw new AuthUnavailableError(state.reason ?? 'Firebase is not configured.');
  }

  const decoded = await getAuth(state.app).verifyIdToken(idToken);
  return { uid: decoded.uid };
};

export function extractBearerToken(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match ? match[1] : null;
}

/**
 * Requires `Authorization: Bearer <Firebase ID token>`. The caller's identity
 * comes only from the verified token, never from a request header or body, and
 * is exposed to handlers through `getAuthenticatedUserId`.
 */
export function createRequireAuth(verify: VerifyIdToken = verifyFirebaseIdToken): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = extractBearerToken(req.headers.authorization);
    if (!token) {
      res.status(401).json({ ok: false, message: 'A Firebase ID token is required (Authorization: Bearer <token>).' });
      return;
    }

    try {
      const identity = await verify(token);
      if (!identity.uid) {
        throw new Error('Token has no uid.');
      }
      res.locals.userId = identity.uid;
      next();
    } catch (error) {
      if (error instanceof AuthUnavailableError) {
        console.error('Authentication is unavailable:', error.message);
        res.status(503).json({ ok: false, message: 'Authentication is not available right now.' });
        return;
      }

      res.status(401).json({ ok: false, message: 'Invalid or expired Firebase ID token.' });
    }
  };
}

export function getAuthenticatedUserId(res: Response): string {
  const userId = res.locals.userId;
  if (typeof userId !== 'string' || !userId) {
    throw new Error('getAuthenticatedUserId was called on a route without requireAuth.');
  }
  return userId;
}
