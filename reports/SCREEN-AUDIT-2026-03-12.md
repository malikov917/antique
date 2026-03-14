# iOS Screen Audit — 2026-03-12

Run target: `origin/main` (`d83240b`) in `/Users/kanstantsinmalikau/.codex/worktrees/57e2/antique-main-audit`

Latest audit run artifacts:
- `/Users/kanstantsinmalikau/.codex/worktrees/57e2/antique-main-audit/state/runs/ios-role-screen-audit/20260312-231619/artifacts`
- `/Users/kanstantsinmalikau/.codex/worktrees/57e2/antique-main-audit/state/runs/ios-role-screen-audit/20260312-231619/logs`
- Seed summary: `/Users/kanstantsinmalikau/.codex/worktrees/57e2/antique-main-audit/state/runs/ios-role-screen-audit/20260312-231619/seed-summary.md`
- Latest seeded token snapshot: `/Users/kanstantsinmalikau/.codex/worktrees/57e2/antique-main-audit/state/seed-users-latest.env`

## Dataset seeded (persistent SQLite)
- 4 users: buyer, buyer2, seller, admin.
- Seller lifecycle: application + admin approval + seller role switch.
- Marketplace: one market session, three listings.
- Commerce: three offers (accepted/declined mix), one completed deal.
- Chat: deal thread with buyer/seller messages.
- Fulfillment: address correction request + approval.
- Notifications/announcements: offer decisions, correction events, market close, announcement.

Persistence:
- Marketplace/auth data is persisted in `apps/api/data/antique.sqlite`.
- Feed reels are still startup demo playback IDs (not DB-backed listing/video entities yet).

## Role-by-role findings

### Guest
Working:
- Guest lands on dedicated auth screen (`/auth`) first.
- Feed/Inbox/Activity/Profile tabs are blocked until authentication.
- Login/register copy is explicit and visible.

Missing/weak:
- OTP helper UX is still developer-oriented (reads OTP from API logs).

### Buyer
Working:
- Feed renders and **does not show Upload button** for buyer role.
- Inbox shows populated deal card, address state, and latest message.
- Activity shows seeded operational timeline.
- Profile is now account-focused (user data, role state, seller application), not mixed with login flow.

Missing/weak:
- Inbox still lacks dedicated threaded chat detail screen in current mobile flow.

### Seller
Working:
- Feed renders and shows Upload button only for seller role.
- Inbox and Activity reflect seller-side seeded events.
- Profile seller controls remain available (role + seller application state).

Missing/weak:
- Seller operations are still spread across feed/activity/profile; no dedicated seller control center screen yet.

## Visual quality notes
1. Button label clarity improved (`Updates` -> `Activity`).
2. Role-based CTA visibility is now aligned with product expectation (buyer cannot upload).
3. Safe-area/header polish is still needed for final visual pass on all tabs.
4. Expo Go tools bubble can still overlap top-right UI in manual/E2E runs.

## What is truly working now
- Auth-first navigation and route gating.
- Role-scoped feed actions (seller-only upload).
- Persistent seeded beta dataset for repeated E2E/visual checks.
- Buyer/seller tab surfaces rendering real seeded marketplace/chat/activity data.

## What is still missing from an E2E product perspective
- Feed backed by persistent marketplace listing/video records (instead of startup demo reel seed).
- Dedicated chat thread detail UX from inbox cards.
- Final visual finishing pass (safe areas, spacing consistency, control density).
