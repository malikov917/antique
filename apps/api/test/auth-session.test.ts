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

describe("auth session api", () => {
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
});
