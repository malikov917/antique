# Antique

Agent-first monorepo for a cross-platform reels-style antique marketplace MVP.

## Stack
- Mobile: Expo + React Native + TypeScript
- API: Fastify + Mux direct upload and streaming
- Shared contracts: `packages/types`
- Delivery tracking: Linear (`Antique` team)

## Quick Start
1. Copy environment values:
   - `cp .env.example apps/api/.env`
   - `cp .env.example apps/mobile/.env`
2. Install dependencies:
   - `pnpm install`
3. Run API:
   - `pnpm dev:api`
4. Run mobile app:
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

## Repository Layout
- `apps/mobile`: Expo app with reels feed and upload flow
- `apps/api`: Fastify API (`/v1/uploads`, `/v1/feed`, `/v1/webhooks/mux`)
- `packages/types`: shared API and domain TypeScript contracts
- `.agents/skills`: project-local reusable skills
- `.github/workflows`: CI
- `docs`: release and operating docs
