import { expect, vi } from "vitest";
import { buildServer } from "../../src/server.js";
import { type ApiConfig } from "../../src/config.js";
import { createDatabaseClient } from "../../src/db/client.js";
import { type SmsProvider } from "../../src/services/authService.js";
import { type MuxClient } from "../../src/services/videoProvider.js";

export function buildMockMuxClient(params?: {
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

export function buildTestConfig(overrides?: Partial<ApiConfig>): ApiConfig {
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

export class TestSmsProvider implements SmsProvider {
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

export async function createAuthenticatedBuyer(
  app: Awaited<ReturnType<typeof buildServer>>,
  smsProvider: TestSmsProvider,
  phone = "+14155552671"
): Promise<string> {
  const auth = await createAuthenticatedUser(app, smsProvider, phone);
  return auth.accessToken;
}

export async function createAuthenticatedUser(
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

export async function createAuthenticatedSeller(
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

export async function createAuthenticatedSession(
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
