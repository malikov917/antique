# PII Retention and CSV Access Compliance Policy

Owner: Backend/Infra
Related ticket: ANT-43
Last updated: 2026-03-06

## 1. Scope

This policy covers:
- Buyer/seller address PII stored for offer/deal fulfillment.
- Seller ledger CSV exports (`GET /v1/seller/sales.csv`).
- Export audit logs and access revocation behavior.

## 2. Data Classification

- Restricted PII:
  - Full name
  - Phone number
  - Street/city/postal address
- Confidential business data:
  - Offer amounts
  - Deal lifecycle timestamps
  - Listing metadata
- Operational metadata:
  - User id, role, session id, request id, IP hash, user agent

## 3. Retention and Deletion Rules

| Data type | Purpose | Retention | Deletion rule |
| --- | --- | --- | --- |
| Address snapshot on submitted offer | Fulfillment and dispute handling | 365 days after deal terminal state (`delivered`, `canceled`, `refunded`) | Hard delete on scheduled purge run; keep non-PII deal summary |
| Seller ledger rows | Tax/accounting support for sellers | 730 days after market session close | Keep financial totals, remove direct buyer PII fields |
| CSV export audit events | Security and compliance evidence | 1095 days from event time | Purge older events in rolling batches |
| Seller suspension/moderation notes containing PII | Safety operations | 365 days after suspension resolution | Redact free-text PII before archive |

### Deletion SLA

- User-initiated deletion request (where legally allowed): process within 30 days.
- System retention purge lag target: <= 24 hours from eligibility.

## 4. CSV Access Model

### Allowed actors

- `seller`: can export only ledger data scoped to their own seller account.
- `admin`: can export any seller ledger for support/compliance reasons.
- `buyer`: no CSV export access.

### Authorization rules

- Every export request must enforce active role + ownership scope.
- Session must be active and not revoked.
- Suspended sellers cannot export while suspended.

### Revocation behavior

- Access revocation is immediate after role change, suspension, or session revocation.
- Cached export tokens/URLs (if introduced later) must expire in <= 5 minutes.

## 5. Required Audit Log Schema (minimum)

Emit one immutable event per export attempt:
- `eventType`: `seller_sales_csv_export`
- `result`: `allowed` | `denied`
- `actorUserId`
- `actorRole`
- `sellerProfileId` (requested scope)
- `sessionId`
- `requestId`
- `reason` (for denied events)
- `ipHash`
- `userAgent`
- `createdAt`

Rules:
- Store denied attempts the same as allowed attempts.
- Never log full address payloads in audit events.
- Log storage is append-only; updates are disallowed.

## 6. Security Controls Checklist

- [ ] Add DB fields/tables for retention timestamps and purge eligibility.
- [ ] Implement purge worker for address snapshots and aged PII.
- [ ] Add role+ownership enforcement middleware for `/v1/seller/sales.csv`.
- [ ] Emit structured audit events for all export attempts.
- [ ] Add suspension gate in export path.
- [ ] Add integration tests for seller/admin allow and buyer/foreign-seller deny cases.
- [ ] Add metrics and alerts for denied-export spikes and purge failures.

## 7. Implementation Tickets

Follow-up implementation work is split as:
1. API enforcement + audit events for CSV export authorization.
2. Retention engine and purge jobs for address/deal PII lifecycle.

These follow-up tickets are linked from ANT-43.
