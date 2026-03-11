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
      FROM chats
      WHERE tenant_id IS NULL
    `,
    "tenant_materialization_incomplete:chats"
  );
  assertNoRows(
    sqlite,
    `
      SELECT COUNT(*) AS count
      FROM chat_messages
      WHERE tenant_id IS NULL
    `,
    "tenant_materialization_incomplete:chat_messages"
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
  assertNoRows(
    sqlite,
    `
      SELECT COUNT(*) AS count
      FROM chats
      JOIN listings ON listings.id = chats.listing_id
      WHERE chats.tenant_id != listings.tenant_id
    `,
    "tenant_materialization_mismatch:chats_vs_listings"
  );
  assertNoRows(
    sqlite,
    `
      SELECT COUNT(*) AS count
      FROM chat_messages
      JOIN chats ON chats.id = chat_messages.chat_id
      WHERE chat_messages.tenant_id != chats.tenant_id
    `,
    "tenant_materialization_mismatch:chat_messages_vs_chats"
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
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      listed_price_cents INTEGER NOT NULL DEFAULT 1,
      currency TEXT NOT NULL DEFAULT 'USD',
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

    CREATE TABLE IF NOT EXISTS announcements (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      seller_user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (seller_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_announcements_tenant_created_at
      ON announcements(tenant_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      read_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_user_created
      ON notifications(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_tenant_created
      ON notifications(tenant_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS user_push_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      expo_push_token TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, expo_push_token),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_push_tokens_user_updated
      ON user_push_tokens(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS notification_push_attempts (
      id TEXT PRIMARY KEY,
      notification_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      push_token_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      next_retry_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (notification_id) REFERENCES notifications(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (push_token_id) REFERENCES user_push_tokens(id)
    );

    CREATE INDEX IF NOT EXISTS idx_notification_push_attempts_notification_created
      ON notification_push_attempts(notification_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      deal_id TEXT NOT NULL UNIQUE,
      listing_id TEXT NOT NULL,
      seller_user_id TEXT NOT NULL,
      buyer_user_id TEXT NOT NULL,
      tenant_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (deal_id) REFERENCES deals(id),
      FOREIGN KEY (listing_id) REFERENCES listings(id),
      FOREIGN KEY (seller_user_id) REFERENCES users(id),
      FOREIGN KEY (buyer_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_chats_tenant_updated_at
      ON chats(tenant_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender_user_id TEXT NOT NULL,
      tenant_id TEXT,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (chat_id) REFERENCES chats(id),
      FOREIGN KEY (sender_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_created
      ON chat_messages(chat_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_tenant_created
      ON chat_messages(tenant_id, created_at DESC);

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

    CREATE TABLE IF NOT EXISTS user_blocks (
      id TEXT PRIMARY KEY,
      blocker_user_id TEXT NOT NULL,
      blocked_user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(blocker_user_id, blocked_user_id),
      FOREIGN KEY (blocker_user_id) REFERENCES users(id),
      FOREIGN KEY (blocked_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker_created
      ON user_blocks(blocker_user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked_created
      ON user_blocks(blocked_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS user_reports (
      id TEXT PRIMARY KEY,
      reporter_user_id TEXT NOT NULL,
      reported_user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT,
      request_ip TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (reporter_user_id) REFERENCES users(id),
      FOREIGN KEY (reported_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_user_reports_reported_created
      ON user_reports(reported_user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS listing_moderation_flags (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      reason_code TEXT NOT NULL,
      note TEXT,
      status TEXT NOT NULL,
      request_ip TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (listing_id) REFERENCES listings(id),
      FOREIGN KEY (actor_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_listing_moderation_flags_listing_created
      ON listing_moderation_flags(listing_id, created_at DESC);

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

    CREATE TABLE IF NOT EXISTS request_metrics (
      id TEXT PRIMARY KEY,
      method TEXT NOT NULL,
      route_pattern TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_request_metrics_created
      ON request_metrics(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_request_metrics_route_created
      ON request_metrics(route_pattern, created_at DESC);

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
  if (!listingColumns.some((column) => column.name === "title")) {
    sqlite.exec("ALTER TABLE listings ADD COLUMN title TEXT NOT NULL DEFAULT ''");
  }
  if (!listingColumns.some((column) => column.name === "description")) {
    sqlite.exec("ALTER TABLE listings ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }
  if (!listingColumns.some((column) => column.name === "listed_price_cents")) {
    sqlite.exec("ALTER TABLE listings ADD COLUMN listed_price_cents INTEGER NOT NULL DEFAULT 1");
  }
  if (!listingColumns.some((column) => column.name === "currency")) {
    sqlite.exec("ALTER TABLE listings ADD COLUMN currency TEXT NOT NULL DEFAULT 'USD'");
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

  const chatColumns = sqlite.prepare("PRAGMA table_info(chats)").all() as Array<{ name: string }>;
  if (!chatColumns.some((column) => column.name === "tenant_id")) {
    sqlite.exec("ALTER TABLE chats ADD COLUMN tenant_id TEXT");
  }

  const chatMessageColumns = sqlite
    .prepare("PRAGMA table_info(chat_messages)")
    .all() as Array<{ name: string }>;
  if (!chatMessageColumns.some((column) => column.name === "tenant_id")) {
    sqlite.exec("ALTER TABLE chat_messages ADD COLUMN tenant_id TEXT");
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

    UPDATE chats
    SET tenant_id = COALESCE(
      (
        SELECT listings.tenant_id
        FROM listings
        WHERE listings.id = chats.listing_id
      ),
      (
        SELECT users.tenant_id
        FROM users
        WHERE users.id = chats.seller_user_id
      )
    )
    WHERE tenant_id IS NULL;

    UPDATE chat_messages
    SET tenant_id = (
      SELECT chats.tenant_id
      FROM chats
      WHERE chats.id = chat_messages.chat_id
    )
    WHERE tenant_id IS NULL;
  `);

  validateTenantMaterialization(sqlite);
}
