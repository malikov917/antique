import type { Database } from "better-sqlite3";
import { newId } from "../auth/crypto.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFER_RETENTION_MS = 365 * DAY_MS;
const SELLER_SALES_RETENTION_MS = 730 * DAY_MS;
const AUDIT_RETENTION_MS = 1095 * DAY_MS;
const SLA_LAG_MS = 24 * 60 * 60 * 1000;
const PURGED_VALUE = "purged";
const PURGED_BUYER_USER_ID = "system-purged-user";
const PURGED_BUYER_PHONE = "+10000000000";

export interface RetentionPurgeRunResult {
  purgedOfferAddresses: number;
  purgedSellerSalesPii: number;
  purgedAuditEvents: number;
}

export interface RetentionPurgeMetrics {
  dueOfferAddressPurges: number;
  dueSellerSalesPiiPurges: number;
  dueAuditEventPurges: number;
  oldestDueOfferClosedAt: string | null;
  offerBacklogAgeMs: number;
  offerBacklogSlaBreached: boolean;
  lastRunStatus: "succeeded" | "failed" | "never";
  lastRunAt: string | null;
}

export class RetentionPurgeService {
  constructor(
    private readonly sqlite: Database,
    private readonly now: () => number = () => Date.now()
  ) {}

  runDuePurge(): RetentionPurgeRunResult {
    const nowTs = this.now();
    const startedAt = nowTs;
    const runId = newId();
    this.sqlite
      .prepare(
        `
          INSERT INTO retention_purge_runs(id, started_at, status)
          VALUES(?, ?, 'running')
        `
      )
      .run(runId, startedAt);

    try {
      this.ensurePurgedBuyerUser(nowTs);

      const result = this.sqlite.transaction(() => {
        const offerThreshold = nowTs - OFFER_RETENTION_MS;
        const sellerSalesThreshold = nowTs - SELLER_SALES_RETENTION_MS;
        const auditThreshold = nowTs - AUDIT_RETENTION_MS;

        const purgedOfferAddresses = this.sqlite
          .prepare(
            `
              UPDATE offers
              SET shipping_address = ?,
                  shipping_address_purged_at = ?
              WHERE shipping_address_purged_at IS NULL
                AND listing_id IN (
                  SELECT listings.id
                  FROM listings
                  INNER JOIN market_sessions ON market_sessions.id = listings.market_session_id
                  WHERE listings.status IN ('day_closed', 'sold', 'withdrawn')
                    AND market_sessions.status = 'closed'
                    AND market_sessions.closed_at IS NOT NULL
                    AND market_sessions.closed_at <= ?
                )
            `
          )
          .run(PURGED_VALUE, nowTs, offerThreshold).changes;

        const purgedSellerSalesPii = this.sqlite
          .prepare(
            `
              UPDATE seller_sales
              SET buyer_user_id = ?,
                  pii_purged_at = ?
              WHERE pii_purged_at IS NULL
                AND session_id IN (
                  SELECT id
                  FROM market_sessions
                  WHERE status = 'closed'
                    AND closed_at IS NOT NULL
                    AND closed_at <= ?
                )
            `
          )
          .run(PURGED_BUYER_USER_ID, nowTs, sellerSalesThreshold).changes;

        const purgedAuditEvents = this.sqlite
          .prepare(
            `
              DELETE FROM audit_events
              WHERE created_at <= ?
            `
          )
          .run(auditThreshold).changes;

        return {
          purgedOfferAddresses,
          purgedSellerSalesPii,
          purgedAuditEvents
        };
      })();

      this.sqlite
        .prepare(
          `
            UPDATE retention_purge_runs
            SET completed_at = ?,
                status = 'succeeded',
                purged_offer_addresses = ?,
                purged_seller_sales_pii = ?,
                purged_audit_events = ?
            WHERE id = ?
          `
        )
        .run(
          nowTs,
          result.purgedOfferAddresses,
          result.purgedSellerSalesPii,
          result.purgedAuditEvents,
          runId
        );

      return result;
    } catch (error) {
      this.sqlite
        .prepare(
          `
            UPDATE retention_purge_runs
            SET completed_at = ?,
                status = 'failed',
                error_message = ?
            WHERE id = ?
          `
        )
        .run(nowTs, error instanceof Error ? error.message : "unknown_error", runId);
      throw error;
    }
  }

  getMetrics(): RetentionPurgeMetrics {
    const nowTs = this.now();
    const offerThreshold = nowTs - OFFER_RETENTION_MS;
    const sellerSalesThreshold = nowTs - SELLER_SALES_RETENTION_MS;
    const auditThreshold = nowTs - AUDIT_RETENTION_MS;

    const dueOfferAddressPurges = this.sqlite
      .prepare(
        `
          SELECT COUNT(*) AS total
          FROM offers
          WHERE shipping_address_purged_at IS NULL
            AND listing_id IN (
              SELECT listings.id
              FROM listings
              INNER JOIN market_sessions ON market_sessions.id = listings.market_session_id
              WHERE listings.status IN ('day_closed', 'sold', 'withdrawn')
                AND market_sessions.status = 'closed'
                AND market_sessions.closed_at IS NOT NULL
                AND market_sessions.closed_at <= ?
            )
        `
      )
      .get(offerThreshold) as { total: number };

    const dueSellerSalesPiiPurges = this.sqlite
      .prepare(
        `
          SELECT COUNT(*) AS total
          FROM seller_sales
          WHERE pii_purged_at IS NULL
            AND session_id IN (
              SELECT id
              FROM market_sessions
              WHERE status = 'closed'
                AND closed_at IS NOT NULL
                AND closed_at <= ?
            )
        `
      )
      .get(sellerSalesThreshold) as { total: number };

    const dueAuditEventPurges = this.sqlite
      .prepare("SELECT COUNT(*) AS total FROM audit_events WHERE created_at <= ?")
      .get(auditThreshold) as { total: number };

    const oldestDueOffer = this.sqlite
      .prepare(
        `
          SELECT MIN(market_sessions.closed_at) AS closed_at
          FROM offers
          INNER JOIN listings ON listings.id = offers.listing_id
          INNER JOIN market_sessions ON market_sessions.id = listings.market_session_id
          WHERE offers.shipping_address_purged_at IS NULL
            AND listings.status IN ('day_closed', 'sold', 'withdrawn')
            AND market_sessions.status = 'closed'
            AND market_sessions.closed_at IS NOT NULL
            AND market_sessions.closed_at <= ?
        `
      )
      .get(offerThreshold) as { closed_at: number | null };

    const backlogAgeMs =
      oldestDueOffer.closed_at === null ? 0 : Math.max(0, nowTs - (oldestDueOffer.closed_at + OFFER_RETENTION_MS));

    const lastRun = this.sqlite
      .prepare(
        `
          SELECT status, started_at
          FROM retention_purge_runs
          ORDER BY started_at DESC
          LIMIT 1
        `
      )
      .get() as { status: "running" | "succeeded" | "failed"; started_at: number } | undefined;

    return {
      dueOfferAddressPurges: dueOfferAddressPurges.total,
      dueSellerSalesPiiPurges: dueSellerSalesPiiPurges.total,
      dueAuditEventPurges: dueAuditEventPurges.total,
      oldestDueOfferClosedAt:
        oldestDueOffer.closed_at === null ? null : new Date(oldestDueOffer.closed_at).toISOString(),
      offerBacklogAgeMs: backlogAgeMs,
      offerBacklogSlaBreached: backlogAgeMs > SLA_LAG_MS,
      lastRunStatus:
        lastRun === undefined ? "never" : lastRun.status === "failed" ? "failed" : "succeeded",
      lastRunAt: lastRun === undefined ? null : new Date(lastRun.started_at).toISOString()
    };
  }

  private ensurePurgedBuyerUser(nowTs: number): void {
    this.sqlite
      .prepare(
        `
          INSERT OR IGNORE INTO users(
            id,
            phone_e164,
            display_name,
            tenant_id,
            allowed_roles,
            active_role,
            seller_profile_id,
            suspended_at,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)
        `
      )
      .run(
        PURGED_BUYER_USER_ID,
        PURGED_BUYER_PHONE,
        "Purged User",
        "system",
        JSON.stringify(["buyer"]),
        "buyer",
        nowTs
      );
  }
}
