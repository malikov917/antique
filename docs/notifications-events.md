# Notifications and Announcements

## API Endpoints

- `GET /v1/notifications` - returns user-scoped notification timeline.
- `POST /v1/me/push-token` - registers Expo push token for authenticated user.
- `GET /v1/announcements` - returns tenant-scoped announcements.
- `POST /v1/announcements` - seller/admin creates an announcement and fan-out notifications.

## Emitted Event Types

The backend emits `audit_events` rows with `event_type = funnel_event` for:

- `feed_viewed`
- `basket_added`
- `offer_submitted`
- `offer_accepted`
- `offer_declined`
- `deal_paid`
- `session_opened`
- `session_closed`
- `announcement_posted`

## Push Retry Policy

Push delivery attempts are stored in `notification_push_attempts`.

- Retry schedule: immediate, +250ms, +1000ms.
- Failed attempts record `next_retry_at`.
- Successful attempts are stored with `status = sent`.
