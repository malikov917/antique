# Mobile E2E Smoke

## iOS Happy Path
- Flow file: `e2e/maestro/ios-reels-happy-path.yaml`
- Runner: `pnpm ensure:happy-path`

## Android Happy Path
- Flow file: `e2e/maestro/android-reels-happy-path.yaml`
- Runner: `pnpm ensure:happy-path:android`
- Optional auto-boot: set `ANDROID_AVD_NAME=<your-avd-name>` to let the script start an emulator.

## iOS Tab Walkthrough (selector-based)
- Flow file: `e2e/maestro/ios-tab-walkthrough.yaml`
- Purpose: verifies deterministic tab navigation selectors and feed updates CTA behavior.

## Covered Steps
1. Launch Expo Go.
2. Open current Metro dev URL.
3. Assert reels screen is visible.
4. Assert first reel video view exists.
5. Swipe to next reel and assert second video view exists.
6. Open upload sheet and assert upload flow container exists.
