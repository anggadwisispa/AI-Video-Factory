import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

import { env, getFirebaseConfigStatus } from '../config/env.js';

export type FirebaseServiceState = {
  initialized: boolean;
  app?: App;
  reason?: string;
};

let firebaseSingleton: App | undefined;

export function initializeFirebase(): FirebaseServiceState {
  if (firebaseSingleton) {
    return { initialized: true, app: firebaseSingleton };
  }

  const { configured, missing } = getFirebaseConfigStatus();

  if (!configured) {
    return {
      initialized: false,
      reason: `Missing Firebase environment variables: ${missing.join(', ')}`
    };
  }

  const privateKey = (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n').trim();

  try {
    firebaseSingleton = getApps().length > 0
      ? getApps()[0]
      : initializeApp({
          credential: cert({
            projectId: env.FIREBASE_PROJECT_ID,
            clientEmail: env.FIREBASE_CLIENT_EMAIL,
            privateKey
          }),
          storageBucket: env.FIREBASE_STORAGE_BUCKET
        });

    return {
      initialized: true,
      app: firebaseSingleton
    };
  } catch (error) {
    return {
      initialized: false,
      reason: error instanceof Error ? error.message : 'Firebase initialization failed.'
    };
  }
}

export async function testFirebaseConnection(): Promise<{ ok: boolean; message: string }> {
  const state = initializeFirebase();

  if (!state.initialized || !state.app) {
    return {
      ok: false,
      message: state.reason ?? 'Firebase is not configured.'
    };
  }

  try {
    const db: Firestore = getFirestore(state.app);
    await db.collection('video_jobs').limit(1).get();
    return {
      ok: true,
      message: 'Firebase Firestore connection is healthy.'
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown Firebase error';
    return {
      ok: false,
      message: `Firebase connection failed: ${reason}`
    };
  }
}

export function getFirebaseStorage() {
  const state = initializeFirebase();

  if (!state.initialized || !state.app) {
    throw new Error(state.reason ?? 'Firebase is not configured.');
  }

  return getStorage(state.app);
}
