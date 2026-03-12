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

describe("tenant guards api", () => {
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
});
