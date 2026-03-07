import { afterEach, describe, expect, it } from "vitest";
import { createDatabaseClient, type DatabaseClient } from "../src/db/client.js";
import { initializeDatabase } from "../src/db/init.js";

describe("tenant_id materialization", () => {
  let dbClient: DatabaseClient | undefined;

  afterEach(() => {
    dbClient?.close();
    dbClient = undefined;
  });

  it("backfills tenant_id columns for legacy marketplace rows", () => {
    dbClient = createDatabaseClient(":memory:");
    initializeDatabase(dbClient.sqlite);

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO users(id, phone_e164, tenant_id, allowed_roles, active_role, created_at)
          VALUES
            ('seller-legacy', '+14155551110', 'tenant-legacy', '["buyer","seller"]', 'seller', 1),
            ('buyer-legacy', '+14155552220', 'tenant-legacy', '["buyer"]', 'buyer', 1)
        `
      )
      .run();

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO seller_applications(
            id,
            user_id,
            tenant_id,
            status,
            created_at,
            updated_at
          ) VALUES ('app-legacy', 'seller-legacy', NULL, 'pending', 1, 1)
        `
      )
      .run();

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO market_sessions(
            id,
            seller_user_id,
            tenant_id,
            status,
            opened_at,
            closed_at,
            created_at,
            updated_at
          ) VALUES ('session-legacy', 'seller-legacy', NULL, 'closed', 1, 1, 1, 1)
        `
      )
      .run();

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO listings(
            id,
            seller_user_id,
            market_session_id,
            tenant_id,
            status,
            created_at,
            updated_at
          ) VALUES ('listing-legacy', 'seller-legacy', 'session-legacy', NULL, 'sold', 1, 1)
        `
      )
      .run();

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO basket_items(
            id,
            listing_id,
            buyer_user_id,
            tenant_id,
            created_at
          ) VALUES ('basket-legacy', 'listing-legacy', 'buyer-legacy', NULL, 1)
        `
      )
      .run();

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO offers(
            id,
            listing_id,
            buyer_user_id,
            tenant_id,
            amount_cents,
            shipping_address,
            status,
            created_at
          ) VALUES ('offer-legacy', 'listing-legacy', 'buyer-legacy', NULL, 1900, '123 Reel Ave', 'submitted', 1)
        `
      )
      .run();

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
          ) VALUES (
            'sale-legacy',
            'seller-legacy',
            NULL,
            'session-legacy',
            'listing-legacy',
            'Legacy Listing',
            1900,
            'USD',
            'buyer-legacy',
            1,
            1
          )
        `
      )
      .run();

    initializeDatabase(dbClient.sqlite);

    const expectedTenant = "tenant-legacy";
    expect(
      dbClient.sqlite
        .prepare("SELECT tenant_id FROM seller_applications WHERE id = 'app-legacy'")
        .get() as { tenant_id: string }
    ).toEqual({ tenant_id: expectedTenant });
    expect(
      dbClient.sqlite
        .prepare("SELECT tenant_id FROM market_sessions WHERE id = 'session-legacy'")
        .get() as { tenant_id: string }
    ).toEqual({ tenant_id: expectedTenant });
    expect(
      dbClient.sqlite
        .prepare("SELECT tenant_id FROM listings WHERE id = 'listing-legacy'")
        .get() as { tenant_id: string }
    ).toEqual({ tenant_id: expectedTenant });
    expect(
      dbClient.sqlite
        .prepare("SELECT tenant_id FROM basket_items WHERE id = 'basket-legacy'")
        .get() as { tenant_id: string }
    ).toEqual({ tenant_id: expectedTenant });
    expect(
      dbClient.sqlite
        .prepare("SELECT tenant_id FROM offers WHERE id = 'offer-legacy'")
        .get() as { tenant_id: string }
    ).toEqual({ tenant_id: expectedTenant });
    expect(
      dbClient.sqlite
        .prepare("SELECT tenant_id FROM seller_sales WHERE id = 'sale-legacy'")
        .get() as { tenant_id: string }
    ).toEqual({ tenant_id: expectedTenant });
  });

  it("creates tenant-scoped indexes", () => {
    dbClient = createDatabaseClient(":memory:");
    initializeDatabase(dbClient.sqlite);

    const indexNames = (
      dbClient.sqlite
        .prepare(
          `
            SELECT name
            FROM sqlite_master
            WHERE type = 'index'
              AND name LIKE 'idx_%tenant%'
            ORDER BY name ASC
          `
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name);

    expect(indexNames).toEqual(
      expect.arrayContaining([
        "idx_seller_applications_tenant_status",
        "idx_market_sessions_tenant_seller_status",
        "idx_listings_tenant_status_created",
        "idx_basket_items_tenant_listing_user",
        "idx_offers_tenant_listing_status",
        "idx_seller_sales_tenant_seller_sold_at"
      ])
    );
  });
});
