# iOS Screen Audit — 2026-03-12

Run target: `origin/main` (`d83240b`) in `/Users/kanstantsinmalikau/.codex/worktrees/57e2/antique-main-audit`

Audit run artifacts:
- `/Users/kanstantsinmalikau/.codex/worktrees/57e2/antique-main-audit/state/runs/ios-role-screen-audit/20260312-224714/artifacts`
- `/Users/kanstantsinmalikau/.codex/worktrees/57e2/antique-main-audit/state/runs/ios-role-screen-audit/20260312-224714/logs`
- Seed summary: `/Users/kanstantsinmalikau/.codex/worktrees/57e2/antique-main-audit/state/runs/ios-role-screen-audit/20260312-224714/seed-summary.md`

## Dataset seeded (persistent SQLite)
- 4 users: buyer, buyer2, seller, admin.
- Seller lifecycle: application submitted + admin approved + switched to seller role.
- Marketplace: one market session, three listings.
- Commerce: three offers (accepted/declined mix), one completed deal.
- Chat: deal thread with buyer/seller messages.
- Fulfillment: address correction request + approval.
- Notifications/announcements: offer decisions, correction events, market close, announcement.

Persistence:
- Marketplace/auth data is persisted in `apps/api/data/antique.sqlite`.
- Feed reels are currently seeded via startup demo playback IDs (in-memory), not via marketplace DB entities.

## Role-by-role findings

### Guest
Working:
- Feed tab opens and renders playable demo reel surface.
- Updates modal opens.
- Inbox/Activity/Profile tabs are reachable.

Missing/weak:
- Not redirected to dedicated login/register first.
- Inbox/Activity show token error messages (`Set EXPO_PUBLIC_ACCESS_TOKEN...`) instead of auth-first UX.

### Buyer
Working:
- Inbox shows populated deal card (status, active address, correction state, latest message).
- Activity shows populated event timeline (offer accepted/declined, correction approved, announcements, market close).
- Profile shows signed-in onboarding state.

Missing/weak:
- No direct conversation detail screen from inbox card in current tab flow.
- Profile screen still mixes auth controls and account management in one long page.

### Seller
Working:
- Inbox shows populated deal card from seller perspective.
- Activity shows seller-facing operational events (new offer, correction requested/resolved, cancellation resolution, market close).
- Profile renders signed-in state.

Missing/weak:
- Same profile overload and discoverability issues.
- No dedicated seller operations dashboard in mobile tabs (everything funnels through activity list/profile form).

## View quality notes
1. Feed now visually renders with valid Mux demo IDs (no stream 404 errors in latest run).
2. Header text overlap is still visible on Inbox/Activity screenshots (`Inbox48`, `Activity48`) and needs safe-area/header treatment cleanup.
3. The top-right Expo tools floating control still obscures UI during Expo Go walkthroughs (test artifact caveat).

## What is truly working now
- Core backend workflows for auth/seller/onboarding/listings/offers/deals/chats/notifications can be executed end-to-end with seeded data.
- Mobile tab pages can render that seeded state for buyer/seller.

## What is still missing from an E2E product perspective
- Auth-first app entry flow.
- Clear route-to-action from inbox summary to full chat thread UI.
- Feed integration with persistent marketplace listing/video entities instead of startup-only demo reel seed.
