import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { createDatabaseClient } from "../src/db/client.js";
import {
  buildMockMuxClient,
  buildTestConfig,
  createAuthenticatedAdmin,
  createAuthenticatedUser,
  TestSmsProvider
} from "./helpers/apiTestHarness.js";

describe("admin allowlist governance", () => {
  it("grants admin role to allowlisted phone on first signup", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const phone = "+14155559999";
    dbClient.sqlite
      .prepare("INSERT INTO admin_allowlist(phone_e164, created_at) VALUES (?, ?)")
      .run(phone, Date.now());

    await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone }
    });
    const code = smsProvider.getLastCode(phone);
    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: {
        phone,
        code,
        deviceId: "ios-device-admin-1",
        platform: "ios"
      }
    });

    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toMatchObject({
      user: {
        phone,
        allowedRoles: ["buyer", "admin"],
        activeRole: "buyer"
      }
    });

    await app.close();
  });

  it("does not grant admin role to non-allowlisted phone on signup", async () => {
    const smsProvider = new TestSmsProvider();
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient()
    });

    const phone = "+14155558888";

    await app.inject({
      method: "POST",
      url: "/v1/auth/otp/request",
      payload: { phone }
    });
    const code = smsProvider.getLastCode(phone);
    const verify = await app.inject({
      method: "POST",
      url: "/v1/auth/otp/verify",
      payload: {
        phone,
        code,
        deviceId: "ios-device-buyer-1",
        platform: "ios"
      }
    });

    expect(verify.statusCode).toBe(200);
    expect(verify.json()).toMatchObject({
      user: {
        phone,
        allowedRoles: ["buyer"],
        activeRole: "buyer"
      }
    });

    await app.close();
  });

  it("blocks role switch to admin for non-allowlisted users", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const auth = await createAuthenticatedUser(app, smsProvider, "+14155557777");
    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ? WHERE id = ?")
      .run(JSON.stringify(["buyer", "admin"]), auth.userId);

    const roleSwitch = await app.inject({
      method: "POST",
      url: "/v1/me/role-switch",
      headers: {
        authorization: `Bearer ${auth.accessToken}`
      },
      payload: {
        role: "admin"
      }
    });

    expect(roleSwitch.statusCode).toBe(403);
    expect(roleSwitch.json()).toMatchObject({
      code: "forbidden_role_switch"
    });

    await app.close();
  });

  it("allows admin to list allowlist entries", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const admin = await createAuthenticatedAdmin(app, smsProvider, dbClient);

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/admin/allowlist",
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      }
    });

    expect(listResponse.statusCode).toBe(200);
    const payload = listResponse.json() as { entries: Array<{ phoneE164: string }> };
    expect(payload.entries.length).toBeGreaterThanOrEqual(1);
    expect(payload.entries.some((e) => e.phoneE164 === "+14155552673")).toBe(true);

    await app.close();
  });

  it("allows admin to add and remove allowlist entries", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const admin = await createAuthenticatedAdmin(app, smsProvider, dbClient);

    const addResponse = await app.inject({
      method: "POST",
      url: "/v1/admin/allowlist",
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      },
      payload: {
        phoneE164: "+14155551111"
      }
    });

    expect(addResponse.statusCode).toBe(200);
    expect(addResponse.json()).toMatchObject({
      entry: {
        phoneE164: "+14155551111"
      }
    });

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: "/v1/admin/allowlist/+14155551111",
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      }
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(deleteResponse.json()).toMatchObject({
      removed: true
    });

    const listAfterDelete = await app.inject({
      method: "GET",
      url: "/v1/admin/allowlist",
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      }
    });

    const listPayload = listAfterDelete.json() as { entries: Array<{ phoneE164: string }> };
    expect(listPayload.entries.some((e) => e.phoneE164 === "+14155551111")).toBe(false);

    await app.close();
  });

  it("rejects non-admin from managing allowlist", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const buyer = await createAuthenticatedUser(app, smsProvider, "+14155556666");

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/admin/allowlist",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      }
    });

    expect(listResponse.statusCode).toBe(403);
    expect(listResponse.json()).toMatchObject({
      code: "forbidden_admin_role"
    });

    const addResponse = await app.inject({
      method: "POST",
      url: "/v1/admin/allowlist",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        phoneE164: "+14155552222"
      }
    });

    expect(addResponse.statusCode).toBe(403);

    await app.close();
  });

  it("protects admin-only endpoints with allowlist validation", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const admin = await createAuthenticatedAdmin(app, smsProvider, dbClient);

    const observabilityResponse = await app.inject({
      method: "GET",
      url: "/v1/admin/observability/summary",
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      }
    });

    expect(observabilityResponse.statusCode).toBe(200);

    await app.close();
  });
});
