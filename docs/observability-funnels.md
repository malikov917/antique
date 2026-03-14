# Observability Funnel and Audit Definitions

## Admin Summary Endpoint

- `GET /v1/admin/observability/summary?windowHours=24`
- Admin-only.
- Returns three sections:
  - `funnel`: conversion stage counts
  - `errors`: HTTP 4xx/5xx totals and top failing routes with p95 latency
  - `sellerDecisionAudit`: seller decision/export audit volumes and recent rows

## Funnel Stage Mapping

- `view`: successful `GET /v1/feed` requests from `request_metrics`
- `basket`: `audit_events` where `event_type = funnel_event` and `reason_code = basket_added`
- `offer`: `audit_events` where `event_type = funnel_event` and `reason_code = offer_submitted`
- `accepted`: `audit_events` where `event_type = funnel_event` and `reason_code = offer_accepted`
- `paid`: `audit_events` where `event_type = funnel_event` and `reason_code = deal_paid`

## Error Dashboard Signals

The service writes one `request_metrics` row per API response:

- `method`
- `route_pattern`
- `status_code`
- `duration_ms`
- `created_at`

Dashboard queries are derived from these rows:

- 4xx and 5xx totals per window
- top failing routes
- p95 latency by route

## Seller Decision Audit Signals

Seller decision activity includes:

- Offer decisions: `audit_events` with `event_type = offer_action` and `reason_code = decision`
- CSV exports: `audit_events` with `event_type = seller_sales_csv_export`

Recent rows include actor, target seller, outcome, reason code, and timestamp.
