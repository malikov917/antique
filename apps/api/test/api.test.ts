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
  return {
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
});
