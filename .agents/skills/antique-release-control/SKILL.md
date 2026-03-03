---
name: antique-release-control
description: Gate iOS/Android builds and store submissions through EAS with repeatable release steps.
---

# Antique Release Control

## Build Targets
- iOS preview
- Android preview
- iOS production
- Android production

## Required Gating
1. CI checks pass (`lint`, `typecheck`, `test`).
2. Reels feed smoke test on both platforms.
3. Upload flow smoke test.
4. Release notes and rollout scope posted in Linear.

## Commands
- `pnpm --filter @antique/mobile eas:build:ios:preview`
- `pnpm --filter @antique/mobile eas:build:android:preview`
- `pnpm --filter @antique/mobile eas:submit:ios`
- `pnpm --filter @antique/mobile eas:submit:android`

