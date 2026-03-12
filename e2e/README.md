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

## iOS Role Screen Audit (guest + buyer + seller)
- Runner: `pnpm ensure:screen-audit:ios`
- Flows:
  - `e2e/maestro/ios-screen-audit-guest.yaml`
  - `e2e/maestro/ios-screen-audit-buyer.yaml`
  - `e2e/maestro/ios-screen-audit-seller.yaml`
- Purpose:
  - provisions buyer/seller/admin accounts in local API,
  - seeds persistent SQLite marketplace data (listings, offers, accepted deal, chat, notifications, announcements),
  - approves seller application via admin API,
  - runs deterministic tab walkthroughs for guest/buyer/seller with screenshots.
- Artifacts:
  - `state/runs/ios-role-screen-audit/<timestamp>/artifacts`
  - `state/runs/ios-role-screen-audit/<timestamp>/tokens.env`
  - `state/runs/ios-role-screen-audit/<timestamp>/seed-summary.md`
- Notes:
  - DB is persistent by default (`apps/api/data/antique.sqlite`).
  - Set `RESET_DB=1` to reseed from a clean database.

## Android Tab Walkthrough (selector-based)
- Flow file: `e2e/maestro/android-tab-walkthrough.yaml`
- Purpose: verifies deterministic tab navigation selectors and feed updates CTA behavior on Android.

## Covered Steps
1. Launch Expo Go.
2. Open current Metro dev URL.
3. Assert reels screen is visible.
4. Assert first reel video view exists.
5. Swipe to next reel and assert second video view exists.
6. Open upload sheet and assert upload flow container exists.
