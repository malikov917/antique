import type { Database } from "better-sqlite3";
import type { AnnouncementItem, AuthPlatform, NotificationItem } from "@antique/types";
import { newId } from "../auth/crypto.js";
import { AuthError } from "../auth/errors.js";

type NotificationType = NotificationItem["type"];
type FunnelEventName =
  | "feed_viewed"
  | "basket_added"
  | "offer_submitted"
  | "offer_accepted"
  | "offer_declined"
  | "deal_paid"
  | "session_opened"
  | "session_closed"
  | "announcement_posted";

interface NotificationRow {
  id: string;
  user_id: string;
  tenant_id: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata_json: string;
  created_at: number;
  read_at: number | null;
}

interface AnnouncementRow {
  id: string;
  tenant_id: string;
  seller_user_id: string;
  source: "manual" | "system";
  event_type: "market_session_opened" | "market_session_closed" | null;
  title: string;
  body: string;
  created_at: number;
}

export interface NotificationPushProvider {
  send(params: {
    token: string;
    title: string;
    message: string;
    data: Record<string, unknown>;
  }): Promise<void>;
}

export interface NotificationServiceParams {
  pushProvider?: NotificationPushProvider;
  now?: () => number;
}

class LoggingPushProvider implements NotificationPushProvider {
  async send(): Promise<void> {
    return;
  }
}

const RETRY_BACKOFF_MS = [0, 250, 1000] as const;

function toIso(value: number): string {
  return new Date(value).toISOString();
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toNotificationItem(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    metadata: parseMetadata(row.metadata_json),
    createdAt: toIso(row.created_at),
    readAt: row.read_at === null ? null : toIso(row.read_at)
  };
}

function toAnnouncementItem(row: AnnouncementRow): AnnouncementItem {
  return {
    id: row.id,
    sellerUserId: row.seller_user_id,
    source: row.source,
    eventType: row.event_type ?? undefined,
    title: row.title,
    body: row.body,
    createdAt: toIso(row.created_at)
  };
}

export class NotificationService {
  private readonly pushProvider: NotificationPushProvider;

  constructor(
    private readonly sqlite: Database,
    params: NotificationServiceParams = {}
  ) {
    this.pushProvider = params.pushProvider ?? new LoggingPushProvider();
    this.now = params.now ?? (() => Date.now());
  }

  private readonly now: () => number;

  listNotifications(userId: string): NotificationItem[] {
    const tenantId = this.resolveUserTenantId(userId);
    const rows = this.sqlite
      .prepare(
        `
          SELECT id, user_id, tenant_id, type, title, message, metadata_json, created_at, read_at
          FROM notifications
          WHERE user_id = ?
            AND tenant_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT 100
        `
      )
      .all(userId, tenantId) as NotificationRow[];

    return rows.map((row) => toNotificationItem(row));
  }

  registerPushToken(params: { userId: string; token: string; platform: AuthPlatform }): void {
    const tenantId = this.resolveUserTenantId(params.userId);
    const timestamp = this.now();
    this.sqlite
      .prepare(
        `
          INSERT INTO user_push_tokens (
            id,
            user_id,
            tenant_id,
            expo_push_token,
            platform,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, expo_push_token)
          DO UPDATE SET platform = excluded.platform,
                        tenant_id = excluded.tenant_id,
                        updated_at = excluded.updated_at
        `
      )
      .run(newId(), params.userId, tenantId, params.token, params.platform, timestamp, timestamp);
  }

  listAnnouncements(userId: string): AnnouncementItem[] {
    const tenantId = this.resolveUserTenantId(userId);
    const rows = this.sqlite
      .prepare(
        `
          SELECT id, tenant_id, seller_user_id, source, event_type, title, body, created_at
          FROM announcements
          WHERE tenant_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT 100
        `
      )
      .all(tenantId) as AnnouncementRow[];

    return rows.map((row) => toAnnouncementItem(row));
  }

  createAnnouncement(params: {
    actorUserId: string;
    title: string;
    body: string;
    requestIp?: string;
  }): AnnouncementItem {
    const tenantId = this.resolveUserTenantId(params.actorUserId);
    const timestamp = this.now();
    const id = newId();

    this.sqlite
      .prepare(
        `
          INSERT INTO announcements (
            id,
            tenant_id,
            seller_user_id,
            source,
            event_type,
            title,
            body,
            created_at
          ) VALUES (?, ?, ?, 'manual', NULL, ?, ?, ?)
        `
      )
      .run(id, tenantId, params.actorUserId, params.title, params.body, timestamp);

    const recipients = this.sqlite
      .prepare(
        `
          SELECT id
          FROM users
          WHERE tenant_id = ?
        `
      )
      .all(tenantId) as Array<{ id: string }>;

    for (const recipient of recipients) {
      this.createNotification({
        userId: recipient.id,
        tenantId,
        type: "announcement",
        title: params.title,
        message: params.body,
        metadata: { announcementId: id, sellerUserId: params.actorUserId }
      });
    }

    this.recordFunnelEvent({
      eventName: "announcement_posted",
      actorUserId: params.actorUserId,
      tenantId,
      requestIp: params.requestIp,
      metadata: { announcementId: id }
    });

    const row = this.sqlite
      .prepare(
        `
          SELECT id, tenant_id, seller_user_id, source, event_type, title, body, created_at
          FROM announcements
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(id) as AnnouncementRow;

    return toAnnouncementItem(row);
  }

  onOfferSubmitted(params: {
    offerId: string;
    listingId: string;
    buyerUserId: string;
    requestIp?: string;
  }): void {
    const context = this.sqlite
      .prepare(
        `
          SELECT seller_user_id, tenant_id
          FROM listings
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(params.listingId) as { seller_user_id: string; tenant_id: string | null } | undefined;

    if (!context?.tenant_id) {
      return;
    }

    this.createNotification({
      userId: context.seller_user_id,
      tenantId: context.tenant_id,
      type: "offer_submitted",
      title: "New offer received",
      message: "A buyer submitted an offer on your listing.",
      metadata: { offerId: params.offerId, listingId: params.listingId, buyerUserId: params.buyerUserId }
    });

    this.recordFunnelEvent({
      eventName: "offer_submitted",
      actorUserId: params.buyerUserId,
      tenantId: context.tenant_id,
      requestIp: params.requestIp,
      metadata: { listingId: params.listingId, offerId: params.offerId }
    });
  }

  onFeedViewed(params: { userId: string; requestIp?: string }): void {
    const tenantId = this.resolveUserTenantId(params.userId);
    this.recordFunnelEvent({
      eventName: "feed_viewed",
      actorUserId: params.userId,
      tenantId,
      requestIp: params.requestIp,
      metadata: {}
    });
  }

  onBasketAdded(params: { listingId: string; buyerUserId: string; requestIp?: string }): void {
    const context = this.sqlite
      .prepare(
        `
          SELECT tenant_id
          FROM listings
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(params.listingId) as { tenant_id: string | null } | undefined;
    if (!context?.tenant_id) {
      return;
    }
    this.recordFunnelEvent({
      eventName: "basket_added",
      actorUserId: params.buyerUserId,
      tenantId: context.tenant_id,
      requestIp: params.requestIp,
      metadata: { listingId: params.listingId }
    });
  }

  onOfferDecision(params: {
    offerId: string;
    sellerUserId: string;
    decision: "accepted" | "declined";
    requestIp?: string;
  }): void {
    const context = this.sqlite
      .prepare(
        `
          SELECT offers.id,
                 offers.listing_id,
                 offers.buyer_user_id,
                 offers.tenant_id
          FROM offers
          WHERE offers.id = ?
          LIMIT 1
        `
      )
      .get(params.offerId) as
      | { id: string; listing_id: string; buyer_user_id: string; tenant_id: string | null }
      | undefined;

    if (!context?.tenant_id) {
      return;
    }

    this.createNotification({
      userId: context.buyer_user_id,
      tenantId: context.tenant_id,
      type: params.decision === "accepted" ? "offer_accepted" : "offer_declined",
      title: params.decision === "accepted" ? "Offer accepted" : "Offer declined",
      message:
        params.decision === "accepted"
          ? "Your offer was accepted by the seller."
          : "Your offer was declined by the seller.",
      metadata: { offerId: params.offerId, listingId: context.listing_id, sellerUserId: params.sellerUserId }
    });

    this.recordFunnelEvent({
      eventName: params.decision === "accepted" ? "offer_accepted" : "offer_declined",
      actorUserId: params.sellerUserId,
      tenantId: context.tenant_id,
      requestIp: params.requestIp,
      metadata: {
        offerId: params.offerId,
        listingId: context.listing_id,
        buyerUserId: context.buyer_user_id
      }
    });
  }

  onSessionStateChanged(params: {
    sessionId: string;
    sellerUserId: string;
    state: "opened" | "closed";
    requestIp?: string;
  }): void {
    const session = this.sqlite
      .prepare(
        `
          SELECT id, tenant_id
          FROM market_sessions
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(params.sessionId) as { id: string; tenant_id: string | null } | undefined;

    if (!session?.tenant_id) {
      return;
    }

    const users = this.sqlite
      .prepare(
        `
          SELECT id
          FROM users
          WHERE tenant_id = ?
        `
      )
      .all(session.tenant_id) as Array<{ id: string }>;

    const announcementId = this.createSystemSessionAnnouncement({
      tenantId: session.tenant_id,
      sellerUserId: params.sellerUserId,
      state: params.state
    });

    for (const user of users) {
      this.createNotification({
        userId: user.id,
        tenantId: session.tenant_id,
        type: params.state === "opened" ? "session_opened" : "session_closed",
        title: params.state === "opened" ? "Market day opened" : "Market day closed",
        message:
          params.state === "opened"
            ? "Seller started a new market day."
            : "Seller closed the market day.",
        metadata: {
          sessionId: params.sessionId,
          sellerUserId: params.sellerUserId,
          announcementId
        }
      });
    }

    this.recordFunnelEvent({
      eventName: params.state === "opened" ? "session_opened" : "session_closed",
      actorUserId: params.sellerUserId,
      tenantId: session.tenant_id,
      requestIp: params.requestIp,
      metadata: { sessionId: params.sessionId }
    });
  }

  onDealStatusChanged(params: {
    dealId: string;
    actorUserId: string;
    status: "paid" | "completed" | "canceled";
    requestIp?: string;
  }): void {
    if (params.status !== "paid") {
      return;
    }

    const context = this.sqlite
      .prepare(
        `
          SELECT deals.listing_id, listings.tenant_id
          FROM deals
          INNER JOIN listings ON listings.id = deals.listing_id
          WHERE deals.id = ?
          LIMIT 1
        `
      )
      .get(params.dealId) as { listing_id: string; tenant_id: string | null } | undefined;
    if (!context?.tenant_id) {
      return;
    }
    this.recordFunnelEvent({
      eventName: "deal_paid",
      actorUserId: params.actorUserId,
      tenantId: context.tenant_id,
      requestIp: params.requestIp,
      metadata: { dealId: params.dealId, listingId: context.listing_id }
    });
  }

  private createNotification(params: {
    userId: string;
    tenantId: string;
    type: NotificationType;
    title: string;
    message: string;
    metadata: Record<string, unknown>;
  }): void {
    const timestamp = this.now();
    const notificationId = newId();

    this.sqlite
      .prepare(
        `
          INSERT INTO notifications (
            id,
            user_id,
            tenant_id,
            type,
            title,
            message,
            metadata_json,
            created_at,
            read_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `
      )
      .run(
        notificationId,
        params.userId,
        params.tenantId,
        params.type,
        params.title,
        params.message,
        JSON.stringify(params.metadata),
        timestamp
      );

    void this.dispatchPushWithRetry({
      notificationId,
      userId: params.userId,
      title: params.title,
      message: params.message,
      metadata: params.metadata
    });
  }

  private createSystemSessionAnnouncement(params: {
    tenantId: string;
    sellerUserId: string;
    state: "opened" | "closed";
  }): string {
    const id = newId();
    const timestamp = this.now();
    this.sqlite
      .prepare(
        `
          INSERT INTO announcements (
            id,
            tenant_id,
            seller_user_id,
            source,
            event_type,
            title,
            body,
            created_at
          ) VALUES (?, ?, ?, 'system', ?, ?, ?, ?)
        `
      )
      .run(
        id,
        params.tenantId,
        params.sellerUserId,
        params.state === "opened" ? "market_session_opened" : "market_session_closed",
        params.state === "opened" ? "Market day opened" : "Market day closed",
        params.state === "opened"
          ? "Seller started a new market day."
          : "Seller closed the market day.",
        timestamp
      );
    return id;
  }

  private async dispatchPushWithRetry(params: {
    notificationId: string;
    userId: string;
    title: string;
    message: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    const tokens = this.sqlite
      .prepare(
        `
          SELECT id, expo_push_token
          FROM user_push_tokens
          WHERE user_id = ?
        `
      )
      .all(params.userId) as Array<{ id: string; expo_push_token: string }>;

    for (const tokenRow of tokens) {
      for (let index = 0; index < RETRY_BACKOFF_MS.length; index += 1) {
        const attempt = index + 1;
        const nowTs = this.now();
        try {
          await this.pushProvider.send({
            token: tokenRow.expo_push_token,
            title: params.title,
            message: params.message,
            data: params.metadata
          });
          this.sqlite
            .prepare(
              `
                INSERT INTO notification_push_attempts (
                  id,
                  notification_id,
                  user_id,
                  push_token_id,
                  attempt,
                  status,
                  error,
                  next_retry_at,
                  created_at
                ) VALUES (?, ?, ?, ?, ?, 'sent', NULL, NULL, ?)
              `
            )
            .run(newId(), params.notificationId, params.userId, tokenRow.id, attempt, nowTs);
          break;
        } catch (error) {
          const hasMoreRetries = attempt < RETRY_BACKOFF_MS.length;
          const backoffMs = RETRY_BACKOFF_MS[attempt] ?? 0;
          const nextRetryAt = hasMoreRetries ? nowTs + backoffMs : null;
          this.sqlite
            .prepare(
              `
                INSERT INTO notification_push_attempts (
                  id,
                  notification_id,
                  user_id,
                  push_token_id,
                  attempt,
                  status,
                  error,
                  next_retry_at,
                  created_at
                ) VALUES (?, ?, ?, ?, ?, 'failed', ?, ?, ?)
              `
            )
            .run(
              newId(),
              params.notificationId,
              params.userId,
              tokenRow.id,
              attempt,
              error instanceof Error ? error.message : String(error),
              nextRetryAt,
              nowTs
            );

          if (!hasMoreRetries) {
            break;
          }
        }
      }
    }
  }

  private recordFunnelEvent(params: {
    eventName: FunnelEventName;
    actorUserId: string;
    tenantId: string;
    requestIp?: string;
    metadata: Record<string, unknown>;
  }): void {
    this.sqlite
      .prepare(
        `
          INSERT INTO audit_events (
            id,
            event_type,
            actor_user_id,
            actor_role,
            target_seller_user_id,
            outcome,
            reason_code,
            request_ip,
            metadata_json,
            created_at
          ) VALUES (?, 'funnel_event', ?, NULL, NULL, 'allowed', ?, ?, ?, ?)
        `
      )
      .run(
        newId(),
        params.actorUserId,
        params.eventName,
        params.requestIp ?? null,
        JSON.stringify({ tenantId: params.tenantId, ...params.metadata }),
        this.now()
      );
  }

  private resolveUserTenantId(userId: string): string {
    const row = this.sqlite
      .prepare(
        `
          SELECT tenant_id
          FROM users
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(userId) as { tenant_id: string } | undefined;

    if (!row?.tenant_id) {
      throw new AuthError("user_not_found", "User was not found", 404);
    }
    return row.tenant_id;
  }
}
