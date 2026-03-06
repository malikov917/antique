import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";
import { type ApiConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/db/client.js";
import { type SmsProvider } from "../src/services/authService.js";
import { type MuxClient } from "../src/services/videoProvider.js";

function buildMockMuxClient(params?: {
  maxResolutionTier?: "1080p" | "1440p" | "2160p";
  videoQuality?: "basic" | "plus" | "premium";
  playbackId?: string;
}): MuxClient {
  return {
    video: {
      uploads: {
        create: vi.fn(async () => ({
          id: "upload-1",
          url: "https://example.com/upload-1"
        })),
        retrieve: vi.fn(async () => ({
          id: "upload-1",
          asset_id: "asset-1"
        }))
      },
      assets: {
        retrieve: vi.fn(async () => ({
          status: "ready",
          playback_ids: [{ id: params?.playbackId ?? "playback-1" }],
          max_resolution_tier: params?.maxResolutionTier ?? "1080p",
          video_quality: params?.videoQuality ?? "plus"
        })),
        delete: vi.fn(async () => undefined)
      }
    }
  };
}

function buildTestConfig(overrides?: Partial<ApiConfig>): ApiConfig {
  const base: ApiConfig = {
    port: 4000,
    dbPath: ":memory:",
    demoPlaybackIds: [],
    muxWebhookSecret: "whsec_test",
    muxTokenId: "token-id",
    muxTokenSecret: "token-secret",
    muxMaxResolutionTier: "1080p",
    muxVideoQuality: "plus",
    authJwtSecret: "jwt-test-secret",
    authHashSecret: "hash-test-secret",
    authAccessTokenTtlSec: 15 * 60,
    authRefreshTokenTtlSec: 30 * 24 * 60 * 60,
    authOtpTtlSec: 5 * 60,
    authOtpMaxAttempts: 5,
    authOtpCooldownSec: 60,
    authOtpRequestPerPhonePerHour: 5,
    authOtpRequestPerIpPerHour: 30,
    authOtpVerifyPerPhoneIpPerHour: 10,
    retentionPurgeEnabled: false,
    retentionPurgeIntervalSec: 60 * 60,
  };

  return {
    ...base,
    ...overrides
  };
}

class TestSmsProvider implements SmsProvider {
  private readonly otpByPhone = new Map<string, string>();

  async sendOtp(params: { phoneE164: string; code: string }): Promise<void> {
    this.otpByPhone.set(params.phoneE164, params.code);
  }

  getLastCode(phoneE164: string): string {
    const code = this.otpByPhone.get(phoneE164);
    if (!code) {
      throw new Error(`No OTP code found for ${phoneE164}`);
    }
    return code;
  }
}

async function createAuthenticatedBuyer(
  app: Awaited<ReturnType<typeof buildServer>>,
  smsProvider: TestSmsProvider,
  phone = "+14155552671"
): Promise<string> {
  const auth = await createAuthenticatedUser(app, smsProvider, phone);
  return auth.accessToken;
}

async function createAuthenticatedUser(
  app: Awaited<ReturnType<typeof buildServer>>,
  smsProvider: TestSmsProvider,
  phone: string
): Promise<{ userId: string; accessToken: string }> {
  await app.inject({
    method: "POST",
    url: "/v1/auth/otp/request",
    payload: { phone }
  });

  const code = smsProvider.getLastCode(phone);
  const verifyResponse = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: {
      phone,
      code,
      deviceId: "seller-app-device",
      platform: "ios"
    }
  });

  const verifyPayload = verifyResponse.json();
  return {
    userId: verifyPayload.user.id as string,
    accessToken: verifyPayload.tokens.accessToken as string
  };
}

async function createAuthenticatedSeller(
  app: Awaited<ReturnType<typeof buildServer>>,
  smsProvider: TestSmsProvider,
  dbClient: ReturnType<typeof createDatabaseClient>,
  phone = "+14155552672"
): Promise<{ userId: string; accessToken: string }> {
  const auth = await createAuthenticatedUser(app, smsProvider, phone);
  dbClient.sqlite
    .prepare("UPDATE users SET allowed_roles = ? WHERE id = ?")
    .run(JSON.stringify(["buyer", "seller"]), auth.userId);

  const switched = await app.inject({
    method: "POST",
    url: "/v1/me/role-switch",
    headers: {
      authorization: `Bearer ${auth.accessToken}`
    },
    payload: {
      role: "seller"
    }
  });
  expect(switched.statusCode).toBe(200);

  return auth;
}

async function createAuthenticatedSession(
  app: Awaited<ReturnType<typeof buildServer>>,
  smsProvider: TestSmsProvider,
  phone: string,
  deviceId: string
): Promise<{ accessToken: string; userId: string }> {
  await app.inject({
    method: "POST",
    url: "/v1/auth/otp/request",
    payload: { phone }
  });

  const code = smsProvider.getLastCode(phone);
  const verifyResponse = await app.inject({
    method: "POST",
    url: "/v1/auth/otp/verify",
    payload: {
      phone,
      code,
      deviceId,
      platform: "ios"
    }
  });

  const payload = verifyResponse.json();
  return {
    accessToken: payload.tokens.accessToken as string,
    userId: payload.user.id as string
  };
}

describe("api", () => {
  const secret = "whsec_test";
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer({
      config: buildTestConfig({ muxWebhookSecret: secret }),
      muxClient: buildMockMuxClient()
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates direct upload session", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      uploadId: "upload-1",
      uploadUrl: "https://example.com/upload-1"
    });
  });

  it("rejects invalid mux signature", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/mux",
      payload: {
        type: "video.asset.ready",
        data: { id: "asset-1", playback_ids: [{ id: "playback-1" }] }
      },
      headers: {
        "mux-signature": "t=1000,v1=invalid"
      }
    });

    expect(response.statusCode).toBe(401);
  });

  it("marks upload ready via webhook and exposes in feed", async () => {
    await app.inject({ method: "POST", url: "/v1/uploads" });
    await app.inject({ method: "GET", url: "/v1/uploads/upload-1" });

    const payload = JSON.stringify({
      type: "video.asset.ready",
      data: { id: "asset-1", playback_ids: [{ id: "playback-1" }] }
    });
    const timestamp = `${Math.floor(Date.now() / 1000)}`;
    const digest = createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");

    const webhookResponse = await app.inject({
      method: "POST",
      url: "/v1/webhooks/mux",
      payload,
      headers: {
        "content-type": "application/json",
        "mux-signature": `t=${timestamp},v1=${digest}`
      }
    });

    expect(webhookResponse.statusCode).toBe(204);

    const feedResponse = await app.inject({
      method: "GET",
      url: "/v1/feed"
    });

    expect(feedResponse.statusCode).toBe(200);
    expect(feedResponse.json().items).toHaveLength(1);
    expect(feedResponse.json().items[0]).toMatchObject({
      id: "upload-1",
      playbackId: "playback-1",
      status: "ready"
    });
  });

  it("does not transition to ready when mux policy is non-compliant", async () => {
    const policyMismatchApp = await buildServer({
      config: buildTestConfig({
        port: 4010,
        muxWebhookSecret: secret,
        muxMaxResolutionTier: "1080p",
        muxVideoQuality: "plus"
      }),
      muxClient: buildMockMuxClient({
        maxResolutionTier: "1440p"
      })
    });

    await policyMismatchApp.inject({ method: "POST", url: "/v1/uploads" });
    await policyMismatchApp.inject({ method: "GET", url: "/v1/uploads/upload-1" });

    const payload = JSON.stringify({
      type: "video.asset.ready",
      data: { id: "asset-1", playback_ids: [{ id: "playback-1" }] }
    });
    const timestamp = `${Math.floor(Date.now() / 1000)}`;
    const digest = createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");

    const webhookResponse = await policyMismatchApp.inject({
      method: "POST",
      url: "/v1/webhooks/mux",
      payload,
      headers: {
        "content-type": "application/json",
        "mux-signature": `t=${timestamp},v1=${digest}`
      }
    });

    expect(webhookResponse.statusCode).toBe(204);

    const statusResponse = await policyMismatchApp.inject({
      method: "GET",
      url: "/v1/uploads/upload-1"
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toMatchObject({
      uploadId: "upload-1",
      status: "errored"
    });

    const feedResponse = await policyMismatchApp.inject({
      method: "GET",
      url: "/v1/feed"
    });
    expect(feedResponse.statusCode).toBe(200);
    expect(feedResponse.json().items).toHaveLength(0);

    await policyMismatchApp.close();
  });

  it("fails fast with 503 on upload routes when mux credentials are missing", async () => {
    const noCredsApp = await buildServer({
      config: buildTestConfig({
        port: 4012,
        muxWebhookSecret: secret,
        muxTokenId: undefined,
        muxTokenSecret: undefined
      })
    });

    const createResponse = await noCredsApp.inject({
      method: "POST",
      url: "/v1/uploads"
    });
    expect(createResponse.statusCode).toBe(503);
    expect(createResponse.json().error).toContain("Mux credentials");

    const lookupResponse = await noCredsApp.inject({
      method: "GET",
      url: "/v1/uploads/nonexistent"
    });
    expect(lookupResponse.statusCode).toBe(503);
    expect(lookupResponse.json().error).toContain("Mux credentials");

    await noCredsApp.close();
  });
});

describe("auth api", () => {
  it("requests OTP and normalizes phone", async () => {
    const smsProvider = new TestSmsProvider();
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone: "+1 (415) 555-2671" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "otp_sent",
      retryAfterSec: 60
    });
    expect(smsProvider.getLastCode("+14155552671")).toMatch(/^\d{6}$/);

    await app.close();
  });

  it("rejects invalid phone number", async () => {
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider: new TestSmsProvider(),
      muxClient: buildMockMuxClient()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone: "invalid-phone" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "invalid_phone"
    });

    await app.close();
  });

  it("rate limits OTP requests by phone", async () => {
    const smsProvider = new TestSmsProvider();
    let now = Date.now();
    const app = await buildServer({
      config: buildTestConfig({
        authOtpCooldownSec: 1,
        authOtpRequestPerPhonePerHour: 2
      }),
      smsProvider,
      muxClient: buildMockMuxClient(),
      now: () => now
    });

    const phone = "+1 415 555 2671";
    const first = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone }
    });
    expect(first.statusCode).toBe(200);

    now += 61_000;
    const second = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone }
    });
    expect(second.statusCode).toBe(200);

    now += 61_000;
    const third = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone }
    });
    expect(third.statusCode).toBe(429);
    expect(third.json()).toMatchObject({
      code: "otp_request_rate_limited"
    });

    await app.close();
  });

  it("verifies OTP and issues session + tokens", async () => {
    const smsProvider = new TestSmsProvider();
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient()
    });

    await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone: "+14155552671" }
    });

    const code = smsProvider.getLastCode("+14155552671");
    const verifyResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: {
        phone: "+1 415 555 2671",
        code,
        deviceId: "ios-device-1",
        platform: "ios"
      }
    });

    expect(verifyResponse.statusCode).toBe(200);
    expect(verifyResponse.json()).toMatchObject({
      isNewUser: true,
      user: {
        phone: "+14155552671",
        activeRole: "buyer"
      },
      session: {
        deviceId: "ios-device-1",
        platform: "ios"
      },
      tokens: {
        tokenType: "Bearer"
      }
    });

    await app.close();
  });

  it("returns /v1/me for authenticated user", async () => {
    const smsProvider = new TestSmsProvider();
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient()
    });

    await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone: "+14155552671" }
    });
    const code = smsProvider.getLastCode("+14155552671");
    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: {
        phone: "+14155552671",
        code,
        deviceId: "ios-device-me-1",
        platform: "ios"
      }
    });
    const accessToken = verify.json().tokens.accessToken as string;

    const meResponse = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(meResponse.statusCode).toBe(200);
    expect(meResponse.json()).toMatchObject({
      user: {
        phone: "+14155552671",
        displayName: null,
        activeRole: "buyer"
      }
    });

    await app.close();
  });

  it("updates /v1/me display name with validation", async () => {
    const smsProvider = new TestSmsProvider();
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient()
    });

    await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone: "+14155552671" }
    });
    const code = smsProvider.getLastCode("+14155552671");
    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: {
        phone: "+14155552671",
        code,
        deviceId: "ios-device-me-2",
        platform: "ios"
      }
    });
    const accessToken = verify.json().tokens.accessToken as string;

    const patched = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        displayName: "  Vintage Buyer  "
      }
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      user: {
        displayName: "Vintage Buyer"
      }
    });

    const invalid = await app.inject({
      method: "PATCH",
      url: "/v1/me",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        displayName: " ".repeat(81)
      }
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      code: "invalid_display_name"
    });

    await app.close();
  });

  it("rejects /v1/me without authorization", async () => {
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider: new TestSmsProvider(),
      muxClient: buildMockMuxClient()
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/me"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "missing_authorization"
    });

    await app.close();
  });

  it("forbids role switch when role is not allowed", async () => {
    const smsProvider = new TestSmsProvider();
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient()
    });

    await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone: "+14155552671" }
    });
    const code = smsProvider.getLastCode("+14155552671");
    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: {
        phone: "+14155552671",
        code,
        deviceId: "ios-device-role-1",
        platform: "ios"
      }
    });
    const accessToken = verify.json().tokens.accessToken as string;

    const roleSwitch = await app.inject({
      method: "POST",
      url: "/v1/me/role-switch",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        role: "seller"
      }
    });

    expect(roleSwitch.statusCode).toBe(403);
    expect(roleSwitch.json()).toMatchObject({
      code: "forbidden_role_switch"
    });

    await app.close();
  });

  it("switches active role when role is allowed", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone: "+14155552671" }
    });
    const code = smsProvider.getLastCode("+14155552671");
    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: {
        phone: "+14155552671",
        code,
        deviceId: "ios-device-role-2",
        platform: "ios"
      }
    });

    const verifyPayload = verify.json();
    const accessToken = verifyPayload.tokens.accessToken as string;
    const userId = verifyPayload.user.id as string;
    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ? WHERE id = ?")
      .run(JSON.stringify(["buyer", "seller"]), userId);

    const roleSwitch = await app.inject({
      method: "POST",
      url: "/v1/me/role-switch",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        role: "seller"
      }
    });
    expect(roleSwitch.statusCode).toBe(200);
    expect(roleSwitch.json()).toMatchObject({
      user: {
        activeRole: "seller"
      }
    });

    await app.close();
  });

  it("blocks verification after attempt budget is exhausted", async () => {
    const smsProvider = new TestSmsProvider();
    const app = await buildServer({
      config: buildTestConfig({
        authOtpMaxAttempts: 1
      }),
      smsProvider,
      muxClient: buildMockMuxClient()
    });

    await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone: "+14155552671" }
    });
    const realCode = smsProvider.getLastCode("+14155552671");

    const first = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: {
        phone: "+14155552671",
        code: "000000",
        deviceId: "ios-device-1",
        platform: "ios"
      }
    });
    expect(first.statusCode).toBe(401);
    expect(first.json()).toMatchObject({ code: "otp_invalid" });

    const second = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: {
        phone: "+14155552671",
        code: realCode,
        deviceId: "ios-device-1",
        platform: "ios"
      }
    });
    expect(second.statusCode).toBe(401);
    const secondPayload = second.json() as { code: string };
    expect(["otp_invalid", "otp_attempts_exceeded"]).toContain(secondPayload.code);

    await app.close();
  });

  it("rejects expired OTP", async () => {
    const smsProvider = new TestSmsProvider();
    let now = Date.now();
    const app = await buildServer({
      config: buildTestConfig({
        authOtpTtlSec: 1
      }),
      smsProvider,
      muxClient: buildMockMuxClient(),
      now: () => now
    });

    await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone: "+14155552671" }
    });

    const code = smsProvider.getLastCode("+14155552671");
    now += 2_000;

    const verifyResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: {
        phone: "+14155552671",
        code,
        deviceId: "ios-device-1",
        platform: "ios"
      }
    });

    expect(verifyResponse.statusCode).toBe(401);
    expect(verifyResponse.json()).toMatchObject({ code: "otp_expired" });

    await app.close();
  });

  it("rotates refresh tokens and rejects rotated token", async () => {
    const smsProvider = new TestSmsProvider();
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient()
    });

    await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone: "+14155552671" }
    });

    const code = smsProvider.getLastCode("+14155552671");
    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: {
        phone: "+14155552671",
        code,
        deviceId: "android-device-1",
        platform: "android"
      }
    });

    const firstRefreshToken = verify.json().tokens.refreshToken as string;

    const refreshed = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: {
        refreshToken: firstRefreshToken
      }
    });
    expect(refreshed.statusCode).toBe(200);

    const reused = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: {
        refreshToken: firstRefreshToken
      }
    });
    expect(reused.statusCode).toBe(401);
    expect(reused.json()).toMatchObject({ code: "reused_refresh_token" });

    await app.close();
  });

  it("revokes refresh token on logout", async () => {
    const smsProvider = new TestSmsProvider();
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient()
    });

    await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone: "+14155552671" }
    });

    const code = smsProvider.getLastCode("+14155552671");
    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: {
        phone: "+14155552671",
        code,
        deviceId: "ios-device-2",
        platform: "ios"
      }
    });

    const refreshToken = verify.json().tokens.refreshToken as string;

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      payload: {
        refreshToken
      }
    });
    expect(logoutResponse.statusCode).toBe(200);
    expect(logoutResponse.json()).toMatchObject({ success: true });

    const refreshAfterLogout = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: {
        refreshToken
      }
    });
    expect(refreshAfterLogout.statusCode).toBe(401);
    expect(refreshAfterLogout.json()).toMatchObject({ code: "revoked_refresh_token" });

    await app.close();
  });

  it("returns not_requested when seller application has not been submitted", async () => {
    const smsProvider = new TestSmsProvider();
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient()
    });

    const accessToken = await createAuthenticatedBuyer(app, smsProvider);
    const response = await app.inject({
      method: "GET",
      url: "/v1/seller/application",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      application: {
        status: "not_requested",
        fullName: null,
        shopName: null
      }
    });

    await app.close();
  });

  it("submits seller application and returns canonical pending state", async () => {
    const smsProvider = new TestSmsProvider();
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient()
    });

    const accessToken = await createAuthenticatedBuyer(app, smsProvider);

    const submitResponse = await app.inject({
      method: "POST",
      url: "/v1/seller/apply",
      headers: {
        authorization: `Bearer ${accessToken}`
      },
      payload: {
        fullName: "Ada Lovelace",
        shopName: "Reel Revival",
        note: "Specializing in film reels"
      }
    });
    expect(submitResponse.statusCode).toBe(200);
    expect(submitResponse.json()).toMatchObject({
      application: {
        status: "pending",
        fullName: "Ada Lovelace",
        shopName: "Reel Revival",
        note: "Specializing in film reels"
      }
    });

    const fetchResponse = await app.inject({
      method: "GET",
      url: "/v1/seller/application",
      headers: {
        authorization: `Bearer ${accessToken}`
      }
    });
    expect(fetchResponse.statusCode).toBe(200);
    expect(fetchResponse.json()).toMatchObject({
      application: {
        status: "pending",
        fullName: "Ada Lovelace",
        shopName: "Reel Revival"
      }
    });

    await app.close();
  });

  it("allows admin to approve pending seller applications and enable seller role", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const buyer = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155559001",
      "ios-device-seller-application-buyer-1"
    );
    const admin = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155559002",
      "ios-device-seller-application-admin-1"
    );

    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ?, active_role = ? WHERE id = ?")
      .run(JSON.stringify(["buyer", "admin"]), "admin", admin.userId);

    await app.inject({
      method: "POST",
      url: "/v1/seller/apply",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        fullName: "Film Buyer",
        shopName: "Reel Buyer",
        note: "I want to sell"
      }
    });

    const approveResponse = await app.inject({
      method: "POST",
      url: `/v1/admin/seller-applications/${buyer.userId}/approve`,
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      }
    });
    expect(approveResponse.statusCode).toBe(200);
    expect(approveResponse.json()).toMatchObject({
      application: {
        status: "approved",
        rejectionReason: null
      }
    });

    const reviewedAt = approveResponse.json().application.reviewedAt as string;

    const idempotentApproveResponse = await app.inject({
      method: "POST",
      url: `/v1/admin/seller-applications/${buyer.userId}/approve`,
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      }
    });
    expect(idempotentApproveResponse.statusCode).toBe(200);
    expect(idempotentApproveResponse.json()).toMatchObject({
      application: {
        status: "approved",
        reviewedAt
      }
    });

    const buyerSwitchSellerResponse = await app.inject({
      method: "POST",
      url: "/v1/me/role-switch",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        role: "seller"
      }
    });
    expect(buyerSwitchSellerResponse.statusCode).toBe(200);
    expect(buyerSwitchSellerResponse.json().user.allowedRoles).toContain("seller");
    expect(buyerSwitchSellerResponse.json().user.sellerProfileId).toContain("seller-profile-");

    const auditEvents = dbClient.sqlite
      .prepare(
        `
          SELECT outcome, reason_code, metadata_json
          FROM audit_events
          WHERE event_type = 'seller_application_review'
          ORDER BY created_at ASC
        `
      )
      .all() as Array<{ outcome: string; reason_code: string; metadata_json: string }>;

    expect(auditEvents).toHaveLength(2);
    const reasonCodes = new Set(auditEvents.map((event) => event.reason_code));
    expect(reasonCodes.has("application_approved")).toBe(true);
    expect(reasonCodes.has("idempotent_noop")).toBe(true);
    expect(auditEvents.every((event) => event.outcome === "allowed")).toBe(true);

    await app.close();
  });

  it("allows admin to reject pending applications and keeps seller role disabled", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const buyer = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155559003",
      "ios-device-seller-application-buyer-2"
    );
    const admin = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155559004",
      "ios-device-seller-application-admin-2"
    );

    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ?, active_role = ? WHERE id = ?")
      .run(JSON.stringify(["buyer", "admin"]), "admin", admin.userId);

    await app.inject({
      method: "POST",
      url: "/v1/seller/apply",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        fullName: "Rejected Buyer",
        shopName: "Rejected Shop"
      }
    });

    const rejectResponse = await app.inject({
      method: "POST",
      url: `/v1/admin/seller-applications/${buyer.userId}/reject`,
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      },
      payload: {
        reason: "Insufficient profile details"
      }
    });
    expect(rejectResponse.statusCode).toBe(200);
    expect(rejectResponse.json()).toMatchObject({
      application: {
        status: "rejected",
        rejectionReason: "Insufficient profile details"
      }
    });

    const switchSeller = await app.inject({
      method: "POST",
      url: "/v1/me/role-switch",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        role: "seller"
      }
    });
    expect(switchSeller.statusCode).toBe(403);
    expect(switchSeller.json()).toMatchObject({
      code: "forbidden_role_switch"
    });

    const approveAfterReject = await app.inject({
      method: "POST",
      url: `/v1/admin/seller-applications/${buyer.userId}/approve`,
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      }
    });
    expect(approveAfterReject.statusCode).toBe(409);
    expect(approveAfterReject.json()).toMatchObject({
      code: "invalid_application_transition"
    });

    const auditEvents = dbClient.sqlite
      .prepare(
        `
          SELECT outcome, reason_code
          FROM audit_events
          WHERE event_type = 'seller_application_review'
          ORDER BY created_at ASC
        `
      )
      .all() as Array<{ outcome: string; reason_code: string }>;

    expect(auditEvents).toHaveLength(2);
    const reasonCodes = new Set(auditEvents.map((event) => event.reason_code));
    expect(reasonCodes.has("application_rejected")).toBe(true);
    expect(reasonCodes.has("invalid_application_transition")).toBe(true);
    expect(auditEvents.some((event) => event.outcome === "allowed")).toBe(true);
    expect(auditEvents.some((event) => event.outcome === "denied")).toBe(true);

    await app.close();
  });

  it("rejects non-admin seller application review attempts", async () => {
    const smsProvider = new TestSmsProvider();
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient()
    });

    const buyer = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155559005",
      "ios-device-seller-application-buyer-3"
    );
    const reviewer = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155559006",
      "ios-device-seller-application-reviewer-3"
    );

    await app.inject({
      method: "POST",
      url: "/v1/seller/apply",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        fullName: "Buyer Three",
        shopName: "Buyer Three Shop"
      }
    });

    const approveResponse = await app.inject({
      method: "POST",
      url: `/v1/admin/seller-applications/${buyer.userId}/approve`,
      headers: {
        authorization: `Bearer ${reviewer.accessToken}`
      }
    });

    expect(approveResponse.statusCode).toBe(403);
    expect(approveResponse.json()).toMatchObject({
      code: "forbidden_role"
    });

    await app.close();
  });

  it("opens and closes market session and transitions live listings to day_closed", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient);
    const openResponse = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(openResponse.statusCode).toBe(200);
    expect(openResponse.json()).toMatchObject({
      session: {
        status: "open",
        sellerUserId: seller.userId
      }
    });
    const sessionId = openResponse.json().session.id as string;

    const secondOpenResponse = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(secondOpenResponse.statusCode).toBe(409);
    expect(secondOpenResponse.json()).toMatchObject({
      code: "market_session_already_open"
    });

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO listings (id, seller_user_id, market_session_id, status, created_at, updated_at)
          VALUES
            ('listing-live-1', ?, ?, 'live', 1, 1),
            ('listing-sold-1', ?, ?, 'sold', 1, 1)
        `
      )
      .run(seller.userId, sessionId, seller.userId, sessionId);

    const closeResponse = await app.inject({
      method: "POST",
      url: `/v1/seller/sessions/${sessionId}/close`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(closeResponse.statusCode).toBe(200);
    expect(closeResponse.json()).toMatchObject({
      transitionedListingCount: 1,
      session: {
        id: sessionId,
        status: "closed"
      }
    });

    const listingRows = dbClient.sqlite
      .prepare("SELECT id, status FROM listings ORDER BY id")
      .all() as Array<{ id: string; status: string }>;
    expect(listingRows).toEqual([
      { id: "listing-live-1", status: "day_closed" },
      { id: "listing-sold-1", status: "sold" }
    ]);

    await app.close();
  });

  it("blocks basket and offer mutations for day_closed listings", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155552673");
    const buyer = await createAuthenticatedUser(app, smsProvider, "+14155552674");

    const openResponse = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    const sessionId = openResponse.json().session.id as string;
    dbClient.sqlite
      .prepare(
        `
          INSERT INTO listings (id, seller_user_id, market_session_id, status, created_at, updated_at)
          VALUES ('listing-live-2', ?, ?, 'live', 1, 1)
        `
      )
      .run(seller.userId, sessionId);

    await app.inject({
      method: "POST",
      url: `/v1/seller/sessions/${sessionId}/close`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });

    const basketResponse = await app.inject({
      method: "POST",
      url: "/v1/listings/listing-live-2/basket",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      }
    });
    expect(basketResponse.statusCode).toBe(409);
    expect(basketResponse.json()).toMatchObject({
      code: "listing_day_closed"
    });

    const offerResponse = await app.inject({
      method: "POST",
      url: "/v1/listings/listing-live-2/offers",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        amountCents: 25000,
        shippingAddress: "123 Antique Row"
      }
    });
    expect(offerResponse.statusCode).toBe(409);
    expect(offerResponse.json()).toMatchObject({
      code: "listing_day_closed"
    });

    await app.close();
  });

  it("supports seller offer inbox and single-winner accept flow with idempotency", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155552680");
    const buyerOne = await createAuthenticatedUser(app, smsProvider, "+14155552681");
    const buyerTwo = await createAuthenticatedUser(app, smsProvider, "+14155552682");

    const sessionResponse = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    const sessionId = sessionResponse.json().session.id as string;
    dbClient.sqlite
      .prepare(
        `
          INSERT INTO listings (id, seller_user_id, market_session_id, status, created_at, updated_at)
          VALUES ('listing-win-1', ?, ?, 'live', 1, 1)
        `
      )
      .run(seller.userId, sessionId);

    const firstOfferResponse = await app.inject({
      method: "POST",
      url: "/v1/listings/listing-win-1/offers",
      headers: {
        authorization: `Bearer ${buyerOne.accessToken}`
      },
      payload: {
        amountCents: 12000,
        shippingAddress: "111 Tape Ave"
      }
    });
    const secondOfferResponse = await app.inject({
      method: "POST",
      url: "/v1/listings/listing-win-1/offers",
      headers: {
        authorization: `Bearer ${buyerTwo.accessToken}`
      },
      payload: {
        amountCents: 13000,
        shippingAddress: "222 Film St"
      }
    });
    expect(firstOfferResponse.statusCode).toBe(200);
    expect(secondOfferResponse.statusCode).toBe(200);
    const firstOfferId = firstOfferResponse.json().offer.id as string;
    const secondOfferId = secondOfferResponse.json().offer.id as string;

    const inboxResponse = await app.inject({
      method: "GET",
      url: "/v1/seller/listings/listing-win-1/offers",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(inboxResponse.statusCode).toBe(200);
    expect(inboxResponse.json().offers).toHaveLength(2);
    expect(inboxResponse.json().offers.map((offer: { id: string }) => offer.id).sort()).toEqual(
      [firstOfferId, secondOfferId].sort()
    );

    const acceptResponse = await app.inject({
      method: "POST",
      url: `/v1/offers/${firstOfferId}/accept`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(acceptResponse.statusCode).toBe(200);
    expect(acceptResponse.json()).toMatchObject({
      autoDeclinedCount: 1,
      offer: {
        id: firstOfferId,
        status: "accepted"
      },
      deal: {
        listingId: "listing-win-1",
        acceptedOfferId: firstOfferId,
        sellerUserId: seller.userId,
        buyerUserId: buyerOne.userId
      }
    });

    const idempotentAccept = await app.inject({
      method: "POST",
      url: `/v1/offers/${firstOfferId}/accept`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(idempotentAccept.statusCode).toBe(200);
    expect(idempotentAccept.json()).toMatchObject({
      autoDeclinedCount: 0,
      offer: {
        id: firstOfferId,
        status: "accepted"
      }
    });

    const competingAccept = await app.inject({
      method: "POST",
      url: `/v1/offers/${secondOfferId}/accept`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(competingAccept.statusCode).toBe(409);
    expect(competingAccept.json()).toMatchObject({
      code: "offer_already_selected"
    });

    const declineAccepted = await app.inject({
      method: "POST",
      url: `/v1/offers/${firstOfferId}/decline`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(declineAccepted.statusCode).toBe(409);
    expect(declineAccepted.json()).toMatchObject({
      code: "offer_not_actionable"
    });

    const offerRows = dbClient.sqlite
      .prepare("SELECT id, status FROM offers WHERE listing_id = 'listing-win-1' ORDER BY id")
      .all() as Array<{ id: string; status: string }>;
    expect(offerRows).toEqual([
      { id: firstOfferId, status: "accepted" },
      { id: secondOfferId, status: "declined" }
    ]);

    const listingRow = dbClient.sqlite
      .prepare("SELECT status FROM listings WHERE id = 'listing-win-1'")
      .get() as { status: string } | undefined;
    expect(listingRow).toMatchObject({ status: "sold" });

    const dealRows = dbClient.sqlite
      .prepare("SELECT listing_id, accepted_offer_id FROM deals WHERE listing_id = 'listing-win-1'")
      .all() as Array<{ listing_id: string; accepted_offer_id: string }>;
    expect(dealRows).toEqual([
      {
        listing_id: "listing-win-1",
        accepted_offer_id: firstOfferId
      }
    ]);

    await app.close();
  });

  it("rejects unauthenticated seller application access", async () => {
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider: new TestSmsProvider(),
      muxClient: buildMockMuxClient()
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/seller/application"
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "missing_access_token"
    });

    await app.close();
  });

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
      .prepare(
        `
          INSERT INTO seller_sales(
            id,
            seller_user_id,
            session_id,
            listing_id,
            listing_title,
            accepted_offer_amount_cents,
            currency,
            buyer_user_id,
            sold_at,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run("sale-1", seller.userId, "session-1", "listing-1", "Rare Film Reel", 12000, "USD", buyer.userId, Date.now(), Date.now());

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

    expect(auditRows).toHaveLength(4);
    const allowedCount = auditRows.filter((row) => row.outcome === "allowed").length;
    const deniedCount = auditRows.filter((row) => row.outcome === "denied").length;
    expect(allowedCount).toBe(2);
    expect(deniedCount).toBe(2);
    const reasonCodes = new Set(auditRows.map((row) => row.reason_code));
    expect(reasonCodes.has("export_allowed")).toBe(true);
    expect(reasonCodes.has("forbidden_export_scope")).toBe(true);
    expect(reasonCodes.has("forbidden_export_role")).toBe(true);
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
});
