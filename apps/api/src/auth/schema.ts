import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  phoneE164: text("phone_e164").notNull().unique(),
  tenantId: text("tenant_id").notNull(),
  allowedRoles: text("allowed_roles").notNull(),
  activeRole: text("active_role").notNull(),
  sellerProfileId: text("seller_profile_id"),
  createdAt: integer("created_at", { mode: "number" }).notNull()
});

export const otpChallenges = sqliteTable(
  "otp_challenges",
  {
    id: text("id").primaryKey(),
    phoneE164: text("phone_e164").notNull(),
    ipHash: text("ip_hash").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
    maxAttempts: integer("max_attempts", { mode: "number" }).notNull(),
    attempts: integer("attempts", { mode: "number" }).notNull().default(0),
    consumedAt: integer("consumed_at", { mode: "number" }),
    invalidatedAt: integer("invalidated_at", { mode: "number" }),
    createdAt: integer("created_at", { mode: "number" }).notNull()
  },
  (table) => [
    index("idx_otp_phone_created").on(table.phoneE164, table.createdAt),
    index("idx_otp_phone_active").on(table.phoneE164, table.expiresAt),
    index("idx_otp_phone_ip_created").on(table.phoneE164, table.ipHash, table.createdAt)
  ]
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    deviceId: text("device_id").notNull(),
    platform: text("platform").notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "number" })
  },
  (table) => [index("idx_sessions_user_created").on(table.userId, table.createdAt)]
);

export const refreshTokens = sqliteTable(
  "refresh_tokens",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    userId: text("user_id").notNull(),
    familyId: text("family_id").notNull(),
    parentTokenId: text("parent_token_id"),
    replacedByTokenId: text("replaced_by_token_id"),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: integer("expires_at", { mode: "number" }).notNull(),
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    revokedAt: integer("revoked_at", { mode: "number" }),
    revokedReason: text("revoked_reason")
  },
  (table) => [
    index("idx_refresh_family").on(table.familyId),
    index("idx_refresh_session").on(table.sessionId),
    index("idx_refresh_user").on(table.userId)
  ]
);

export type UserRow = typeof users.$inferSelect;
export type OtpChallengeRow = typeof otpChallenges.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
