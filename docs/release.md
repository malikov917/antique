# Release Runbook

## Prerequisites
- Apple Developer account with App Store Connect access.
- Google Play Console app configured.
- EAS project configured and authenticated (`eas login`).
- Production signing credentials prepared in EAS.

## Build Commands
From repo root:

```bash
pnpm --filter @antique/mobile eas:build:ios:preview
pnpm --filter @antique/mobile eas:build:android:preview
```

For production:

```bash
pnpm --filter @antique/mobile eas:build:ios:production
pnpm --filter @antique/mobile eas:build:android:production
```

## Submit Commands
```bash
pnpm --filter @antique/mobile eas:submit:ios
pnpm --filter @antique/mobile eas:submit:android
```

## Required Release Gate
Before production submit:
1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`
4. Manual smoke test on iOS + Android preview build.
5. Validate reels feed startup latency and swipe smoothness.

## Delivery Policy
- First external delivery is internal tracks only:
  - TestFlight (internal testers)
  - Google Play internal testing
- Promote to production only after performance gate is green.

