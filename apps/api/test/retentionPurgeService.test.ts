import { afterEach, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "../src/db/client.js";
import { initializeDatabase } from "../src/db/init.js";
import { RetentionPurgeService } from "../src/services/retentionPurgeService.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("RetentionPurgeService", () => {
  let dbClient: DatabaseClient | undefined;

  afterEach(() => {
    dbClient?.close();
    dbClient = undefined;
  });

  it("purges due offer/seller PII, deletes expired audit events, and remains idempotent", () => {
    const now = Date.UTC(2026, 2, 6, 12, 0, 0);
    dbClient = createDatabaseClient(":memory:");
    initializeDatabase(dbClient.sqlite);

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO users(id, phone_e164, display_name, tenant_id, allowed_roles, active_role, created_at)
          VALUES
            ('seller-1', '+14155551111', 'Seller', 'tenant-1', '["buyer","seller"]', 'seller', 1),
            ('buyer-1', '+14155552222', 'Buyer', 'tenant-1', '["buyer"]', 'buyer', 1)
        `
      )
      .run();

    const oldClosedAt = now - 800 * DAY_MS;
    const recentClosedAt = now - 100 * DAY_MS;

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO market_sessions(id, seller_user_id, status, opened_at, closed_at, created_at, updated_at)
          VALUES
            ('session-old', 'seller-1', 'closed', 1, ?, 1, 1),
            ('session-recent', 'seller-1', 'closed', 1, ?, 1, 1)
        `
      )
      .run(oldClosedAt, recentClosedAt);

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO listings(id, seller_user_id, market_session_id, status, created_at, updated_at)
          VALUES
            ('listing-old', 'seller-1', 'session-old', 'sold', 1, 1),
            ('listing-recent', 'seller-1', 'session-recent', 'sold', 1, 1)
        `
      )
      .run();

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO offers(id, listing_id, buyer_user_id, amount_cents, shipping_address, shipping_address_purged_at, status, created_at)
          VALUES
            ('offer-old', 'listing-old', 'buyer-1', 1000, '123 Reel Ave', NULL, 'submitted', 1),
            ('offer-recent', 'listing-recent', 'buyer-1', 1500, '200 Tape St', NULL, 'submitted', 1)
        `
      )
      .run();

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO seller_sales(id, seller_user_id, session_id, listing_id, listing_title, accepted_offer_amount_cents, currency, buyer_user_id, pii_purged_at, sold_at, created_at)
          VALUES
            ('sale-old', 'seller-1', 'session-old', 'listing-old', 'Old Listing', 1000, 'USD', 'buyer-1', NULL, 1, 1),
            ('sale-recent', 'seller-1', 'session-recent', 'listing-recent', 'Recent Listing', 1500, 'USD', 'buyer-1', NULL, 1, 1)
        `
      )
      .run();

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO audit_events(id, event_type, actor_user_id, actor_role, target_seller_user_id, outcome, reason_code, request_ip, metadata_json, created_at)
          VALUES
            ('audit-old', 'seller_sales_csv_export', 'seller-1', 'seller', 'seller-1', 'allowed', 'export_allowed', NULL, '{}', ?),
            ('audit-recent', 'seller_sales_csv_export', 'seller-1', 'seller', 'seller-1', 'allowed', 'export_allowed', NULL, '{}', ?)
        `
      )
      .run(now - 1200 * DAY_MS, now - 300 * DAY_MS);

    const service = new RetentionPurgeService(dbClient.sqlite, () => now);
    const firstRun = service.runDuePurge();
    expect(firstRun).toEqual({
      purgedOfferAddresses: 1,
      purgedSellerSalesPii: 1,
      purgedAuditEvents: 1
    });

    const oldOffer = dbClient.sqlite
      .prepare("SELECT shipping_address, shipping_address_purged_at FROM offers WHERE id = 'offer-old'")
      .get() as { shipping_address: string; shipping_address_purged_at: number | null };
    expect(oldOffer.shipping_address).toBe("purged");
    expect(oldOffer.shipping_address_purged_at).toBe(now);

    const recentOffer = dbClient.sqlite
      .prepare("SELECT shipping_address, shipping_address_purged_at FROM offers WHERE id = 'offer-recent'")
      .get() as { shipping_address: string; shipping_address_purged_at: number | null };
    expect(recentOffer.shipping_address).toBe("200 Tape St");
    expect(recentOffer.shipping_address_purged_at).toBeNull();

    const oldSale = dbClient.sqlite
      .prepare("SELECT buyer_user_id, pii_purged_at FROM seller_sales WHERE id = 'sale-old'")
      .get() as { buyer_user_id: string; pii_purged_at: number | null };
    expect(oldSale.buyer_user_id).toBe("system-purged-user");
    expect(oldSale.pii_purged_at).toBe(now);

    const recentSale = dbClient.sqlite
      .prepare("SELECT buyer_user_id, pii_purged_at FROM seller_sales WHERE id = 'sale-recent'")
      .get() as { buyer_user_id: string; pii_purged_at: number | null };
    expect(recentSale.buyer_user_id).toBe("buyer-1");
    expect(recentSale.pii_purged_at).toBeNull();

    const remainingAuditIds = dbClient.sqlite
      .prepare("SELECT id FROM audit_events ORDER BY id ASC")
      .all() as Array<{ id: string }>;
    expect(remainingAuditIds).toEqual([{ id: "audit-recent" }]);

    const secondRun = service.runDuePurge();
    expect(secondRun).toEqual({
      purgedOfferAddresses: 0,
      purgedSellerSalesPii: 0,
      purgedAuditEvents: 0
    });
  });

  it("reports due backlog and SLA breach when overdue offer purges accumulate", () => {
    const now = Date.UTC(2026, 2, 6, 12, 0, 0);
    dbClient = createDatabaseClient(":memory:");
    initializeDatabase(dbClient.sqlite);

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO users(id, phone_e164, display_name, tenant_id, allowed_roles, active_role, created_at)
          VALUES
            ('seller-2', '+14155553333', 'Seller Two', 'tenant-1', '["buyer","seller"]', 'seller', 1),
            ('buyer-2', '+14155554444', 'Buyer Two', 'tenant-1', '["buyer"]', 'buyer', 1)
        `
      )
      .run();

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO market_sessions(id, seller_user_id, status, opened_at, closed_at, created_at, updated_at)
          VALUES ('session-overdue', 'seller-2', 'closed', 1, ?, 1, 1)
        `
      )
      .run(now - (365 + 2) * DAY_MS);

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO listings(id, seller_user_id, market_session_id, status, created_at, updated_at)
          VALUES ('listing-overdue', 'seller-2', 'session-overdue', 'sold', 1, 1)
        `
      )
      .run();

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO offers(id, listing_id, buyer_user_id, amount_cents, shipping_address, shipping_address_purged_at, status, created_at)
          VALUES ('offer-overdue', 'listing-overdue', 'buyer-2', 1999, 'Old Address', NULL, 'declined', 1)
        `
      )
      .run();

    const service = new RetentionPurgeService(dbClient.sqlite, () => now);
    const before = service.getMetrics();
    expect(before.dueOfferAddressPurges).toBe(1);
    expect(before.offerBacklogSlaBreached).toBe(true);
    expect(before.lastRunStatus).toBe("never");

    service.runDuePurge();
    const after = service.getMetrics();
    expect(after.dueOfferAddressPurges).toBe(0);
    expect(after.lastRunStatus).toBe("succeeded");
  });
});
