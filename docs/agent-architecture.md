# Agent-Oriented Architecture (MVP)

Owner: Backend/Infra  
Related ticket: ANT-45  
Last updated: 2026-03-12

## Purpose

This document defines stable backend module boundaries so implementation agents can add marketplace features without increasing cross-feature coupling.

## Entry Points

- API server assembly: `apps/api/src/server.ts`
- Route modules:
  - `apps/api/src/routes/auth.ts`
  - `apps/api/src/routes/me.ts`
  - `apps/api/src/routes/uploads.ts`
  - `apps/api/src/routes/feed.ts`
  - `apps/api/src/routes/seller.ts`
  - `apps/api/src/routes/marketplace.ts`
  - `apps/api/src/routes/webhook.ts`
- Domain contracts:
  - `apps/api/src/domain/seller/contracts.ts`
  - `apps/api/src/domain/marketplace/contracts.ts`

## Module Boundaries

- Auth module:
  - Owns OTP/session lifecycle, token validation, and role resolution.
  - Public contract used by other modules: authenticated `AuthUser` context.
- Upload/feed module:
  - Owns upload lifecycle + Mux webhook readiness to feed visibility.
  - Must remain backward-compatible for `GET /v1/feed` consumers.
- Seller module:
  - Owns seller application workflow and seller sales export authorization.
  - Route layer depends on domain interfaces, not concrete DB service classes.
- Marketplace module:
  - Owns market session open/close, listing mutations, deal lifecycle, and chat reads/writes.
  - Route layer depends on explicit contracts split by concerns:
    - `MarketSessionDomainService`
    - `ListingMutationDomainService`
    - `DealDomainService`
    - `ChatDomainService`

## Current Domain Contracts

- Seller:
  - `SellerApplicationDomainService`
  - `SellerSalesDomainService`
- Marketplace:
  - `MarketSessionDomainService`
  - `ListingMutationDomainService`
  - `DealDomainService`
  - `ChatDomainService`
- Marketplace service implementations:
  - `MarketplaceService`: sessions, listing CRUD, basket, offer submit.
  - `SqliteDealDomainService`: seller offer decisions, deal reads/status updates.
  - `SqliteChatDomainService`: chat list/read/write for deal participants.
- Planned placeholder for upcoming extraction:
  - `NotificationDomainService`

## Invariants

- Keep `/v1/*` APIs backward-compatible unless a ticket explicitly allows breaking change.
- Route modules should depend on contracts in `apps/api/src/domain/**/contracts.ts`.
- Service classes are implementation details and can evolve if contracts stay stable.
- Shared request/response payload types live in `packages/types`.

## Data Flow

1. Route authenticates + validates request input.
2. Route calls a domain contract method.
3. Service implementation executes persistence/business rules.
4. Route maps result to `@antique/types` response shape.

## Agent Implementation Rules

- For new feature work, add/extend domain contracts before wiring routes.
- Keep contract files focused on capability interfaces and DTO-like input/output types.
- Add tests for changed contracts at route/service boundaries.
- Use `docs/testing-structure.md` as the canonical map for API integration suite placement.
- Update this document only when boundaries/invariants change.
