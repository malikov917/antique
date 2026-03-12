# API Test Structure

The API integration coverage is split into focused suites in `apps/api/test`:

- `api-uploads.test.ts`: upload and Mux webhook lifecycle.
- `auth-session.test.ts`: OTP/session lifecycle, `/v1/me`, and auth token flows.
- `seller-applications.test.ts`: seller application submission and admin review flow.
- `marketplace-deals.test.ts`: marketplace session/listing/offer/deal lifecycle.
- `tenant-guards.test.ts`: explicit cross-tenant guard regressions.
- `sales-ledger.test.ts`: seller ledger and CSV export authorization/filter behavior.
- `trust-safety-notifications.test.ts`: trust/safety enforcement, notification delivery, and observability summary.

Shared test harness helpers live in `apps/api/test/helpers/apiTestHarness.ts`.

When adding tests, extend the suite matching the domain behavior under change. Only add a new suite when behavior no longer fits one of the existing domains.
