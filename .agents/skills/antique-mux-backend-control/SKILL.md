---
name: antique-mux-backend-control
description: Implement and validate Mux direct upload, webhook verification, and feed readiness transitions.
---

# Antique Mux Backend Control

## API Contract
- `POST /v1/uploads`
- `GET /v1/uploads/:uploadId`
- `GET /v1/feed`
- `POST /v1/webhooks/mux`

## Required Behavior
1. Create direct upload URLs via Mux.
2. Track upload state in memory.
3. Verify webhook signatures when secret exists.
4. Mark items `ready` only after asset and playback ID exist.
5. Return only `ready` videos in feed.

## Verification
1. Upload creation returns `uploadId`, `uploadUrl`, `expiresAt`.
2. Invalid webhook signature returns `401`.
3. Ready webhook event produces feed item.
4. Non-ready videos are excluded from feed.

