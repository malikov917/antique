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

describe("seller applications api", () => {
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
