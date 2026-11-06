# AI Video Factory

AI Video Factory is a production-oriented monorepo for creating automated, Telegram-driven, 3D educational and tutorial videos. The project is designed to orchestrate research, script generation, storyboard planning, AI video generation, narration, rendering, and delivery in a repeatable pipeline.

## Current status

This repository includes the completed Phase 1 foundation and the Phase 2 AI content generation engine: topic analysis, research generation, Indonesian scripts, storyboard generation, character bible creation, visual prompt generation, Firebase persistence hooks, and Telegram job pipeline integration.

## Architecture

- apps/api — Express.js API and Telegram bot entrypoint
- packages/shared — reusable types and config helpers
- packages/ai-content — research and educational content generation
- packages/video-providers — abstraction for Gemini and alternative video providers
- packages/voice-engine — ElevenLabs integration
- packages/rendering-engine — Creatomate and FFmpeg orchestration
- packages/publishing — social platform adapters
- packages/firebase — Firebase Firestore and Storage utilities
- workflows/n8n — workflow templates for automation orchestration
- firebase — Firestore and Storage security rules

## Required credentials

The application requires real credentials before any production features can run. At a minimum, you must provide:

- TELEGRAM_BOT_TOKEN
- TELEGRAM_WEBHOOK_SECRET
- TELEGRAM_ALLOWED_USER_IDS
- FIREBASE_PROJECT_ID
- FIREBASE_CLIENT_EMAIL
- FIREBASE_PRIVATE_KEY
- FIREBASE_STORAGE_BUCKET
- OPENAI_API_KEY
- GOOGLE_GEMINI_API_KEY (or your provider equivalent)
- ELEVENLABS_API_KEY
- CREATOMATE_API_KEY

Copy .env.example to .env and fill in the values before running the app.

## Available commands

Install Node.js 22 LTS first. The workspace in this editor does not currently expose a Node/npm runtime, so local validation must be run from a machine with Node installed.

```bash
npm install
npm run test
npm run typecheck
npm run dev
```

## Phase 1 completed

- workspace initialization
- TypeScript base configuration
- Firebase Admin bootstrap with graceful no-credential fallback
- Telegram bot service with allowlist validation and command parsing
- health checks and validation smoke tests

## Phase 2 completed

- reusable OpenAI service with structured JSON validation
- topic analysis engine
- research engine with verification notes and uncertainty flags
- Indonesian educational script generation
- storyboard generation per scene
- character bible production
- scene prompt generation for 3D animation
- Firebase persistence for jobs, scenes, and characters
- Telegram workflow integration for /new and natural-language requests

## Firebase architecture

Firestore collections used by the backend:

- video_jobs/{jobId}
- video_scenes/{sceneId}
- characters/{characterId}
- research/{researchId}
- scripts/{scriptId}
- storyboards/{storyboardId}
- usage/{usageId}

Every child document includes `jobId`, `userId`, `createdAt`, and `updatedAt`. Job records also include `topic`, `status`, `progress`, and `error`.

Storage layout:

- characters/{jobId}/{characterId}/
- storyboards/{jobId}/
- scenes/{jobId}/{sceneId}/
- audio/{jobId}/
- subtitles/{jobId}/
- renders/{jobId}/

## Firebase emulator

```bash
firebase emulators:start --only firestore,storage
```

## Example AI content payload

```json
{
  "topicAnalysis": {
    "topicTitle": "Cara kerja jantung manusia",
    "category": "Biologi",
    "learningObjectives": ["Memahami fungsi pompa jantung"],
    "targetAudience": "pelajar SMA",
    "keyConcepts": ["sistol", "diastol", "sirkulasi"],
    "recommendedDurationMinutes": 5,
    "suggestedEducationalApproach": "visual 3D dengan analogi sederhana"
  },
  "script": {
    "title": "Cara kerja jantung manusia",
    "language": "id",
    "narrationSections": [
      { "section": "opening", "title": "Hook", "narration": "Jantung bekerja tanpa henti...", "estimatedDurationSeconds": 25 }
    ],
    "totalEstimatedDurationSeconds": 180,
    "summary": "Jantung memompa darah ke seluruh tubuh."
  }
}
```

## Next phases

1. Add AI video generation provider adapters
2. Add ElevenLabs voice generation and waveform validation
3. Integrate Creatomate rendering and FFmpeg checks
4. Add Telegram progress tracking and final delivery
5. Add social media publisher integrations
6. Harden Docker deployment and production docs

## Security note

Do not commit .env files or expose secrets in logs or Telegram responses.
