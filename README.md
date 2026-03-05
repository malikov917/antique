# Antique

Agent-first monorepo for a cross-platform reels-style antique marketplace MVP.

## Stack
- Mobile: Expo + React Native + TypeScript
- API: Fastify + Mux direct upload and streaming
- Auth: Phone OTP + JWT sessions (SQLite)
- Shared contracts: `packages/types`
- Delivery tracking: Linear (`Antique` team)

## Quick Start
1. Define product intent in:
   - `PRODUCT.md`
2. Copy environment values:
   - `cp .env.example apps/api/.env`
   - `cp .env.example apps/mobile/.env`
3. Install dependencies:
   - `pnpm install`
4. Run API:
   - `pnpm dev:api`
5. Run mobile app:
   - `pnpm dev:mobile`

## Mux Encoding Policy (API)
- Direct uploads create assets with explicit Mux settings:
  - `max_resolution_tier=1080p`
  - `video_quality=plus`
  - `playback_policy=["public"]`
- Policy values can be overridden with:
  - `MUX_MAX_RESOLUTION_TIER` (`1080p`, `1440p`, `2160p`)
  - `MUX_VIDEO_QUALITY` (`basic`, `plus`, `premium`)
- Playback contract remains unchanged:
  - `https://stream.mux.com/{playbackId}.m3u8`
- Delivery remains adaptive by network speed via HLS ABR; clients receive lower or higher renditions up to the configured max tier.

## API Secrets (Local)
- Keep real Mux credentials in `apps/api/.env` (gitignored).
- Required for upload routes and real integration test:
  - `MUX_TOKEN_ID`
  - `MUX_TOKEN_SECRET`
- Required for auth routes (dev defaults exist, override in cloud):
  - `AUTH_JWT_SECRET`
  - `AUTH_HASH_SECRET`
- Optional:
  - `MUX_WEBHOOK_SECRET`
  - `MUX_MAX_RESOLUTION_TIER` (default `1080p`)
  - `MUX_VIDEO_QUALITY` (default `plus`)
  - `API_DB_PATH` (default `apps/api/data/antique.sqlite`)
- Upload endpoints fail fast with `503` when token credentials are missing:
  - `POST /v1/uploads`
  - `GET /v1/uploads/:uploadId`

## Quality Gates
- `./scripts/check.sh`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:integration` (real Mux upload/stream regression)

## Real Mux Integration Test
- Command: `pnpm test:integration`
- Scope:
  - creates a real direct upload,
  - uploads `apps/api/test/fixtures/smoke.mp4`,
  - polls upload status until `ready`,
  - validates feed exposure,
  - downloads `https://stream.mux.com/{playbackId}.m3u8`,
  - downloads first media segment from the playlist chain,
  - deletes created Mux asset during cleanup.
- Notes:
  - This test intentionally uses real cloud resources and can take a few minutes.
  - Missing/invalid credentials will fail the test run.

## Local Build + Run + Verify
- `pnpm ensure:local`
- This command runs:
  - lint + typecheck + tests (`pnpm check`)
  - API build (`pnpm build`)
  - API runtime smoke (`/health` and `/v1/feed`)
  - mobile runtime smoke (Expo/Metro boot check via `/status`)
- Optional environment variables:
  - `API_PORT` (default `4000`)
  - `MOBILE_PORT` (default `8081`)

## Mobile Happy-Path Smoke (Gesture + UI)
- `pnpm ensure:happy-path`
- What it validates on iOS simulator (via Maestro):
  - app opens into reels screen,
  - first reel video container is visible,
  - swipe up advances to next reel,
  - upload sheet opens from `Upload` button.
- Prerequisites:
  - iOS simulator booted,
  - Expo Go installed in simulator (`host.exp.Exponent`),
  - Maestro installed locally.
- Optional overrides:
  - `EXPO_DEV_URL` (default `exp://127.0.0.1:8081`)
  - `MAESTRO_FLOW_PATH` (default `e2e/maestro/ios-reels-happy-path.yaml`)
  - `SKIP_CHECK=1` to skip lint/typecheck/test when iterating locally.

## Android Happy-Path Smoke (Gesture + UI)
- `pnpm ensure:happy-path:android`
- What it validates on Android emulator/device (via Maestro):
  - app opens into reels screen,
  - first reel video container is visible,
  - swipe up advances to next reel,
  - upload sheet opens from `Upload` button.
- Prerequisites:
  - Android device/emulator connected (`adb devices` shows `device`),
  - Expo Go installed on device/emulator (`host.exp.exponent`),
  - Maestro installed locally.
- Optional overrides:
  - `ANDROID_DEVICE_ID` to force a specific adb device
  - `ANDROID_AVD_NAME` to auto-start an emulator when none is running
  - `EXPO_DEV_URL` (default `exp://10.0.2.2:8081`)
  - `MAESTRO_FLOW_PATH` (default `e2e/maestro/android-reels-happy-path.yaml`)
  - `SKIP_CHECK=1` to skip lint/typecheck/test when iterating locally.

## Both Platforms Happy-Path
- `pnpm ensure:happy-path:all`

## Repository Layout
- `apps/mobile`: Expo app with reels feed and upload flow
- `apps/api`: Fastify API (`/v1/uploads`, `/v1/feed`, `/v1/webhooks/mux`)
- `packages/types`: shared API and domain TypeScript contracts
- `.agents/skills`: project-local reusable skills
- `.github/workflows`: CI
- `docs`: release and operating docs
