import type { Database } from "better-sqlite3";

function countRows(sqlite: Database, query: string): number {
  const row = sqlite.prepare(query).get() as { count: number } | undefined;
  return row?.count ?? 0;
}

function assertNoRows(sqlite: Database, query: string, message: string): void {
  if (countRows(sqlite, query) > 0) {
    throw new Error(message);
  }
}

function validateTenantMaterialization(sqlite: Database): void {
  assertNoRows(
    sqlite,
    `
      SELECT COUNT(*) AS count
      FROM seller_applications
      WHERE tenant_id IS NULL
    `,
    "tenant_materialization_incomplete:seller_applications"
  );
  assertNoRows(
    sqlite,
    `
      SELECT COUNT(*) AS count
      FROM market_sessions
      WHERE tenant_id IS NULL
    `,
    "tenant_materialization_incomplete:market_sessions"
  );
  assertNoRows(
    sqlite,
    `
      SELECT COUNT(*) AS count
      FROM listings
      WHERE tenant_id IS NULL
    `,
    "tenant_materialization_incomplete:listings"
  );
  assertNoRows(
    sqlite,
    `
      SELECT COUNT(*) AS count
      FROM basket_items
      WHERE tenant_id IS NULL
    `,
    "tenant_materialization_incomplete:basket_items"
  );
  assertNoRows(
    sqlite,
    `
      SELECT COUNT(*) AS count
      FROM offers
      WHERE tenant_id IS NULL
    `,
    "tenant_materialization_incomplete:offers"
  );
  assertNoRows(
    sqlite,
    `
      SELECT COUNT(*) AS count
      FROM seller_sales
      WHERE tenant_id IS NULL
    `,
    "tenant_materialization_incomplete:seller_sales"
  );

  assertNoRows(
    sqlite,
    `
      SELECT COUNT(*) AS count
      FROM listings
      JOIN market_sessions ON market_sessions.id = listings.market_session_id
      WHERE listings.tenant_id != market_sessions.tenant_id
    `,
    "tenant_materialization_mismatch:listings_vs_market_sessions"
  );
  assertNoRows(
    sqlite,
    `
      SELECT COUNT(*) AS count
      FROM basket_items
      JOIN listings ON listings.id = basket_items.listing_id
      WHERE basket_items.tenant_id != listings.tenant_id
    `,
    "tenant_materialization_mismatch:basket_items_vs_listings"
  );
  assertNoRows(
    sqlite,
    `
      SELECT COUNT(*) AS count
      FROM offers
      JOIN listings ON listings.id = offers.listing_id
      WHERE offers.tenant_id != listings.tenant_id
    `,
    "tenant_materialization_mismatch:offers_vs_listings"
  );
  assertNoRows(
    sqlite,
    `
      SELECT COUNT(*) AS count
      FROM seller_sales
      JOIN listings ON listings.id = seller_sales.listing_id
      WHERE seller_sales.tenant_id != listings.tenant_id
    `,
    "tenant_materialization_mismatch:seller_sales_vs_listings"
  );
}

export function initializeDatabase(sqlite: Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      phone_e164 TEXT NOT NULL UNIQUE,
      display_name TEXT,
      tenant_id TEXT NOT NULL,
      allowed_roles TEXT NOT NULL,
      active_role TEXT NOT NULL,
      seller_profile_id TEXT,
      suspended_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS otp_challenges (
      id TEXT PRIMARY KEY,
      phone_e164 TEXT NOT NULL,
      ip_hash TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      max_attempts INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      consumed_at INTEGER,
      invalidated_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_otp_phone_created ON otp_challenges(phone_e164, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_otp_phone_active ON otp_challenges(phone_e164, expires_at);
    CREATE INDEX IF NOT EXISTS idx_otp_phone_ip_created ON otp_challenges(phone_e164, ip_hash, created_at DESC);

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user_created ON sessions(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      family_id TEXT NOT NULL,
      parent_token_id TEXT,
      replaced_by_token_id TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      revoked_reason TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_refresh_family ON refresh_tokens(family_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_session ON refresh_tokens(session_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

    CREATE TABLE IF NOT EXISTS seller_applications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      tenant_id TEXT,
      status TEXT NOT NULL,
      full_name TEXT,
      shop_name TEXT,
      note TEXT,
      rejection_reason TEXT,
      submitted_at INTEGER,
      reviewed_at INTEGER,
      reviewed_by_user_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_seller_applications_status ON seller_applications(status);
    CREATE INDEX IF NOT EXISTS idx_seller_applications_tenant_status
      ON seller_applications(tenant_id, status);

    CREATE TABLE IF NOT EXISTS market_sessions (
      id TEXT PRIMARY KEY,
      seller_user_id TEXT NOT NULL,
      tenant_id TEXT,
      status TEXT NOT NULL,
      opened_at INTEGER NOT NULL,
      closed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (seller_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_market_sessions_seller_status
      ON market_sessions(seller_user_id, status);
    CREATE INDEX IF NOT EXISTS idx_market_sessions_tenant_seller_status
      ON market_sessions(tenant_id, seller_user_id, status);

    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      seller_user_id TEXT NOT NULL,
      market_session_id TEXT NOT NULL,
      tenant_id TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (seller_user_id) REFERENCES users(id),
      FOREIGN KEY (market_session_id) REFERENCES market_sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_listings_session_status
      ON listings(market_session_id, status);
    CREATE INDEX IF NOT EXISTS idx_listings_tenant_status_created
      ON listings(tenant_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS basket_items (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      buyer_user_id TEXT NOT NULL,
      tenant_id TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (listing_id) REFERENCES listings(id),
      FOREIGN KEY (buyer_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_basket_items_listing_user
      ON basket_items(listing_id, buyer_user_id);
    CREATE INDEX IF NOT EXISTS idx_basket_items_tenant_listing_user
      ON basket_items(tenant_id, listing_id, buyer_user_id);

    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      buyer_user_id TEXT NOT NULL,
      tenant_id TEXT,
      amount_cents INTEGER NOT NULL,
      shipping_address TEXT NOT NULL,
      shipping_address_purged_at INTEGER,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (listing_id) REFERENCES listings(id),
      FOREIGN KEY (buyer_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_offers_listing_status ON offers(listing_id, status);
    CREATE INDEX IF NOT EXISTS idx_offers_tenant_listing_status ON offers(tenant_id, listing_id, status);
    CREATE INDEX IF NOT EXISTS idx_offers_shipping_purge ON offers(shipping_address_purged_at);

    CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL UNIQUE,
      accepted_offer_id TEXT NOT NULL UNIQUE,
      seller_user_id TEXT NOT NULL,
      buyer_user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (listing_id) REFERENCES listings(id),
      FOREIGN KEY (accepted_offer_id) REFERENCES offers(id),
      FOREIGN KEY (seller_user_id) REFERENCES users(id),
      FOREIGN KEY (buyer_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_deals_seller_created_at
      ON deals(seller_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS seller_sales (
      id TEXT PRIMARY KEY,
      seller_user_id TEXT NOT NULL,
      tenant_id TEXT,
      session_id TEXT NOT NULL,
      listing_id TEXT NOT NULL,
      listing_title TEXT NOT NULL,
      accepted_offer_amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      buyer_user_id TEXT NOT NULL,
      pii_purged_at INTEGER,
      sold_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (seller_user_id) REFERENCES users(id),
      FOREIGN KEY (buyer_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_seller_sales_seller_sold_at
      ON seller_sales(seller_user_id, sold_at DESC);
    CREATE INDEX IF NOT EXISTS idx_seller_sales_tenant_seller_sold_at
      ON seller_sales(tenant_id, seller_user_id, sold_at DESC);
    CREATE INDEX IF NOT EXISTS idx_seller_sales_pii_purged_at ON seller_sales(pii_purged_at);

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      actor_user_id TEXT,
      actor_role TEXT,
      target_seller_user_id TEXT,
      outcome TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      request_ip TEXT,
      metadata_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_events_type_created
      ON audit_events(event_type, created_at DESC);

    CREATE TABLE IF NOT EXISTS retention_purge_runs (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      status TEXT NOT NULL,
      purged_offer_addresses INTEGER NOT NULL DEFAULT 0,
      purged_seller_sales_pii INTEGER NOT NULL DEFAULT 0,
      purged_audit_events INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_retention_purge_runs_started_at
      ON retention_purge_runs(started_at DESC);
  `);

  const userColumns = sqlite.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === "display_name")) {
    sqlite.exec("ALTER TABLE users ADD COLUMN display_name TEXT");
  }
  if (!userColumns.some((column) => column.name === "suspended_at")) {
    sqlite.exec("ALTER TABLE users ADD COLUMN suspended_at INTEGER");
  }

  const sellerApplicationColumns = sqlite
    .prepare("PRAGMA table_info(seller_applications)")
    .all() as Array<{ name: string }>;
  if (!sellerApplicationColumns.some((column) => column.name === "reviewed_by_user_id")) {
    sqlite.exec("ALTER TABLE seller_applications ADD COLUMN reviewed_by_user_id TEXT");
  }
  if (!sellerApplicationColumns.some((column) => column.name === "tenant_id")) {
    sqlite.exec("ALTER TABLE seller_applications ADD COLUMN tenant_id TEXT");
  }

  const marketSessionColumns = sqlite.prepare("PRAGMA table_info(market_sessions)").all() as Array<{
    name: string;
  }>;
  if (!marketSessionColumns.some((column) => column.name === "tenant_id")) {
    sqlite.exec("ALTER TABLE market_sessions ADD COLUMN tenant_id TEXT");
  }

  const listingColumns = sqlite.prepare("PRAGMA table_info(listings)").all() as Array<{ name: string }>;
  if (!listingColumns.some((column) => column.name === "tenant_id")) {
    sqlite.exec("ALTER TABLE listings ADD COLUMN tenant_id TEXT");
  }

  const basketItemColumns = sqlite.prepare("PRAGMA table_info(basket_items)").all() as Array<{
    name: string;
  }>;
  if (!basketItemColumns.some((column) => column.name === "tenant_id")) {
    sqlite.exec("ALTER TABLE basket_items ADD COLUMN tenant_id TEXT");
  }

  const offerColumns = sqlite.prepare("PRAGMA table_info(offers)").all() as Array<{ name: string }>;
  if (!offerColumns.some((column) => column.name === "shipping_address_purged_at")) {
    sqlite.exec("ALTER TABLE offers ADD COLUMN shipping_address_purged_at INTEGER");
  }
  if (!offerColumns.some((column) => column.name === "tenant_id")) {
    sqlite.exec("ALTER TABLE offers ADD COLUMN tenant_id TEXT");
  }

  const sellerSalesColumns = sqlite.prepare("PRAGMA table_info(seller_sales)").all() as Array<{ name: string }>;
  if (!sellerSalesColumns.some((column) => column.name === "pii_purged_at")) {
    sqlite.exec("ALTER TABLE seller_sales ADD COLUMN pii_purged_at INTEGER");
  }
  if (!sellerSalesColumns.some((column) => column.name === "tenant_id")) {
    sqlite.exec("ALTER TABLE seller_sales ADD COLUMN tenant_id TEXT");
  }

  sqlite.exec(`
    UPDATE seller_applications
    SET tenant_id = (
      SELECT users.tenant_id
      FROM users
      WHERE users.id = seller_applications.user_id
    )
    WHERE tenant_id IS NULL;

    UPDATE market_sessions
    SET tenant_id = (
      SELECT users.tenant_id
      FROM users
      WHERE users.id = market_sessions.seller_user_id
    )
    WHERE tenant_id IS NULL;

    UPDATE listings
    SET tenant_id = COALESCE(
      (
        SELECT market_sessions.tenant_id
        FROM market_sessions
        WHERE market_sessions.id = listings.market_session_id
      ),
      (
        SELECT users.tenant_id
        FROM users
        WHERE users.id = listings.seller_user_id
      )
    )
    WHERE tenant_id IS NULL;

    UPDATE basket_items
    SET tenant_id = (
      SELECT listings.tenant_id
      FROM listings
      WHERE listings.id = basket_items.listing_id
    )
    WHERE tenant_id IS NULL;

    UPDATE offers
    SET tenant_id = (
      SELECT listings.tenant_id
      FROM listings
      WHERE listings.id = offers.listing_id
    )
    WHERE tenant_id IS NULL;

    UPDATE seller_sales
    SET tenant_id = COALESCE(
      (
        SELECT listings.tenant_id
        FROM listings
        WHERE listings.id = seller_sales.listing_id
      ),
      (
        SELECT users.tenant_id
        FROM users
        WHERE users.id = seller_sales.seller_user_id
      )
    )
    WHERE tenant_id IS NULL;
  `);

  validateTenantMaterialization(sqlite);
}
