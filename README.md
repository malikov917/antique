# Antique

Agent-first monorepo for a cross-platform reels-style antique marketplace MVP.

## Stack
- Mobile: Expo + React Native + TypeScript
- API: Fastify + Mux direct upload and streaming
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

## Quality Gates
- `./scripts/check.sh`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`

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

## Repository Layout
- `apps/mobile`: Expo app with reels feed and upload flow
- `apps/api`: Fastify API (`/v1/uploads`, `/v1/feed`, `/v1/webhooks/mux`)
- `packages/types`: shared API and domain TypeScript contracts
- `.agents/skills`: project-local reusable skills
- `.github/workflows`: CI
- `docs`: release and operating docs
