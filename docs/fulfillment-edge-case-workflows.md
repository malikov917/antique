# Fulfillment Edge-Case Workflows

Linear: `ANT-44`
Date: 2026-03-12
Status: Research spec (implementation follow-ups linked below)

## Goal
Specify deterministic behavior for three unresolved deal-lifecycle edge cases:
1. Buyer non-payment timeout.
2. Seller cancellation path.
3. Address correction workflow.

This spec is additive and backward-compatible for `/v1/*` endpoints.

## Current Baseline
Current shared contract (`packages/types`) supports:
- Deal states: `open`, `paid`, `completed`, `canceled`.
- Transition map:
  - `open -> paid | canceled`
  - `paid -> completed`
  - `completed -> (terminal)`
  - `canceled -> (terminal)`

## Proposed Additive States
To avoid overloading generic `canceled` with ambiguous causes, add explicit terminal/intermediate states:
- `payment_overdue` (terminal; non-payment timeout reached)
- `cancellation_requested` (intermediate; pending counterpart/admin decision)
- `refunded` (terminal; paid deal canceled after payment)

### Proposed Transition Map (superset)
- `open -> paid | cancellation_requested | payment_overdue`
- `cancellation_requested -> canceled | paid`
- `paid -> completed | refunded`
- `payment_overdue -> (terminal)`
- `completed -> (terminal)`
- `canceled -> (terminal)`
- `refunded -> (terminal)`

Compatibility note:
- Existing clients that only know `open|paid|completed|canceled` continue to function if unknown states are rendered as generic "updated" status until mobile/web are updated.

## Edge Case 1: Buyer Non-Payment Timeout

### Trigger
- Deal remains `open` beyond `paymentDueAt` without payment confirmation.

### Timeout Semantics
- Default timeout: `48h` from `deal.createdAt` (configurable server constant).
- Grace extension: seller or admin can extend once by `24h` with reason.
- Scheduler cadence: evaluate overdue deals every `15m`.
- Idempotency: repeated timeout worker runs must not duplicate transitions/audits.

### State Behavior
- On expiry: `open -> payment_overdue`.
- Offer/listing effects:
  - Accepted offer is finalized as lost due to non-payment.
  - Listing remains not-sold; seller may relist manually or via future automation.

### UX Expectations
- Buyer: sees explicit badge "Payment overdue" and action disabled for payment confirmation.
- Seller: sees timeout reason + relist recommendation CTA.
- Admin: can inspect due-at/extended-at trail.

### API Behavior
- `PATCH /v1/deals/:id/status` rejects direct client set to `payment_overdue` (`403`); worker/admin-only transition.
- `GET /v1/deals/me` includes `paymentDueAt`, `paymentOverdueAt`, `timeoutReasonCode`.
- Emit audit event: `deal_payment_timeout` with `dealId`, actor=`system`, timestamps.

## Edge Case 2: Seller Cancellation Path

### Trigger
- Seller cannot fulfill (damage, loss, logistics constraint) before completion.

### State Behavior
- Before payment:
  - `open -> cancellation_requested -> canceled` (buyer auto-notified).
- After payment:
  - `paid -> refunded` (requires refund confirmation metadata).
- Cancellation after `completed`: not allowed (`409`).

### Decision Rules
- Seller can request cancellation, but terminal resolution requires:
  - buyer acknowledgement for unpaid deals (or admin override after SLA),
  - admin-confirmed refund for paid deals.

### UX Expectations
- Seller: must select reason code and optional note.
- Buyer: receives actionable prompt to accept dispute/cancellation.
- Admin: sees pending cancellation queue, can force resolve.

### API Behavior
- New endpoint: `POST /v1/deals/:id/cancel-request`.
- Existing `PATCH /v1/deals/:id/status` remains for canonical transitions but enforces role/state guardrails.
- Error codes:
  - `deal_cancellation_not_allowed`
  - `deal_cancellation_requires_refund`
  - `deal_invalid_status_transition`
- Audit events:
  - `deal_cancellation_requested`
  - `deal_cancellation_resolved`
  - `deal_refund_confirmed`

## Edge Case 3: Address Correction Workflow

### Trigger
- Buyer or seller identifies shipping-address error after offer acceptance.

### Rules
- Address correction window: allowed only in `open` or `paid` before shipping proof.
- Correction creates immutable snapshot history; latest approved snapshot is active.
- Both participants are notified on each proposed/approved update.

### UX Expectations
- Buyer: can submit corrected address with reason.
- Seller: can approve/reject correction request before shipment.
- Admin: override path for disputes.

### API Behavior
- New endpoints:
  - `POST /v1/deals/:id/address-corrections` (create request)
  - `POST /v1/deals/:id/address-corrections/:correctionId/approve`
  - `POST /v1/deals/:id/address-corrections/:correctionId/reject`
- `GET /v1/deals/me` returns `activeShippingAddress` plus correction metadata summary.
- Keep PII-safe auditing (store hash/metadata in audit logs, not full address payload).
- Audit events:
  - `deal_address_correction_requested`
  - `deal_address_correction_approved`
  - `deal_address_correction_rejected`

## Retry and Failure Semantics
- All mutation endpoints must support idempotency keys.
- Worker retries use bounded exponential backoff (`max 5` attempts) for transient DB/queue failures.
- If timeout/cancellation side effects fail after state transition, mark `needs_reconciliation=true` and emit alert metric.

## Observability
Track counters and alerts:
- `deal_payment_timeout_total`
- `deal_cancellation_requested_total`
- `deal_address_correction_total`
- `deal_reconciliation_backlog_total`

## Follow-up Implementation Tickets
- `ANT-60` - backend timeout automation and overdue lifecycle.
- `ANT-61` - cancellation request/refund resolution workflow.
- `ANT-62` - address correction request/approval flow.

## Out of Scope
- Payment provider integration (still offline/manual confirmation flow).
- Full dispute center UI.
- Automatic relisting policies after overdue/cancellation (can be separate ticket).
