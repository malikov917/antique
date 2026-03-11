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
    offerSubmitPerUserPerHour: 30,
    offerDecisionPerSellerPerHour: 120,
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
    expect(typeof feedResponse.json().items[0].freshnessUpdatedAt).toBe("string");
    expect(typeof feedResponse.json().items[0].freshnessAgeSec).toBe("number");
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

  it("rejects cross-tenant seller application review attempts", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const applicant = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155559007",
      "ios-device-seller-application-applicant-tenant"
    );
    const admin = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155559008",
      "ios-device-seller-application-admin-tenant"
    );

    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ?, active_role = ?, tenant_id = ? WHERE id = ?")
      .run(JSON.stringify(["buyer", "admin"]), "admin", "tenant-admin", admin.userId);

    await app.inject({
      method: "POST",
      url: "/v1/seller/apply",
      headers: {
        authorization: `Bearer ${applicant.accessToken}`
      },
      payload: {
        fullName: "Applicant Tenant",
        shopName: "Tenant Shop"
      }
    });

    const approveResponse = await app.inject({
      method: "POST",
      url: `/v1/admin/seller-applications/${applicant.userId}/approve`,
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      }
    });

    expect(approveResponse.statusCode).toBe(403);
    expect(approveResponse.json()).toMatchObject({
      code: "forbidden_tenant_scope"
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
          INSERT INTO listings (id, seller_user_id, market_session_id, tenant_id, status, created_at, updated_at)
          VALUES
            ('listing-live-1', ?, ?, ?, 'live', 1, 1),
            ('listing-sold-1', ?, ?, ?, 'sold', 1, 1)
        `
      )
      .run(seller.userId, sessionId, "default", seller.userId, sessionId, "default");

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

  it("rejects session close when authenticated seller tenant does not match session tenant", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155552679");
    const openResponse = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(openResponse.statusCode).toBe(200);
    const sessionId = openResponse.json().session.id as string;

    dbClient.sqlite
      .prepare("UPDATE users SET tenant_id = ? WHERE id = ?")
      .run("tenant-shifted", seller.userId);

    const closeResponse = await app.inject({
      method: "POST",
      url: `/v1/seller/sessions/${sessionId}/close`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(closeResponse.statusCode).toBe(403);
    expect(closeResponse.json()).toMatchObject({
      code: "forbidden_tenant_scope"
    });

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
          INSERT INTO listings (id, seller_user_id, market_session_id, tenant_id, status, created_at, updated_at)
          VALUES ('listing-live-2', ?, ?, ?, 'live', 1, 1)
        `
      )
      .run(seller.userId, sessionId, "default");

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

  it("creates basket item and persists shipping snapshot on offer submit", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155552670");
    const buyer = await createAuthenticatedUser(app, smsProvider, "+14155552671");

    const openResponse = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(openResponse.statusCode).toBe(200);

    const listingResponse = await app.inject({
      method: "POST",
      url: "/v1/listings",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      },
      payload: {
        title: "Reel Camera Lot",
        listedPriceCents: 18000
      }
    });
    expect(listingResponse.statusCode).toBe(200);
    const listingId = listingResponse.json().listing.id as string;

    const basketResponse = await app.inject({
      method: "POST",
      url: `/v1/listings/${listingId}/basket`,
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      }
    });
    expect(basketResponse.statusCode).toBe(200);
    expect(basketResponse.json()).toMatchObject({
      basketItem: {
        listingId,
        buyerUserId: buyer.userId
      }
    });

    const offerResponse = await app.inject({
      method: "POST",
      url: `/v1/listings/${listingId}/offers`,
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        amountCents: 19000,
        shippingAddress: "  44 Vintage Road  "
      }
    });
    expect(offerResponse.statusCode).toBe(200);
    expect(offerResponse.json().offer).toMatchObject({
      listingId,
      buyerUserId: buyer.userId,
      amountCents: 19000,
      shippingAddress: "44 Vintage Road"
    });

    const offerRow = dbClient.sqlite
      .prepare("SELECT shipping_address FROM offers WHERE id = ?")
      .get(offerResponse.json().offer.id) as { shipping_address: string };
    expect(offerRow.shipping_address).toBe("44 Vintage Road");

    await app.close();
  });

  it("allows sellers to create and update listings only during open market sessions", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155552677");

    const withoutSession = await app.inject({
      method: "POST",
      url: "/v1/listings",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      },
      payload: {
        title: "No Session Reel",
        description: "Attempt without open market day",
        listedPriceCents: 15000
      }
    });
    expect(withoutSession.statusCode).toBe(409);
    expect(withoutSession.json()).toMatchObject({
      code: "market_session_not_open"
    });

    const openResponse = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(openResponse.statusCode).toBe(200);
    const sessionId = openResponse.json().session.id as string;

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/listings",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      },
      payload: {
        title: "Vintage Camera Reel",
        description: "Leica M3 in collector condition",
        listedPriceCents: 23000,
        currency: "usd"
      }
    });
    expect(createResponse.statusCode).toBe(200);
    const listingId = createResponse.json().listing.id as string;
    expect(createResponse.json()).toMatchObject({
      listing: {
        id: listingId,
        sellerUserId: seller.userId,
        marketSessionId: sessionId,
        status: "live",
        title: "Vintage Camera Reel",
        listedPriceCents: 23000,
        currency: "USD"
      }
    });

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/v1/listings/${listingId}`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      },
      payload: {
        title: "Vintage Camera Reel (Updated)",
        listedPriceCents: 26000
      }
    });
    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json()).toMatchObject({
      listing: {
        id: listingId,
        title: "Vintage Camera Reel (Updated)",
        listedPriceCents: 26000
      }
    });

    await app.inject({
      method: "POST",
      url: `/v1/seller/sessions/${sessionId}/close`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });

    const updateAfterClose = await app.inject({
      method: "PATCH",
      url: `/v1/listings/${listingId}`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      },
      payload: {
        listedPriceCents: 27000
      }
    });
    expect(updateAfterClose.statusCode).toBe(409);
    expect(updateAfterClose.json()).toMatchObject({
      code: "market_session_not_open"
    });

    await app.close();
  });

  it("rejects offers below listing listed price floor", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155552678");
    const buyer = await createAuthenticatedUser(app, smsProvider, "+14155552679");

    const openResponse = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(openResponse.statusCode).toBe(200);

    const listingResponse = await app.inject({
      method: "POST",
      url: "/v1/listings",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      },
      payload: {
        title: "Projector Reel",
        listedPriceCents: 20000
      }
    });
    expect(listingResponse.statusCode).toBe(200);
    const listingId = listingResponse.json().listing.id as string;

    const belowFloor = await app.inject({
      method: "POST",
      url: `/v1/listings/${listingId}/offers`,
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        amountCents: 15000,
        shippingAddress: "10 Auction Way"
      }
    });
    expect(belowFloor.statusCode).toBe(409);
    expect(belowFloor.json()).toMatchObject({
      code: "offer_below_listed_price"
    });

    const atFloor = await app.inject({
      method: "POST",
      url: `/v1/listings/${listingId}/offers`,
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        amountCents: 20000,
        shippingAddress: "10 Auction Way"
      }
    });
    expect(atFloor.statusCode).toBe(200);

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
          INSERT INTO listings (id, seller_user_id, market_session_id, tenant_id, status, created_at, updated_at)
          VALUES ('listing-win-1', ?, ?, ?, 'live', 1, 1)
        `
      )
      .run(seller.userId, sessionId, "default");

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
    expect(offerRows).toHaveLength(2);
    expect(offerRows).toEqual(
      expect.arrayContaining([
        { id: firstOfferId, status: "accepted" },
        { id: secondOfferId, status: "declined" }
      ])
    );

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

  it("supports deal status progression and per-deal chat messaging for participants", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155552690");
    const buyer = await createAuthenticatedUser(app, smsProvider, "+14155552691");
    const outsider = await createAuthenticatedUser(app, smsProvider, "+14155552692");

    const sessionResponse = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(sessionResponse.statusCode).toBe(200);
    const sessionId = sessionResponse.json().session.id as string;

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO listings (id, seller_user_id, market_session_id, tenant_id, status, created_at, updated_at)
          VALUES ('listing-chat-1', ?, ?, ?, 'live', 1, 1)
        `
      )
      .run(seller.userId, sessionId, "default");

    const offerResponse = await app.inject({
      method: "POST",
      url: "/v1/listings/listing-chat-1/offers",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        amountCents: 22000,
        shippingAddress: "777 Cinema Ln"
      }
    });
    expect(offerResponse.statusCode).toBe(200);
    const offerId = offerResponse.json().offer.id as string;

    const acceptResponse = await app.inject({
      method: "POST",
      url: `/v1/offers/${offerId}/accept`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(acceptResponse.statusCode).toBe(200);
    const dealId = acceptResponse.json().deal.id as string;
    expect(acceptResponse.json().deal).toMatchObject({
      status: "open"
    });

    const sellerDealsResponse = await app.inject({
      method: "GET",
      url: "/v1/deals/me",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(sellerDealsResponse.statusCode).toBe(200);
    expect(sellerDealsResponse.json().deals).toHaveLength(1);
    expect(sellerDealsResponse.json().deals[0]).toMatchObject({
      id: dealId,
      status: "open"
    });

    const buyerPaidResponse = await app.inject({
      method: "PATCH",
      url: `/v1/deals/${dealId}/status`,
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        status: "paid"
      }
    });
    expect(buyerPaidResponse.statusCode).toBe(200);
    expect(buyerPaidResponse.json().deal).toMatchObject({
      id: dealId,
      status: "paid"
    });

    const sellerCompletedResponse = await app.inject({
      method: "PATCH",
      url: `/v1/deals/${dealId}/status`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      },
      payload: {
        status: "completed"
      }
    });
    expect(sellerCompletedResponse.statusCode).toBe(200);
    expect(sellerCompletedResponse.json().deal).toMatchObject({
      id: dealId,
      status: "completed"
    });

    const invalidTransitionResponse = await app.inject({
      method: "PATCH",
      url: `/v1/deals/${dealId}/status`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      },
      payload: {
        status: "paid"
      }
    });
    expect(invalidTransitionResponse.statusCode).toBe(409);
    expect(invalidTransitionResponse.json()).toMatchObject({
      code: "deal_invalid_status_transition"
    });

    const chatsResponse = await app.inject({
      method: "GET",
      url: "/v1/chats",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      }
    });
    expect(chatsResponse.statusCode).toBe(200);
    expect(chatsResponse.json().chats).toHaveLength(1);
    const chatId = chatsResponse.json().chats[0].id as string;

    const buyerMessageResponse = await app.inject({
      method: "POST",
      url: `/v1/chats/${chatId}/messages`,
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        text: "Payment sent, please confirm."
      }
    });
    expect(buyerMessageResponse.statusCode).toBe(200);
    expect(buyerMessageResponse.json().message).toMatchObject({
      chatId,
      senderUserId: buyer.userId,
      text: "Payment sent, please confirm."
    });

    const sellerMessageResponse = await app.inject({
      method: "POST",
      url: `/v1/chats/${chatId}/messages`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      },
      payload: {
        text: "Confirmed, preparing shipment."
      }
    });
    expect(sellerMessageResponse.statusCode).toBe(200);

    const messageListResponse = await app.inject({
      method: "GET",
      url: `/v1/chats/${chatId}/messages`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(messageListResponse.statusCode).toBe(200);
    expect(messageListResponse.json().messages).toHaveLength(2);
    expect(messageListResponse.json().messages.map((message: { text: string }) => message.text)).toEqual(
      expect.arrayContaining(["Payment sent, please confirm.", "Confirmed, preparing shipment."])
    );

    const outsiderChatsResponse = await app.inject({
      method: "GET",
      url: "/v1/chats",
      headers: {
        authorization: `Bearer ${outsider.accessToken}`
      }
    });
    expect(outsiderChatsResponse.statusCode).toBe(200);
    expect(outsiderChatsResponse.json().chats).toHaveLength(0);

    const outsiderMessagesResponse = await app.inject({
      method: "GET",
      url: `/v1/chats/${chatId}/messages`,
      headers: {
        authorization: `Bearer ${outsider.accessToken}`
      }
    });
    expect(outsiderMessagesResponse.statusCode).toBe(403);
    expect(outsiderMessagesResponse.json()).toMatchObject({
      code: "forbidden_owner_mismatch"
    });

    await app.close();
  });

  it("rejects cross-tenant basket and offer mutations", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155552675");
    const buyer = await createAuthenticatedUser(app, smsProvider, "+14155552676");
    dbClient.sqlite
      .prepare("UPDATE users SET tenant_id = ? WHERE id = ?")
      .run("tenant-b", buyer.userId);

    const openResponse = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(openResponse.statusCode).toBe(200);
    const sessionId = openResponse.json().session.id as string;
    dbClient.sqlite
      .prepare(
        `
          INSERT INTO listings (id, seller_user_id, market_session_id, tenant_id, status, created_at, updated_at)
          VALUES ('listing-live-cross-tenant', ?, ?, ?, 'live', 1, 1)
        `
      )
      .run(seller.userId, sessionId, "default");

    const basketResponse = await app.inject({
      method: "POST",
      url: "/v1/listings/listing-live-cross-tenant/basket",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      }
    });
    expect(basketResponse.statusCode).toBe(403);
    expect(basketResponse.json()).toMatchObject({
      code: "forbidden_tenant_scope"
    });

    const offerResponse = await app.inject({
      method: "POST",
      url: "/v1/listings/listing-live-cross-tenant/offers",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        amountCents: 30000,
        shippingAddress: "456 Vintage Rd"
      }
    });
    expect(offerResponse.statusCode).toBe(403);
    expect(offerResponse.json()).toMatchObject({
      code: "forbidden_tenant_scope"
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

  it("rate limits offer submissions with explicit auth error code", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig({
        offerSubmitPerUserPerHour: 1
      }),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155550101");
    const buyer = await createAuthenticatedBuyer(app, smsProvider, "+14155550102");

    const openSession = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(openSession.statusCode).toBe(200);
    const sessionId = openSession.json().session.id as string;

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO listings (id, seller_user_id, market_session_id, tenant_id, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'live', ?, ?)
        `
      )
      .run("listing-rate-limit", seller.userId, sessionId, "default", Date.now(), Date.now());

    const first = await app.inject({
      method: "POST",
      url: "/v1/listings/listing-rate-limit/offers",
      headers: {
        authorization: `Bearer ${buyer}`
      },
      payload: {
        amountCents: 1000,
        shippingAddress: "101 Test St"
      }
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: "/v1/listings/listing-rate-limit/offers",
      headers: {
        authorization: `Bearer ${buyer}`
      },
      payload: {
        amountCents: 1200,
        shippingAddress: "102 Test St"
      }
    });
    expect(second.statusCode).toBe(429);
    expect(second.json()).toMatchObject({
      code: "offer_action_rate_limited"
    });

    await app.close();
  });

  it("supports user report/block and enforces blocked interactions in offer flow", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155550111");
    const buyer = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550112",
      "ios-device-report-block-buyer"
    );

    const openSession = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(openSession.statusCode).toBe(200);
    const sessionId = openSession.json().session.id as string;

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO listings (id, seller_user_id, market_session_id, tenant_id, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'live', ?, ?)
        `
      )
      .run("listing-blocked", seller.userId, sessionId, "default", Date.now(), Date.now());

    const reportResponse = await app.inject({
      method: "POST",
      url: `/v1/users/${seller.userId}/report`,
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        reason: "abusive_behavior",
        details: "Repeated spam messages"
      }
    });
    expect(reportResponse.statusCode).toBe(200);
    expect(reportResponse.json()).toMatchObject({
      reportId: expect.any(String)
    });

    const blockResponse = await app.inject({
      method: "POST",
      url: `/v1/users/${seller.userId}/block`,
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      }
    });
    expect(blockResponse.statusCode).toBe(200);
    expect(blockResponse.json()).toMatchObject({
      success: true
    });

    const offerResponse = await app.inject({
      method: "POST",
      url: "/v1/listings/listing-blocked/offers",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        amountCents: 1500,
        shippingAddress: "202 Test St"
      }
    });
    expect(offerResponse.statusCode).toBe(403);
    expect(offerResponse.json()).toMatchObject({
      code: "interaction_blocked"
    });

    await app.close();
  });

  it("allows admin suspension and blocks suspended seller marketplace actions", async () => {
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
      "+14155550121",
      "ios-device-suspension-seller"
    );
    const admin = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550122",
      "ios-device-suspension-admin"
    );

    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ?, active_role = ? WHERE id = ?")
      .run(JSON.stringify(["buyer", "seller"]), "seller", seller.userId);
    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ?, active_role = ? WHERE id = ?")
      .run(JSON.stringify(["buyer", "admin"]), "admin", admin.userId);

    const suspendResponse = await app.inject({
      method: "POST",
      url: `/v1/admin/sellers/${seller.userId}/suspend`,
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      },
      payload: {
        reason: "fraud_suspected"
      }
    });
    expect(suspendResponse.statusCode).toBe(200);
    expect(suspendResponse.json()).toMatchObject({
      userId: seller.userId,
      suspendedAt: expect.any(String)
    });

    const openSessionResponse = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(openSessionResponse.statusCode).toBe(403);
    expect(openSessionResponse.json()).toMatchObject({
      code: "seller_suspended"
    });

    await app.close();
  });

  it("allows admin listing moderation flags for quality workflows", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155550131");
    const admin = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550132",
      "ios-device-flag-admin"
    );
    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ?, active_role = ? WHERE id = ?")
      .run(JSON.stringify(["buyer", "admin"]), "admin", admin.userId);

    const openSession = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(openSession.statusCode).toBe(200);
    const sessionId = openSession.json().session.id as string;
    dbClient.sqlite
      .prepare(
        `
          INSERT INTO listings (id, seller_user_id, market_session_id, tenant_id, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'live', ?, ?)
        `
      )
      .run("listing-flag", seller.userId, sessionId, "default", Date.now(), Date.now());

    const flagResponse = await app.inject({
      method: "POST",
      url: "/v1/admin/listings/listing-flag/moderation-flags",
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      },
      payload: {
        reasonCode: "video_blurry",
        note: "Video quality is not acceptable for listing approval"
      }
    });
    expect(flagResponse.statusCode).toBe(200);
    expect(flagResponse.json()).toMatchObject({
      listingId: "listing-flag",
      reasonCode: "video_blurry",
      status: "open"
    });

    const persisted = dbClient.sqlite
      .prepare(
        `
          SELECT reason_code, status
          FROM listing_moderation_flags
          WHERE listing_id = ?
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get("listing-flag") as { reason_code: string; status: string } | undefined;

    expect(persisted).toMatchObject({
      reason_code: "video_blurry",
      status: "open"
    });

    await app.close();
  });

  it("creates seller announcements and exposes tenant-scoped notification timeline", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155550141");
    const buyer = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550142",
      "ios-device-announcements-buyer"
    );

    const createAnnouncement = await app.inject({
      method: "POST",
      url: "/v1/announcements",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      },
      payload: {
        title: "Today drop starts now",
        body: "Fresh reels are now available for offers."
      }
    });
    expect(createAnnouncement.statusCode).toBe(200);
    expect(createAnnouncement.json()).toMatchObject({
      announcement: {
        title: "Today drop starts now"
      }
    });

    const listAnnouncements = await app.inject({
      method: "GET",
      url: "/v1/announcements",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      }
    });
    expect(listAnnouncements.statusCode).toBe(200);
    expect(listAnnouncements.json().announcements).toHaveLength(1);

    const notifications = await app.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      }
    });
    expect(notifications.statusCode).toBe(200);
    expect(notifications.json().notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "announcement",
          title: "Today drop starts now"
        })
      ])
    );

    const funnelEvent = dbClient.sqlite
      .prepare(
        `
          SELECT reason_code
          FROM audit_events
          WHERE event_type = 'funnel_event'
            AND reason_code = 'announcement_posted'
          LIMIT 1
        `
      )
      .get() as { reason_code: string } | undefined;
    expect(funnelEvent?.reason_code).toBe("announcement_posted");

    await app.close();
  });

  it("records push attempts with retry/backoff for notification dispatch failures", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const flakyPushProvider = {
      send: vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary push failure"))
        .mockResolvedValue(undefined)
    };
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient,
      notificationPushProvider: flakyPushProvider
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155550151");
    const buyer = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550152",
      "ios-device-push-buyer"
    );

    const registerToken = await app.inject({
      method: "POST",
      url: "/v1/me/push-token",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        token: "ExponentPushToken[test-token]",
        platform: "ios"
      }
    });
    expect(registerToken.statusCode).toBe(200);

    const openSession = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(openSession.statusCode).toBe(200);
    const sessionId = openSession.json().session.id as string;

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO listings (id, seller_user_id, market_session_id, tenant_id, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'live', ?, ?)
        `
      )
      .run("listing-push-test", seller.userId, sessionId, "default", Date.now(), Date.now());

    const offer = await app.inject({
      method: "POST",
      url: "/v1/listings/listing-push-test/offers",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        amountCents: 1400,
        shippingAddress: "12 Push Lane"
      }
    });
    expect(offer.statusCode).toBe(200);
    const offerId = offer.json().offer.id as string;

    const accept = await app.inject({
      method: "POST",
      url: `/v1/offers/${offerId}/accept`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(accept.statusCode).toBe(200);

    const attemptRows = dbClient.sqlite
      .prepare(
        `
          SELECT status, attempt, next_retry_at
          FROM notification_push_attempts
          ORDER BY created_at ASC, attempt ASC
        `
      )
      .all() as Array<{ status: string; attempt: number; next_retry_at: number | null }>;

    expect(attemptRows.length).toBeGreaterThanOrEqual(2);
    expect(attemptRows[0]).toMatchObject({
      status: "failed",
      attempt: 1
    });
    expect(attemptRows[0]?.next_retry_at).not.toBeNull();
    expect(attemptRows.some((row) => row.status === "sent")).toBe(true);

    await app.close();
  });
});
