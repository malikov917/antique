# Tenant Isolation Contract (Marketplace Domain)

Owner: Backend/Infra
Related ticket: ANT-49
Last updated: 2026-03-07

## Purpose

Define a concrete tenant boundary contract for marketplace data and APIs so P2/P3 features stay isolation-safe while keeping `/v1/*` compatibility.

## Scope

In scope:
- Marketplace + identity-adjacent tables and routes in `apps/api`.
- Guard/enforcement contract for read/write API operations.
- Migration and rollback plan from current single-seller launch state.

Out of scope:
- Cross-tenant admin analytics and BI warehouse design.
- Full row-level security at the database engine level (SQLite MVP).

## Canonical Tenant Source

- Canonical tenant owner is `users.tenant_id`.
- Every business object must be provably attributable to one tenant.
- During P2, tenant ownership may be derived by joins; by P3 hardening, tenant ownership is materialized as `tenant_id` on high-volume domain tables.

## Ownership Map

| Object/Table | Tenant ownership rule | Current state | Target state |
| --- | --- | --- | --- |
| `users` | `users.tenant_id` | Explicit column | Keep as source of truth |
| `sessions` | Inherit from `sessions.user_id -> users.tenant_id` | Derived | Keep derived (auth-domain) |
| `refresh_tokens` | Inherit from `refresh_tokens.user_id -> users.tenant_id` | Derived | Keep derived (auth-domain) |
| `seller_applications` | Inherit from `seller_applications.user_id -> users.tenant_id` | Derived | Add materialized `tenant_id` in hardening phase |
| `market_sessions` | Inherit from `seller_user_id -> users.tenant_id` | Derived | Add `tenant_id` + `(tenant_id, status)` index |
| `listings` | Inherit from `seller_user_id -> users.tenant_id` and `market_session_id` | Derived | Add `tenant_id` + tenant-scoped query indexes |
| `basket_items` | Must match listing tenant and buyer tenant | Derived | Add `tenant_id` + invariant checks |
| `offers` | Must match listing tenant and buyer tenant | Derived | Add `tenant_id` + invariant checks |
| `seller_sales` | Must match seller/listing tenant | Derived | Add `tenant_id` + export indexes |
| `audit_events` | Should capture actor tenant and target tenant | No tenant columns | Add `actor_tenant_id` + `target_tenant_id` |
| `retention_purge_runs` | Operational, global | Global | Keep global |
| `deals` (planned) | Inherit from accepted offer/listing tenant | Not implemented | Add explicit `tenant_id` at create time |
| `chat_threads` (planned) | Inherit from deal/listing tenant | Not implemented | Add explicit `tenant_id` |
| `messages` (planned) | Inherit from thread tenant | Not implemented | Add explicit `tenant_id` |
| `announcements` (planned) | Seller tenant | Not implemented | Add explicit `tenant_id` |
| `notifications` (planned) | Recipient tenant | Not implemented | Add explicit `tenant_id` |

## API Guard Contract

All authenticated domain routes enforce both actor role and tenant scope.

### Read rules

- `GET /v1/feed`: return only listings in caller tenant.
- `GET /v1/seller/application`: only caller's own application; tenant derived from caller.
- `GET /v1/seller/sales.csv`: seller/admin only; seller scope must remain within caller tenant.
- Planned read endpoints (`/v1/deals/me`, `/v1/chats`, `/v1/chats/:id/messages`): tenant predicate is mandatory.

### Write rules

- `POST /v1/seller/sessions/open`: create session in caller tenant.
- `POST /v1/seller/sessions/:id/close`: session must match caller tenant and seller ownership.
- `POST /v1/listings/:id/basket`: listing tenant must equal buyer tenant.
- `POST /v1/listings/:id/offers`: listing tenant must equal buyer tenant; reject cross-tenant.
- `POST /v1/offers/:id/accept|decline` (planned): offer/listing tenant must equal seller tenant.
- `POST /v1/seller/apply`: application tenant equals caller tenant.

### Guard implementation contract

- Add a shared tenant guard helper in auth/domain layer:
  - `requireTenantScope(resourceTenantId, auth.user.tenantId)`.
- For derived-tenant tables (no `tenant_id` yet), repository/service methods must join to `users`/parent object and apply tenant predicate before mutation.
- No route/service method may fetch by ID alone without tenant predicate for tenant-owned objects.

## DB Constraints and Index Strategy

P2 mandatory:
- Enforce tenant match in service-level invariants for basket/offer/session transitions.
- Add tenant-aware repository query patterns using joins where `tenant_id` is not materialized.
- Add regression tests for cross-tenant access denial.

P3 hardening:
- Add explicit `tenant_id` columns to marketplace tables (`market_sessions`, `listings`, `basket_items`, `offers`, `seller_sales`, `seller_applications`).
- Backfill `tenant_id` from source-of-truth joins.
- Add indexes for tenant-scoped reads/writes, e.g.:
  - `listings(tenant_id, status, created_at DESC)`
  - `offers(tenant_id, listing_id, status)`
  - `market_sessions(tenant_id, seller_user_id, status)`

## Migration Plan

1. Schema expand (non-breaking): add nullable `tenant_id` columns + indexes where safe.
2. Backfill: populate `tenant_id` using deterministic joins from current records.
3. Dual-write: new writes set `tenant_id` explicitly while still validating via joins.
4. Read switch: move read paths to direct `tenant_id` predicates.
5. Tighten: mark `tenant_id` as non-null for migrated tables and keep consistency checks.

## Rollback Notes

- If backfill quality issues appear, keep join-based tenant checks active and gate direct-tenant reads behind a feature flag.
- Do not drop join-based predicates until data audit confirms no null/mismatch tenant rows.
- Maintain additive schema compatibility so rollback is disabling new predicates, not destructive migration.

### ANT-52 Phase 2 rollout details

- Added additive nullable `tenant_id` columns for marketplace tables (`seller_applications`, `market_sessions`, `listings`, `basket_items`, `offers`, `seller_sales`).
- Added tenant-scoped indexes to keep read and filter paths stable during dual-write period.
- Backfill is deterministic and idempotent:
  - Owner-derived tables: `seller_applications`, `market_sessions`, `seller_sales` derive from `users.tenant_id`.
  - Child-derived tables: `listings`, `basket_items`, `offers` derive from parent object tenant (`market_sessions`/`listings`) with owner fallback where needed.
- Read switch scope in this phase:
  - Marketplace buyer mutations use `listings.tenant_id` as primary tenant source.
  - Seller offer inbox and seller sales export include direct `tenant_id` predicates.

### ANT-52 rollback execution

- Keep the additive columns and indexes in place; rollback is runtime behavior, not schema deletion.
- Re-enable join-derived tenant checks/filters for any endpoint where direct `tenant_id` reads are suspected to be stale.
- Re-run the backfill by invoking normal DB initialization; it updates only rows where `tenant_id IS NULL`.

## Test Coverage Plan

Required tests:
- Unit/service tests for `requireTenantScope` and tenant mismatch rejection.
- Route tests asserting cross-tenant access returns `403` for read/write endpoints.
- Migration tests for tenant backfill correctness and mismatch detection.
- Regression tests for basket/offer/session actions across tenants.

## Risks and Tradeoffs (Single-Seller Launch)

- Risk: over-investing in tenant hardening before P2 can slow feature throughput.
- Mitigation: phased approach (P2 join-based enforcement first, P3 materialization hardening second).
- Tradeoff: join-based enforcement is simpler short-term but less efficient and easier to bypass accidentally than explicit `tenant_id` columns.

## Implementation Split

Phase 1 (mandatory before broad P2 rollout):
- Introduce explicit tenant guard helpers and enforce on all existing marketplace/seller routes.
- Add cross-tenant denial tests.

Phase 2 (hardening before P3 scale):
- Materialize `tenant_id` on marketplace tables + backfill + indexes.
- Migrate high-volume queries to direct tenant predicates.

Phase 3 (new domain objects):
- Ensure planned deals/chats/notifications are created with explicit `tenant_id` from day one.

## Follow-up Tickets

- ANT-51: Add tenant guard primitives and enforce tenant predicates across existing marketplace/seller endpoints.
- ANT-52: Materialize and backfill `tenant_id` on marketplace persistence with tenant-scoped indexes.
- ANT-53: Add tenant isolation test matrix and migration verification coverage.
