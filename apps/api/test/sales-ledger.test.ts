import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { createDatabaseClient } from "../src/db/client.js";
import {
  buildMockMuxClient,
  buildTestConfig,
  createAuthenticatedBuyer,
  createAuthenticatedSeller,
  createAuthenticatedSession,
  createAuthenticatedUser,
  TestSmsProvider
} from "./helpers/apiTestHarness.js";

describe("sales ledger api", () => {
  it("enforces seller sales CSV export auth matrix", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550001",
      "ios-device-sales-seller"
    );
    const buyer = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550002",
      "ios-device-sales-buyer"
    );
    const admin = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550003",
      "ios-device-sales-admin"
    );
    const otherSeller = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550004",
      "ios-device-sales-other-seller"
    );
    const crossTenantSeller = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550005",
      "ios-device-sales-cross-tenant-seller"
    );

    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ?, active_role = ? WHERE id = ?")
      .run(JSON.stringify(["buyer", "seller"]), "seller", seller.userId);
    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ?, active_role = ? WHERE id = ?")
      .run(JSON.stringify(["buyer"]), "buyer", buyer.userId);
    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ?, active_role = ? WHERE id = ?")
      .run(JSON.stringify(["buyer", "admin"]), "admin", admin.userId);
    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ?, active_role = ? WHERE id = ?")
      .run(JSON.stringify(["buyer", "seller"]), "seller", otherSeller.userId);
    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ?, active_role = ?, tenant_id = ? WHERE id = ?")
      .run(JSON.stringify(["buyer", "seller"]), "seller", "tenant-cross", crossTenantSeller.userId);

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO seller_sales(
            id,
            seller_user_id,
            tenant_id,
            session_id,
            listing_id,
            listing_title,
            accepted_offer_amount_cents,
            currency,
            buyer_user_id,
            sold_at,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        "sale-1",
        seller.userId,
        "default",
        "session-1",
        "listing-1",
        "Rare Film Reel",
        12000,
        "USD",
        buyer.userId,
        Date.now(),
        Date.now()
      );

    const sellerExport = await app.inject({
      method: "GET",
      url: "/v1/seller/sales.csv",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(sellerExport.statusCode).toBe(200);
    expect(sellerExport.headers["content-type"]).toContain("text/csv");
    expect(sellerExport.body).toContain("Rare Film Reel");

    const foreignSellerExport = await app.inject({
      method: "GET",
      url: `/v1/seller/sales.csv?sellerUserId=${otherSeller.userId}`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(foreignSellerExport.statusCode).toBe(403);
    expect(foreignSellerExport.json()).toMatchObject({
      code: "forbidden_export_scope"
    });

    const buyerExport = await app.inject({
      method: "GET",
      url: "/v1/seller/sales.csv",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      }
    });
    expect(buyerExport.statusCode).toBe(403);
    expect(buyerExport.json()).toMatchObject({
      code: "forbidden_export_role"
    });

    const adminExport = await app.inject({
      method: "GET",
      url: `/v1/seller/sales.csv?sellerUserId=${seller.userId}`,
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      }
    });
    expect(adminExport.statusCode).toBe(200);
    expect(adminExport.body).toContain("Rare Film Reel");

    const adminCrossTenantExport = await app.inject({
      method: "GET",
      url: `/v1/seller/sales.csv?sellerUserId=${crossTenantSeller.userId}`,
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      }
    });
    expect(adminCrossTenantExport.statusCode).toBe(403);
    expect(adminCrossTenantExport.json()).toMatchObject({
      code: "forbidden_tenant_scope"
    });

    const auditRows = dbClient.sqlite
      .prepare(
        `
          SELECT event_type, actor_user_id, actor_role, target_seller_user_id, outcome, reason_code, metadata_json
          FROM audit_events
          WHERE event_type = 'seller_sales_csv_export'
          ORDER BY created_at ASC
        `
      )
      .all() as Array<{
      event_type: string;
      actor_user_id: string;
      actor_role: string;
      target_seller_user_id: string | null;
      outcome: string;
      reason_code: string;
      metadata_json: string;
    }>;

    expect(auditRows).toHaveLength(5);
    const allowedCount = auditRows.filter((row) => row.outcome === "allowed").length;
    const deniedCount = auditRows.filter((row) => row.outcome === "denied").length;
    expect(allowedCount).toBe(2);
    expect(deniedCount).toBe(3);
    const reasonCodes = new Set(auditRows.map((row) => row.reason_code));
    expect(reasonCodes.has("export_allowed")).toBe(true);
    expect(reasonCodes.has("forbidden_export_scope")).toBe(true);
    expect(reasonCodes.has("forbidden_export_role")).toBe(true);
    expect(reasonCodes.has("forbidden_tenant_scope")).toBe(true);
    expect(auditRows.every((row) => !row.metadata_json.includes("address"))).toBe(true);

    await app.close();
  });

  it("denies suspended sellers and records denial audit event", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550009",
      "ios-device-sales-suspended-seller"
    );

    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ?, active_role = ?, suspended_at = ? WHERE id = ?")
      .run(JSON.stringify(["buyer", "seller"]), "seller", Date.now(), seller.userId);

    const response = await app.inject({
      method: "GET",
      url: "/v1/seller/sales.csv",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: "forbidden_seller_suspended"
    });

    const auditRow = dbClient.sqlite
      .prepare(
        `
          SELECT reason_code, outcome
          FROM audit_events
          WHERE event_type = 'seller_sales_csv_export'
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get() as { reason_code: string; outcome: string } | undefined;

    expect(auditRow).toMatchObject({
      reason_code: "forbidden_seller_suspended",
      outcome: "denied"
    });

    await app.close();
  });

  it("returns seller ledger and applies session/day filters to ledger and csv export", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550010",
      "ios-device-sales-filter-seller"
    );
    const buyer = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550011",
      "ios-device-sales-filter-buyer"
    );
    const admin = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550012",
      "ios-device-sales-filter-admin"
    );

    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ?, active_role = ? WHERE id = ?")
      .run(JSON.stringify(["buyer", "seller"]), "seller", seller.userId);
    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ?, active_role = ? WHERE id = ?")
      .run(JSON.stringify(["buyer"]), "buyer", buyer.userId);
    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ?, active_role = ? WHERE id = ?")
      .run(JSON.stringify(["buyer", "admin"]), "admin", admin.userId);

    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    const todayMorning = Date.parse(`${today}T09:00:00.000Z`);
    const todayEvening = Date.parse(`${today}T18:00:00.000Z`);
    const previousDayTs = todayMorning - 24 * 60 * 60 * 1000;

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO seller_sales(
            id,
            seller_user_id,
            tenant_id,
            session_id,
            listing_id,
            listing_title,
            accepted_offer_amount_cents,
            currency,
            buyer_user_id,
            sold_at,
            created_at
          ) VALUES
            ('sale-f1', ?, 'default', 'session-a', 'listing-f1', 'Film A', 9000, 'USD', ?, ?, ?),
            ('sale-f2', ?, 'default', 'session-b', 'listing-f2', 'Film B', 12000, 'USD', ?, ?, ?),
            ('sale-f3', ?, 'default', 'session-a', 'listing-f3', 'Film C', 15000, 'USD', ?, ?, ?)
        `
      )
      .run(
        seller.userId,
        buyer.userId,
        todayMorning,
        todayMorning,
        seller.userId,
        buyer.userId,
        todayEvening,
        todayEvening,
        seller.userId,
        buyer.userId,
        previousDayTs,
        previousDayTs
      );

    const ledgerResponse = await app.inject({
      method: "GET",
      url: "/v1/seller/sales?sessionId=session-a&day=" + today,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(ledgerResponse.statusCode).toBe(200);
    const ledger = ledgerResponse.json() as {
      sales: Array<{ listingId: string; fulfillmentStatus: string }>;
    };
    expect(ledger.sales).toHaveLength(1);
    expect(ledger.sales[0]).toMatchObject({
      listingId: "listing-f1",
      fulfillmentStatus: "unknown"
    });

    const adminLedger = await app.inject({
      method: "GET",
      url: `/v1/seller/sales?sellerUserId=${seller.userId}&day=${today}`,
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      }
    });
    expect(adminLedger.statusCode).toBe(200);
    expect((adminLedger.json() as { sales: unknown[] }).sales).toHaveLength(2);

    const csvResponse = await app.inject({
      method: "GET",
      url: `/v1/seller/sales.csv?sessionId=session-b&day=${today}`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(csvResponse.statusCode).toBe(200);
    const csvLines = csvResponse.body.trim().split("\n");
    expect(csvLines).toHaveLength(2);
    expect(csvLines[1]).toContain("listing-f2");
    expect(csvLines[1]).toContain("unknown");

    const invalidDay = await app.inject({
      method: "GET",
      url: "/v1/seller/sales?day=11-03-2026",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(invalidDay.statusCode).toBe(400);
    expect(invalidDay.json()).toMatchObject({
      code: "invalid_request"
    });

    await app.close();
  });
});
