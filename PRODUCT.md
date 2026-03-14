# Antique Product Specification (v2)

Last updated: March 14, 2026
Owner: Product + Engineering (Linear team: Antique)
Source of truth for delivery: Linear issues mapped to this spec

## 1) Product Scope and Principles

Antique is a reels-first marketplace for real-time selling from physical antique markets.

Core principles:
1. Fast mobile selling while seller is physically on market.
2. Video-first discovery and conversion.
3. Seller keeps control over who buys when multiple buyers want the same item.
4. Payments are manual/offline (bank transfer in chat), not in-app.
5. API compatibility for existing `/v1/*` flows is preserved.
6. Data model is multi-tenant from day one, while launch starts with one active seller.

## 2) Living Status Board

| Area | Status | Last Updated | Linear Issue |
| --- | --- | --- | --- |
| Reels feed playback | Done | 2026-03-05 | ANT-26 |
| Gallery video upload + Mux processing | Done | 2026-03-05 | ANT-26 |
| Identity + auth (OTP, sessions, role claims) | Done | 2026-03-05 | ANT-28 |
| `me` profile + role switch + auth route guards | Done | 2026-03-07 | ANT-31, ANT-50 |
| Seller onboarding/approval (legacy path in code; planned UI deprecation) | Done | 2026-03-06 | ANT-32, ANT-48 |
| Market day session open/close | Done | 2026-03-06 | ANT-33 |
| Listings + price floor + basket + offers | Done | 2026-03-07 | ANT-34, ANT-35 |
| Manual winner selection + auto-decline others | Done | 2026-03-06 | ANT-36 |
| Per-product chat | Done | 2026-03-07 | ANT-37 |
| Sold list + CSV export | Done | 2026-03-11 | ANT-38 |
| Story rings + announcements + notifications | Done | 2026-03-12 | ANT-39, ANT-40, ANT-54, ANT-58 |
| Abuse prevention + moderation + observability | Done | 2026-03-11 | ANT-41, ANT-42 |
| Fulfillment edge-case workflows | Done | 2026-03-12 | ANT-44, ANT-60, ANT-61, ANT-62 |
| Admin-only role governance (allowlist + hide non-admin role controls) | Planned | 2026-03-14 | TBD |
| OTP throttling calibration for normal beta login retries | Planned | 2026-03-14 | TBD |
| Bottom tab icons in mobile navigation | Planned | 2026-03-14 | TBD |
| Seller one-tap payment info message in chat | Planned | 2026-03-14 | TBD |
| Persistent inventory outside market day + `in_stock`/`out_of_stock` buyer hints | Planned | 2026-03-14 | TBD |

Status keys:
- `Done`: implemented and verified
- `Planned`: agreed scope, not yet implemented
- `In Progress`: active implementation ticket exists

## 3) Current State (Repo Reality)

Implemented today:
1. Reels-first mobile experience with Feed/Inbox/Activity/Profile tabs, story rings, announcement cards, and freshness badges.
2. Gallery upload with preparation fallback and API direct-upload lifecycle (`POST /v1/uploads`, `GET /v1/uploads/:uploadId`) plus Mux webhook readiness.
3. Identity foundation: OTP request/verify, refresh/logout, `GET/PATCH /v1/me`, `POST /v1/me/role-switch`, route guards, role claims, and session persistence.
4. Seller onboarding lifecycle (legacy path currently still in backend): `GET /v1/seller/application`, `POST /v1/seller/apply`, admin approve/reject transitions, and audit logging.
5. Market session and listing operations: open/close day session, listing create/update, basket submit, offers submit/accept/decline, single-winner enforcement, and day-close protections.
6. Deal and fulfillment lifecycle: deals timeline/status transitions, cancellation request + refund resolution, non-payment timeout sweep, and address-correction request/approve/reject workflow.
7. Chat and inbox operations: per-deal chat listing, message history, and message posting with participant authorization.
8. Notifications and announcements: in-app timeline, push-token registration, seller/admin announcements, and automated market day open/close announcements.
9. Trust, safety, and observability: block/report actions, seller suspension, listing moderation flags, and admin observability summary endpoint.
10. Seller operations: sales ledger API + CSV export with tenant-aware authorization and export auditing.
11. SQLite persistence for marketplace entities (sessions, listings, basket, offers, deals, chats, notifications, announcements, sales, audit events) with tenant-scoped guards.

Remaining gaps:
1. Seeded beta credentials role mapping regression: seeded `Admin` phone is currently treated as buyer-only and cannot access admin capabilities.
2. OTP flow rate-limit behavior needs tuning: users can hit `Too many requests` unexpectedly during normal login retries.
3. Bottom tab navigation icons are missing on mobile; tabs currently rely on text-only affordances.
4. Role management UX/policy realignment:
1. No public role-pick register flow.
2. Non-admin users should not see role/status update controls.
3. Admin role assignment should be owner-managed via DB allowlist.
5. Seller chat productivity:
1. Seller should have a saved payment/help template that can be inserted into chat with one tap.
6. Listing lifecycle/persistence:
1. Seller should be able to upload and maintain products outside an active market day.
2. Buyers should always be able to view seller products, while buyability is controlled by explicit availability state.
3. UI should display `In stock` / `Out of stock` status so buyers know whether purchase is still possible.

### 3.1 Manual Test Requirement Matrix (March 14, 2026)

| Requirement from manual test | Current state in repo | Status for delivery |
| --- | --- | --- |
| Seller can notify opening sales and buyers see post in feed | Market open triggers system announcement; announcements are rendered in feed/activity | Implemented (validate UX polish) |
| Seller can close sales and buyers see post in feed | Market close triggers system announcement; feed/activity consume announcements | Implemented (validate UX polish) |
| Seller can upload video and set price/description; update later if needed | Upload + listing create/update exists; `description` optional, `listedPriceCents` required on create | Partially implemented |
| Buyer can apply/buy and both sides get chat to finalize | Buyer offer + seller accept flow creates per-deal chat for buyer/seller | Implemented |
| Seller has one-click "how to pay / other info" message in chat | Generic chat exists; no one-tap payment-template insertion action | New requirement (Planned) |
| Listings become unavailable for buy when seller is out of active market | Day close blocks new basket/offers and keeps listing visible | Implemented for market-day listings |
| Seller can upload products outside active market day; posts persist and can be bought later; seller can update | Current create flow is tied to active market session; updates exist after creation | New requirement (Planned) |
| Buyers see `In stock` / `Out of stock` hint on seller products | No explicit stock badge/state in contracts/UI | New requirement (Planned) |

## 4) Personas and Roles

Personas:
1. Seller: records antique items on market, uploads quickly, decides winner manually, handles payment/shipping offline.
2. Buyer: watches recent reels, submits offer quickly, receives approve/decline result, chats with seller.
3. Admin (owner-controlled): manages allowlisted role-enabled numbers, can switch roles, and can suspend seller capabilities.

Roles:
1. `buyer`
2. `seller`
3. `admin`

Account policy:
1. Signup/login default role is buyer for all non-admin phone numbers.
2. Admin accounts are defined by explicit phone-number allowlist controlled by the product owner.
3. Only allowlisted admins can switch active role (`buyer`/`seller`/`admin`) at any time.
4. Non-admin users must not see role switching or role status mutation controls.
5. Seller/admin capability for non-admin numbers is managed by direct admin database updates.

## 5) Identity and Access

### 5.1 Authentication model
1. Phone OTP is primary auth flow.
2. Email is optional and can be attached later.
3. Session model:
1. short-lived access token,
2. refresh token rotation,
3. per-device session tracking and revoke.

### 5.2 Auth flows
Registration/login:
1. User enters phone.
2. Server sends OTP.
3. User verifies OTP.
4. Account is created if missing, else session is issued.
5. Optional: user adds/verifies email in profile.

Logout:
1. Revoke current refresh token.
2. Optional: revoke all device sessions.

### 5.3 Identity claims and server enforcement
Each authenticated request uses bearer token with claims:
- `userId`
- `tenantId`
- `allowedRoles`
- `activeRole`
- `sellerProfileId` (nullable)

Rules:
1. App stores and displays current `activeRole`.
2. App only exposes explicit role switch endpoint for allowlisted admin accounts.
3. API enforces route guards:
1. seller-only: listing/session/offer decision/export/seller announcements,
2. buyer-only: basket/offer submit,
3. shared: chat/profile/notification center with ownership checks.
4. Write operations keep audit fields: `createdByUserId`, `updatedByUserId`.

### 5.4 Seller capability assignment (admin-managed)
Rules:
1. Self-serve seller registration/apply flow is out of scope for beta and production baseline.
2. Seller capability is granted/revoked only by admin owner operations (DB-backed allowlist/role updates).
3. Non-admin users remain buyer-only and cannot mutate their own role/status.
4. Role mutation UI controls are visible only for allowlisted admin accounts.

## 6) Core Domain Objects

1. `User`
2. `Session`
3. `BuyerProfile`
4. `SellerProfile`
5. `MarketSession` (`open`, `closed`)
6. `Listing` (`live`, `day_closed`, `sold`, `withdrawn`)
7. `BasketItem`
8. `Offer` (`submitted`, `accepted`, `declined`, `cancelled`, `expired`)
9. `Deal` (`approved`, `awaiting_payment`, `payment_overdue`, `paid`, `shipped`, `completed`, `cancellation_requested`, `cancelled`, `refunded`)
10. `ChatThread` (per accepted listing)
11. `Message`
12. `Announcement`
13. `Notification`

Key constraints:
1. One listing represents one unique item quantity.
2. Listed price is minimum allowed offer (`offer >= listedPrice`).
3. Exactly one accepted offer per listing.
4. Closing market day blocks new basket/offer actions for that day listings.

## 7) App Navigation and UX

Primary tab navigation:
1. `Feed`
2. `Inbox`
3. `Activity`
4. `Profile`
5. Every bottom tab shows both icon and label; missing icons are a release-blocking UX bug.

Feed:
1. Story-style seller rings showing unseen updates.
2. Latest-first reels from open market sessions.
3. Announcement cards (day open/restock/last call/day closed) are inserted directly into feed stream.
4. Listing CTA states: `Add to Basket`, `Offer Submitted`, `Day Closed`, `Sold`.

Inbox:
1. Buyer: offer updates and accepted-deal chats.
2. Seller: offer inbox and per-product deal chats.

Activity:
1. Central event timeline: new listings, offer status changes, day status changes, announcements.

Profile:
1. Buyer profile editing (name, phone, addresses).
2. Role controls visible only for allowlisted admins.
3. Seller settings include payout instructions template and fulfillment notes.

## 8) End-to-End Workflows

### WF-1: Registration/Login
1. Enter phone and receive OTP.
2. Verify OTP.
3. Create session and default buyer profile.
4. Optional email attachment later.

### WF-2: Admin-managed seller enablement
1. User signs in as default buyer.
2. Product owner/admin updates role allowlist in DB for selected phone numbers.
3. Allowlisted admin account can switch active role.
4. Non-admin users never see self-serve role upgrade controls.
5. Legacy seller-application endpoints remain in backend but are planned for UI deprecation.

### WF-3: Seller opens market day
1. Seller taps `Open Market Day`.
2. Optional announcement is posted.
3. Session state set to `open`.
4. Followers receive in-app + push notification.

### WF-4: Seller uploads listing from gallery
1. Seller taps `Upload` (existing flow).
2. Video uploads and becomes ready.
3. Seller sets listing metadata (`description` supported today; price required on create today).
4. Seller can update listing metadata later.
5. Planned: allow draft creation and defer price-setting until publish.
6. Listing becomes `live` under current open market session.

### WF-5: Buyer apply/buy flow
1. Buyer adds listing to basket.
2. Buyer enters offer amount.
3. Validation ensures `offer >= listed price`.
4. Buyer submits offer with shipping details captured at submit time.
5. Seller gets notified.

### WF-6: Seller selects winner
1. Seller views offers for listing.
2. Seller manually accepts one offer.
3. Accepted offer becomes `accepted`; deal is created.
4. All other submitted offers auto-change to `declined`.
5. Buyers receive decision notifications.

### WF-7: Offline payment and fulfillment
1. Per-product chat opens for accepted buyer and seller.
2. Seller shares payment details in chat.
3. Planned: one-tap insertion of seller payment/help template into chat composer.
4. Deal progresses through payment and shipping statuses.
5. Chat remains accessible after completion.

### WF-8: Close market day
1. Seller taps `Close Market Day`.
2. All unsold live listings change to `day_closed`.
3. New basket/offer actions are blocked.
4. Listings remain visible with `Day Closed` badge.
5. Day-close announcement is published.

### WF-9: Sold list and CSV export
1. Seller opens sold ledger by session/day.
2. Seller sees buyer name/address, product, accepted price, statuses.
3. Seller exports CSV for fulfillment operations.

### WF-10: Persistent inventory and stock visibility (planned)
1. Seller can upload/save products even when no market session is open.
2. Product video stays visible on seller page regardless of buy availability.
3. Buy action depends on explicit stock/availability state (`In stock` vs `Out of stock`).
4. Seller can update existing product metadata and availability state after publishing.

## 9) API Surface (planned, backward-compatible additions)

Auth/identity:
1. `POST /v1/auth/otp/request`
2. `POST /v1/auth/otp/verify`
3. `POST /v1/auth/refresh`
4. `POST /v1/auth/logout`
5. `GET /v1/me`
6. `PATCH /v1/me`
7. `POST /v1/me/role-switch`
8. `POST /v1/seller/apply` (legacy; planned UI deprecation)
9. `GET /v1/seller/application` (legacy; planned UI deprecation)

Marketplace and operations:
1. `POST /v1/seller/sessions/open`
2. `POST /v1/seller/sessions/:id/close`
3. `POST /v1/listings`
4. `PATCH /v1/listings/:id`
5. `POST /v1/listings/:id/basket`
6. `POST /v1/listings/:id/offers`
7. `GET /v1/seller/listings/:id/offers`
8. `POST /v1/offers/:id/accept`
9. `POST /v1/offers/:id/decline`
10. `GET /v1/deals/me`
11. `PATCH /v1/deals/:id/status`
12. `GET /v1/seller/sales.csv?sessionId=...`
13. `GET /v1/announcements`
14. `POST /v1/announcements`
15. `GET /v1/chats`
16. `GET /v1/chats/:id/messages`
17. `POST /v1/chats/:id/messages`
18. Extend `GET /v1/feed` with listing/seller/session freshness fields while keeping existing fields unchanged.
19. Planned: seller payment template endpoints for one-tap chat insertion.
20. Planned: persistent inventory endpoints/state to support uploads outside active market sessions.
21. Planned: explicit listing availability (`in_stock`/`out_of_stock`) in listing and feed contracts.

## 10) Shared Contract Additions (`packages/types`)

Add types:
1. `AuthTokenSet`
2. `AuthUser`
3. `Role`
4. `SellerApplicationStatus` (legacy flow; planned UI deprecation)
5. `MarketSession`, `Listing`, `BasketItem`, `Offer`, `Deal`, `ChatThread`, `Message`, `Announcement`, `Notification`
6. Planned additions: `ListingAvailabilityStatus`, `SellerPaymentTemplate`

Add validation constants:
1. `MIN_OFFER_RULE = offer >= listedPrice`
2. allowed `DealStatus` transitions map

## 11) What Was Missed (must be addressed)

1. Role policy hardening:
1. Enforce admin allowlist correctly for seeded/admin numbers.
2. Remove/hide self-serve seller apply/role mutation UI for non-admin users.
2. Auth reliability:
1. Recalibrate OTP request/verify throttling to avoid false-positive `Too many requests` during normal testing/login.
3. Navigation polish:
1. Add bottom tab icons (Feed/Inbox/Activity/Profile) and keep safe-area compliant spacing.
4. Seller-to-buyer conversion UX:
1. Add one-tap payment/help template insertion in deal chat.
5. Inventory model extension:
1. Support listing creation outside active market day.
2. Keep products visible even when unavailable for purchase.
3. Add explicit `In stock` / `Out of stock` availability in API + mobile UI.
6. Existing platform hardening that remains relevant:
1. reliability controls (idempotent offer acceptance, optimistic locking),
2. observability dashboards and audit completeness,
3. moderation rules for video/listing quality.

## 12) Prioritized Delivery Roadmap

### P0 (done)
1. Reels feed and upload pipeline.

### P1 (identity foundation)
1. OTP auth and refresh sessions. (Done: ANT-28, 2026-03-05)
2. `me` profile endpoints and role switch. (Done)
3. Auth middleware and role guards. (Done)
4. Admin-only role governance enforcement + non-admin UI hardening. (Planned)
5. Legacy seller-application flow deprecation from mobile UI. (Planned)

### P2 (sell-critical transaction core)
1. Market day open/close.
2. Listing metadata + listed price floor.
3. Basket and offer submission.
4. Manual winner selection + auto-decline others.

### P3 (completion operations)
1. Per-product chat.
2. Deal status tracking.
3. Sold ledger by day/session.
4. CSV export.

### P4 (engagement and trust)
1. Story rings and freshness indicators.
2. Seller announcements.
3. In-app notification center + push notifications.
4. Moderation and abuse controls.
5. Analytics and operational dashboards.

### P5 (manual-test product alignment, March 14, 2026)
1. OTP throttle calibration for real-world login cadence.
2. Bottom tab icon pass and navigation affordance polish.
3. One-tap seller payment-info message in chat.
4. Persistent catalog outside market day.
5. `In stock` / `Out of stock` status across API and mobile.

## 13) Testing and Acceptance Criteria

Auth/access tests:
1. OTP request/verify success and failure.
2. Refresh token rotation and revoked token rejection.
3. Route guard enforcement by role.
4. Admin allowlist enforcement for role-switch visibility and execution.
5. Non-admin user cannot self-promote role from mobile UI.

Marketplace tests:
1. Offer below floor is rejected.
2. Single winner enforced under concurrent accept attempts.
3. Day-close blocks new offers/basket actions.
4. Accepted offer creates deal and per-product chat.
5. Sold CSV columns and session filtering are correct.

E2E tests:
1. New user -> buyer offer flow.
2. Admin allowlisted user -> role switch -> seller listing flow.
3. Day close behavior and notifications.
4. For failures/stalls, capture screenshot + relevant logs before reporting blocker.
5. Persistent inventory scenario (planned): upload outside market day, verify visibility and stock badge behavior.

### 13.1 Current UX/E2E quality gaps (observed on March 14, 2026)
These are implementation quality gaps observed during role-based iOS walkthroughs with seeded data:

1. Feed source is still decoupled from marketplace domain:
1. Reels feed uses in-memory demo videos rather than listing/video entities in SQLite marketplace tables.
2. This makes transactional state (listing sold/day_closed) only partially reflected in feed UX.
2. Screen-level layout quality issues:
1. Header/title text can overlap with status area on Inbox/Activity.
2. Tools overlay (Expo Go) can obscure top-right content in walkthroughs.
3. Workflow depth in mobile UI remains limited:
1. Inbox currently shows deal summary cards but no dedicated threaded chat detail screen in tab flow.
2. Activity is event-list only; lacks filtering/grouping for buyer vs seller operations.
4. Role/access behavior mismatches for seeded beta users:
1. Seeded admin phone currently lands as buyer-only.
2. Non-admin users still encounter role mutation affordances in places where they should be hidden.
5. OTP login reliability:
1. `Too many requests` appears during normal manual testing cadence and should be recalibrated.
6. Bottom tab navigation affordance gap:
1. Missing tab icons reduce discoverability and fail expected mobile navigation patterns.

### 13.2 Beta UI-first priorities (replanned on March 14, 2026)
For current beta, prioritize visual quality and flow clarity before deeper security/infra hardening:

1. Auth-first navigation:
1. Guest sees dedicated login/register route first.
2. App tabs are visible only after login.
2. Role clarity in UI:
1. Buyer cannot see seller-only actions such as upload.
2. Seller/admin-only actions are visible only when active admin-managed role allows them.
3. Non-admin users cannot self-upgrade role and never see role-switch controls.
3. Profile simplification:
1. Profile focuses on user account data and admin-only role controls.
2. Login/register lives on dedicated auth screen, not inside Profile.
3. Remove self-serve seller application controls for non-admin users.
4. Visual finishing pass:
1. Safe-area and spacing fixes on Feed/Inbox/Activity/Profile.
2. Copy cleanup for unclear labels (for example, ambiguous `Updates` button naming).
3. Add bottom tab icons and keep visual QA artifact-driven using role-by-role screenshots from iOS walkthroughs.

Delivery gate before moving ticket to `In Review`:
1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm test`
4. Post summary using required Linear template.

## 14) Technology (short)

1. Mobile: Expo + React Native + TypeScript.
2. API: Fastify + TypeScript.
3. Video: Mux direct upload and playback.
4. Shared contracts: `packages/types`.
5. Persistence: SQLite + Drizzle (current); cloud-postgres path can be introduced later when scale requires it.
6. Auth: OTP provider + JWT access/refresh tokens.
7. Notifications: Expo push + in-app notification center.
8. Chat MVP: REST + polling (realtime upgrade later).

## 15) Defaults and Assumptions

1. Non-admin accounts are buyer-only by default.
2. Buyer role is default on signup.
3. Admin accounts are controlled by phone-number allowlist set directly in the database.
4. Only admins can switch active role; non-admin role/status mutation is not exposed in mobile UI.
5. Listed price is minimum allowed offer.
6. One listing equals one unique product.
7. Chat is per-product for accepted offers.
8. Payments are always handled offline/manual.
9. Closed-day listings remain viewable but cannot receive new buying actions.
10. Planned extension: persistent products can exist outside active market day with explicit stock state (`In stock` / `Out of stock`).
11. Launch starts with one active seller, while architecture supports many sellers and many buyers.

## 16) Document Operating Rules

1. Update this file after every completed ticket that changes product behavior or scope.
2. Keep Living Status Board rows in sync with Linear issue identifiers.
3. Keep only durable process learnings in `AGENTS.md`; keep product truth here.
4. Do not mark roadmap items `Done` without passing required quality gates and posting verification summary in Linear.
