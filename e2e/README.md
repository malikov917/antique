# Mobile E2E Smoke

## iOS Happy Path
- Flow file: `e2e/maestro/ios-reels-happy-path.yaml`
- Runner: `pnpm ensure:happy-path`

## Covered Steps
1. Launch Expo Go.
2. Open current Metro dev URL.
3. Assert reels screen is visible.
4. Assert first reel video view exists.
5. Swipe to next reel and assert second video view exists.
6. Open upload sheet and assert upload flow container exists.
