import { TextEncoder } from "node:util";
import { timingSafeEqual } from "node:crypto";
import {
  type AuthPlatform,
  type AuthRole,
  type AuthSession,
  type AuthTokens,
  type AuthUser,
  type LogoutResponse,
  type OtpRequestResponse,
  type OtpVerifyResponse,
  type RefreshResponse
} from "@antique/types";
import { SignJWT, jwtVerify } from "jose";
import type { Database } from "better-sqlite3";
import { AuthError } from "../auth/errors.js";
import { generateOtpCode, generateToken, hashWithSecret, newId } from "../auth/crypto.js";
import { normalizePhoneNumber } from "../auth/phone.js";

const DEFAULT_TENANT_ID = "default";

interface UserRow {
  id: string;
  phone_e164: string;
  tenant_id: string;
  allowed_roles: string;
  active_role: string;
  seller_profile_id: string | null;
  created_at: number;
}

interface SessionRow {
  id: string;
  user_id: string;
  device_id: string;
  platform: AuthPlatform;
  created_at: number;
  revoked_at: number | null;
}

interface OtpChallengeRow {
  id: string;
  phone_e164: string;
  ip_hash: string;
  code_hash: string;
  expires_at: number;
  max_attempts: number;
  attempts: number;
  consumed_at: number | null;
  invalidated_at: number | null;
  created_at: number;
}

interface RefreshTokenRow {
  id: string;
  session_id: string;
  user_id: string;
  family_id: string;
  parent_token_id: string | null;
  replaced_by_token_id: string | null;
  token_hash: string;
  expires_at: number;
  created_at: number;
  revoked_at: number | null;
  revoked_reason: string | null;
}

export interface SmsProvider {
  sendOtp: (params: { phoneE164: string; code: string }) => Promise<void>;
}

export interface AuthRuntimeConfig {
  authJwtSecret: string;
  authHashSecret: string;
  authAccessTokenTtlSec: number;
  authRefreshTokenTtlSec: number;
  authOtpTtlSec: number;
  authOtpMaxAttempts: number;
  authOtpCooldownSec: number;
  authOtpRequestPerPhonePerHour: number;
  authOtpVerifyPerPhoneIpPerHour: number;
}

export interface RequestOtpInput {
  phone: string;
  ipAddress: string;
}

export interface VerifyOtpInput {
  phone: string;
  code: string;
  deviceId: string;
  platform: AuthPlatform;
  ipAddress: string;
}

export interface RefreshInput {
  refreshToken: string;
}

export interface LogoutInput {
  refreshToken: string;
}

function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function parseAllowedRoles(raw: string): AuthRole[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return ["buyer"];
    }
    const roles = parsed.filter((entry): entry is AuthRole =>
      entry === "buyer" || entry === "seller" || entry === "admin"
    );
    return roles.length > 0 ? roles : ["buyer"];
  } catch {
    return ["buyer"];
  }
}

function hashIp(ipAddress: string, secret: string): string {
  return hashWithSecret(ipAddress, secret);
}

function safeHashEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function validateDeviceId(deviceId: string): void {
  if (!deviceId || deviceId.length < 3 || deviceId.length > 200) {
    throw new AuthError("invalid_device_id", "Device ID is invalid", 400);
  }
}

function validateOtpCode(code: string): void {
  if (!/^\d{6}$/.test(code)) {
    throw new AuthError("invalid_otp_code", "OTP code must be 6 digits", 400);
  }
}

export class AuthService {
  private readonly jwtKey: Uint8Array;

  constructor(
    private readonly sqlite: Database,
    private readonly config: AuthRuntimeConfig,
    private readonly smsProvider: SmsProvider,
    private readonly now: () => number = () => Date.now()
  ) {
    this.jwtKey = new TextEncoder().encode(config.authJwtSecret);
  }

  async requestOtp(input: RequestOtpInput): Promise<OtpRequestResponse> {
    const phoneE164 = normalizePhoneNumber(input.phone);
    const now = this.now();
    const hourAgo = now - 60 * 60 * 1000;

    const perPhoneCountRow = this.sqlite
      .prepare(
        `
          SELECT COUNT(1) as count
          FROM otp_challenges
          WHERE phone_e164 = ? AND created_at >= ?
        `
      )
      .get(phoneE164, hourAgo) as { count: number } | undefined;

    const perPhoneCount = Number(perPhoneCountRow?.count ?? 0);
    if (perPhoneCount >= this.config.authOtpRequestPerPhonePerHour) {
      throw new AuthError(
        "otp_request_rate_limited",
        "OTP request rate limit exceeded",
        429,
        this.config.authOtpCooldownSec
      );
    }

    const activeChallenge = this.sqlite
      .prepare(
        `
          SELECT *
          FROM otp_challenges
          WHERE phone_e164 = ?
            AND consumed_at IS NULL
            AND invalidated_at IS NULL
            AND expires_at > ?
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get(phoneE164, now) as OtpChallengeRow | undefined;

    if (activeChallenge) {
      const sinceLastRequestSec = Math.floor((now - activeChallenge.created_at) / 1000);
      if (sinceLastRequestSec < this.config.authOtpCooldownSec) {
        throw new AuthError(
          "otp_request_cooldown",
          "OTP already requested recently",
          429,
          this.config.authOtpCooldownSec - sinceLastRequestSec
        );
      }
    }

    this.sqlite
      .prepare(
        `
          UPDATE otp_challenges
          SET invalidated_at = ?
          WHERE phone_e164 = ?
            AND consumed_at IS NULL
            AND invalidated_at IS NULL
            AND expires_at > ?
        `
      )
      .run(now, phoneE164, now);

    const code = generateOtpCode();
    const codeHash = hashWithSecret(`${phoneE164}:${code}`, this.config.authHashSecret);

    this.sqlite
      .prepare(
        `
          INSERT INTO otp_challenges(
            id,
            phone_e164,
            ip_hash,
            code_hash,
            expires_at,
            max_attempts,
            attempts,
            consumed_at,
            invalidated_at,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?)
        `
      )
      .run(
        newId(),
        phoneE164,
        hashIp(input.ipAddress, this.config.authHashSecret),
        codeHash,
        now + this.config.authOtpTtlSec * 1000,
        this.config.authOtpMaxAttempts,
        now
      );

    await this.smsProvider.sendOtp({ phoneE164, code });

    return {
      status: "otp_sent",
      retryAfterSec: this.config.authOtpCooldownSec
    };
  }

  async verifyOtp(input: VerifyOtpInput): Promise<OtpVerifyResponse> {
    const phoneE164 = normalizePhoneNumber(input.phone);
    validateOtpCode(input.code);
    validateDeviceId(input.deviceId);

    const now = this.now();
    const ipHashValue = hashIp(input.ipAddress, this.config.authHashSecret);
    const hourAgo = now - 60 * 60 * 1000;

    const failedAttemptsRow = this.sqlite
      .prepare(
        `
          SELECT COALESCE(SUM(attempts), 0) as total
          FROM otp_challenges
          WHERE phone_e164 = ?
            AND ip_hash = ?
            AND created_at >= ?
        `
      )
      .get(phoneE164, ipHashValue, hourAgo) as { total: number } | undefined;

    const failedAttempts = Number(failedAttemptsRow?.total ?? 0);
    if (failedAttempts >= this.config.authOtpVerifyPerPhoneIpPerHour) {
      throw new AuthError(
        "otp_verify_rate_limited",
        "OTP verify rate limit exceeded",
        429,
        this.config.authOtpCooldownSec
      );
    }

    const challenge = this.sqlite
      .prepare(
        `
          SELECT *
          FROM otp_challenges
          WHERE phone_e164 = ?
            AND consumed_at IS NULL
            AND invalidated_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get(phoneE164) as OtpChallengeRow | undefined;

    if (!challenge) {
      throw new AuthError("otp_invalid", "OTP code is invalid", 401);
    }

    if (challenge.expires_at <= now) {
      this.sqlite
        .prepare("UPDATE otp_challenges SET invalidated_at = ? WHERE id = ?")
        .run(now, challenge.id);
      throw new AuthError("otp_expired", "OTP code has expired", 401);
    }

    if (challenge.attempts >= challenge.max_attempts) {
      throw new AuthError("otp_attempts_exceeded", "OTP attempts exceeded", 401);
    }

    const expectedHash = hashWithSecret(`${phoneE164}:${input.code}`, this.config.authHashSecret);
    if (!safeHashEquals(expectedHash, challenge.code_hash)) {
      this.sqlite
        .prepare(
          `
            UPDATE otp_challenges
            SET attempts = attempts + 1
            WHERE id = ?
          `
        )
        .run(challenge.id);
      throw new AuthError("otp_invalid", "OTP code is invalid", 401);
    }

    const transaction = this.sqlite.transaction(() => {
      const consumeResult = this.sqlite
        .prepare(
          `
            UPDATE otp_challenges
            SET consumed_at = ?
            WHERE id = ?
              AND consumed_at IS NULL
              AND invalidated_at IS NULL
          `
        )
        .run(now, challenge.id);
      if (consumeResult.changes !== 1) {
        throw new AuthError("otp_invalid", "OTP code is invalid", 401);
      }

      let user = this.sqlite
        .prepare("SELECT * FROM users WHERE phone_e164 = ? LIMIT 1")
        .get(phoneE164) as UserRow | undefined;

      let isNewUser = false;
      if (!user) {
        isNewUser = true;
        const userId = newId();
        this.sqlite
          .prepare(
            `
              INSERT INTO users(id, phone_e164, tenant_id, allowed_roles, active_role, seller_profile_id, created_at)
              VALUES (?, ?, ?, ?, ?, NULL, ?)
            `
          )
          .run(userId, phoneE164, DEFAULT_TENANT_ID, JSON.stringify(["buyer"]), "buyer", now);

        user = this.sqlite
          .prepare("SELECT * FROM users WHERE id = ? LIMIT 1")
          .get(userId) as UserRow | undefined;
      }

      if (!user) {
        throw new AuthError("user_creation_failed", "Failed to create or load user", 500);
      }

      const sessionId = newId();
      this.sqlite
        .prepare(
          `
            INSERT INTO sessions(id, user_id, device_id, platform, created_at, revoked_at)
            VALUES (?, ?, ?, ?, ?, NULL)
          `
        )
        .run(sessionId, user.id, input.deviceId, input.platform, now);

      const refreshToken = generateToken();
      const refreshTokenId = newId();
      const refreshFamilyId = newId();
      const refreshTokenExpiresAt = now + this.config.authRefreshTokenTtlSec * 1000;

      this.sqlite
        .prepare(
          `
            INSERT INTO refresh_tokens(
              id,
              session_id,
              user_id,
              family_id,
              parent_token_id,
              replaced_by_token_id,
              token_hash,
              expires_at,
              created_at,
              revoked_at,
              revoked_reason
            ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL)
          `
        )
        .run(
          refreshTokenId,
          sessionId,
          user.id,
          refreshFamilyId,
          hashWithSecret(refreshToken, this.config.authHashSecret),
          refreshTokenExpiresAt,
          now
        );

      return {
        user,
        session: {
          id: sessionId,
          user_id: user.id,
          device_id: input.deviceId,
          platform: input.platform,
          created_at: now,
          revoked_at: null
        } satisfies SessionRow,
        refreshToken,
        refreshTokenExpiresAt,
        isNewUser
      };
    });

    const issued = transaction();
    const access = await this.createAccessToken(issued.user, issued.session, now);

    return {
      user: this.asAuthUser(issued.user),
      session: this.asAuthSession(issued.session),
      tokens: this.asAuthTokens({
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        refreshToken: issued.refreshToken,
        refreshTokenExpiresAt: issued.refreshTokenExpiresAt
      }),
      isNewUser: issued.isNewUser
    };
  }

  async refresh(input: RefreshInput): Promise<RefreshResponse> {
    if (!input.refreshToken) {
      throw new AuthError("missing_refresh_token", "Refresh token is required", 400);
    }

    const now = this.now();
    const presentedTokenHash = hashWithSecret(input.refreshToken, this.config.authHashSecret);

    const transaction = this.sqlite.transaction(() => {
      const currentToken = this.sqlite
        .prepare("SELECT * FROM refresh_tokens WHERE token_hash = ? LIMIT 1")
        .get(presentedTokenHash) as RefreshTokenRow | undefined;

      if (!currentToken) {
        throw new AuthError("invalid_refresh_token", "Refresh token is invalid", 401);
      }

      if (currentToken.revoked_at) {
        if (currentToken.replaced_by_token_id) {
          this.sqlite
            .prepare(
              "UPDATE refresh_tokens SET revoked_at = ?, revoked_reason = 'reuse_detected' WHERE family_id = ? AND revoked_at IS NULL"
            )
            .run(now, currentToken.family_id);
          this.sqlite
            .prepare(
              `
                UPDATE sessions
                SET revoked_at = COALESCE(revoked_at, ?)
                WHERE id IN (
                  SELECT DISTINCT session_id FROM refresh_tokens WHERE family_id = ?
                )
              `
            )
            .run(now, currentToken.family_id);
          throw new AuthError("reused_refresh_token", "Refresh token was already rotated", 401);
        }
        throw new AuthError("revoked_refresh_token", "Refresh token is revoked", 401);
      }

      if (currentToken.expires_at <= now) {
        this.sqlite
          .prepare(
            "UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?), revoked_reason = COALESCE(revoked_reason, 'expired') WHERE id = ?"
          )
          .run(now, currentToken.id);
        throw new AuthError("expired_refresh_token", "Refresh token has expired", 401);
      }

      const session = this.sqlite
        .prepare("SELECT * FROM sessions WHERE id = ? LIMIT 1")
        .get(currentToken.session_id) as SessionRow | undefined;
      if (!session || session.revoked_at) {
        throw new AuthError("revoked_session", "Session is revoked", 401);
      }

      const user = this.sqlite
        .prepare("SELECT * FROM users WHERE id = ? LIMIT 1")
        .get(currentToken.user_id) as UserRow | undefined;
      if (!user) {
        throw new AuthError("invalid_refresh_token", "Refresh token is invalid", 401);
      }

      const nextRefreshToken = generateToken();
      const nextRefreshTokenId = newId();
      const nextRefreshExpiresAt = now + this.config.authRefreshTokenTtlSec * 1000;

      this.sqlite
        .prepare(
          `
            INSERT INTO refresh_tokens(
              id,
              session_id,
              user_id,
              family_id,
              parent_token_id,
              replaced_by_token_id,
              token_hash,
              expires_at,
              created_at,
              revoked_at,
              revoked_reason
            ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL)
          `
        )
        .run(
          nextRefreshTokenId,
          currentToken.session_id,
          currentToken.user_id,
          currentToken.family_id,
          currentToken.id,
          hashWithSecret(nextRefreshToken, this.config.authHashSecret),
          nextRefreshExpiresAt,
          now
        );

      this.sqlite
        .prepare(
          "UPDATE refresh_tokens SET revoked_at = ?, revoked_reason = 'rotated', replaced_by_token_id = ? WHERE id = ?"
        )
        .run(now, nextRefreshTokenId, currentToken.id);

      return {
        user,
        session,
        nextRefreshToken,
        nextRefreshExpiresAt
      };
    });

    const issued = transaction();
    const access = await this.createAccessToken(issued.user, issued.session, now);

    return {
      session: this.asAuthSession(issued.session),
      tokens: this.asAuthTokens({
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        refreshToken: issued.nextRefreshToken,
        refreshTokenExpiresAt: issued.nextRefreshExpiresAt
      })
    };
  }

  logout(input: LogoutInput): LogoutResponse {
    if (!input.refreshToken) {
      throw new AuthError("missing_refresh_token", "Refresh token is required", 400);
    }

    const now = this.now();
    const tokenHash = hashWithSecret(input.refreshToken, this.config.authHashSecret);

    const transaction = this.sqlite.transaction(() => {
      const token = this.sqlite
        .prepare("SELECT * FROM refresh_tokens WHERE token_hash = ? LIMIT 1")
        .get(tokenHash) as RefreshTokenRow | undefined;
      if (!token) {
        return;
      }

      this.sqlite
        .prepare(
          "UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, ?), revoked_reason = COALESCE(revoked_reason, 'logout') WHERE id = ?"
        )
        .run(now, token.id);
      this.sqlite
        .prepare("UPDATE sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?")
        .run(now, token.session_id);
    });

    transaction();

    return { success: true };
  }

  async authenticateAccessToken(accessToken: string): Promise<AuthUser> {
    if (!accessToken) {
      throw new AuthError("missing_access_token", "Access token is required", 401);
    }

    let payload: Awaited<ReturnType<typeof jwtVerify>>["payload"];
    try {
      const verified = await jwtVerify(accessToken, this.jwtKey, { algorithms: ["HS256"] });
      payload = verified.payload;
    } catch {
      throw new AuthError("invalid_access_token", "Access token is invalid", 401);
    }

    const userId = typeof payload.userId === "string" ? payload.userId : payload.sub;
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : null;
    if (typeof userId !== "string" || !sessionId) {
      throw new AuthError("invalid_access_token", "Access token is invalid", 401);
    }

    const session = this.sqlite
      .prepare("SELECT id, user_id, revoked_at FROM sessions WHERE id = ? LIMIT 1")
      .get(sessionId) as Pick<SessionRow, "id" | "user_id" | "revoked_at"> | undefined;
    if (!session || session.user_id !== userId || session.revoked_at) {
      throw new AuthError("revoked_session", "Session is revoked", 401);
    }

    const user = this.sqlite
      .prepare("SELECT * FROM users WHERE id = ? LIMIT 1")
      .get(userId) as UserRow | undefined;
    if (!user) {
      throw new AuthError("invalid_access_token", "Access token is invalid", 401);
    }

    return this.asAuthUser(user);
  }

  private async createAccessToken(
    user: UserRow,
    session: SessionRow,
    now: number
  ): Promise<{ token: string; expiresAt: number }> {
    const expiresAt = now + this.config.authAccessTokenTtlSec * 1000;
    const allowedRoles = parseAllowedRoles(user.allowed_roles);

    const token = await new SignJWT({
      userId: user.id,
      tenantId: user.tenant_id,
      allowedRoles,
      activeRole: user.active_role,
      sellerProfileId: user.seller_profile_id,
      sessionId: session.id
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(user.id)
      .setIssuedAt(Math.floor(now / 1000))
      .setExpirationTime(Math.floor(expiresAt / 1000))
      .sign(this.jwtKey);

    return {
      token,
      expiresAt
    };
  }

  private asAuthUser(user: UserRow): AuthUser {
    return {
      id: user.id,
      phone: user.phone_e164,
      tenantId: user.tenant_id,
      allowedRoles: parseAllowedRoles(user.allowed_roles),
      activeRole: (user.active_role as AuthRole) ?? "buyer",
      sellerProfileId: user.seller_profile_id
    };
  }

  private asAuthSession(session: SessionRow): AuthSession {
    return {
      id: session.id,
      deviceId: session.device_id,
      platform: session.platform,
      createdAt: toIso(session.created_at)
    };
  }

  private asAuthTokens(input: {
    accessToken: string;
    accessTokenExpiresAt: number;
    refreshToken: string;
    refreshTokenExpiresAt: number;
  }): AuthTokens {
    return {
      tokenType: "Bearer",
      accessToken: input.accessToken,
      accessTokenExpiresAt: toIso(input.accessTokenExpiresAt),
      refreshToken: input.refreshToken,
      refreshTokenExpiresAt: toIso(input.refreshTokenExpiresAt)
    };
  }
}
