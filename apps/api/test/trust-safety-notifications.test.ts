import { describe, expect, it, vi } from "vitest";
import { buildServer } from "../src/server.js";
import { createDatabaseClient } from "../src/db/client.js";
import {
  buildMockMuxClient,
  buildTestConfig,
  createAuthenticatedSeller,
  createAuthenticatedSession,
  createAuthenticatedUser,
  TestSmsProvider
} from "./helpers/apiTestHarness.js";

describe("trust safety notifications api", () => {
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

  it("auto-publishes market session open/close announcements for feed cards", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155550143");
    const buyer = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550144",
      "ios-device-announcements-system-buyer"
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

    const closeSession = await app.inject({
      method: "POST",
      url: `/v1/seller/sessions/${sessionId}/close`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(closeSession.statusCode).toBe(200);

    const listAnnouncements = await app.inject({
      method: "GET",
      url: "/v1/announcements",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      }
    });
    expect(listAnnouncements.statusCode).toBe(200);
    expect(listAnnouncements.json().announcements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "system",
          eventType: "market_session_opened",
          sellerUserId: seller.userId,
          title: "Market day opened",
          body: "Seller started a new market day."
        }),
        expect.objectContaining({
          source: "system",
          eventType: "market_session_closed",
          sellerUserId: seller.userId,
          title: "Market day closed",
          body: "Seller closed the market day."
        })
      ])
    );

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

  it("returns admin observability summary with funnel, error, and seller decision signals", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155550161");
    const buyer = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550162",
      "ios-device-observability-buyer"
    );
    const admin = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550163",
      "ios-device-observability-admin"
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
      .run("listing-observability", seller.userId, sessionId, "default", Date.now(), Date.now());

    const feed = await app.inject({
      method: "GET",
      url: "/v1/feed",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      }
    });
    expect(feed.statusCode).toBe(200);

    const basket = await app.inject({
      method: "POST",
      url: "/v1/listings/listing-observability/basket",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      }
    });
    expect(basket.statusCode).toBe(200);

    const badOffer = await app.inject({
      method: "POST",
      url: "/v1/listings/listing-observability/offers",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        amountCents: 0,
        shippingAddress: "Bad payload"
      }
    });
    expect(badOffer.statusCode).toBe(400);

    const offer = await app.inject({
      method: "POST",
      url: "/v1/listings/listing-observability/offers",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        amountCents: 1550,
        shippingAddress: "44 Funnel Street"
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
    const dealId = accept.json().deal.id as string;

    const paid = await app.inject({
      method: "PATCH",
      url: `/v1/deals/${dealId}/status`,
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        status: "paid"
      }
    });
    expect(paid.statusCode).toBe(200);

    const observability = await app.inject({
      method: "GET",
      url: "/v1/admin/observability/summary?windowHours=24",
      headers: {
        authorization: `Bearer ${admin.accessToken}`
      }
    });
    expect(observability.statusCode).toBe(200);
    expect(observability.json()).toMatchObject({
      funnel: {
        view: expect.any(Number),
        basket: expect.any(Number),
        offer: expect.any(Number),
        accepted: expect.any(Number),
        paid: expect.any(Number)
      },
      errors: {
        total4xx: expect.any(Number),
        total5xx: expect.any(Number)
      },
      sellerDecisionAudit: {
        offerDecisions: expect.any(Number),
        csvExports: expect.any(Number)
      }
    });

    const payload = observability.json() as {
      funnel: { view: number; basket: number; offer: number; accepted: number; paid: number };
      errors: { total4xx: number };
      sellerDecisionAudit: { offerDecisions: number };
    };
    expect(payload.funnel.view).toBeGreaterThanOrEqual(1);
    expect(payload.funnel.basket).toBeGreaterThanOrEqual(1);
    expect(payload.funnel.offer).toBeGreaterThanOrEqual(1);
    expect(payload.funnel.accepted).toBeGreaterThanOrEqual(1);
    expect(payload.funnel.paid).toBeGreaterThanOrEqual(1);
    expect(payload.errors.total4xx).toBeGreaterThanOrEqual(1);
    expect(payload.sellerDecisionAudit.offerDecisions).toBeGreaterThanOrEqual(1);

    await app.close();
  });

  it("creates participant notifications for address correction request and resolution", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155550171");
    const buyer = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155550172",
      "ios-device-address-correction-buyer"
    );

    const openSession = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(openSession.statusCode).toBe(200);

    const listingResponse = await app.inject({
      method: "POST",
      url: "/v1/listings",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      },
      payload: {
        title: "Notification test listing",
        listedPriceCents: 12000
      }
    });
    expect(listingResponse.statusCode).toBe(200);
    const listingId = listingResponse.json().listing.id as string;

    const offerResponse = await app.inject({
      method: "POST",
      url: `/v1/listings/${listingId}/offers`,
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        amountCents: 13000,
        shippingAddress: "Initial address"
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

    const requestResponse = await app.inject({
      method: "POST",
      url: `/v1/deals/${dealId}/address-corrections`,
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        shippingAddress: "Updated shipping address",
        reason: "Address typo"
      }
    });
    expect(requestResponse.statusCode).toBe(200);
    const correctionId = requestResponse.json().correction.id as string;

    const approveResponse = await app.inject({
      method: "POST",
      url: `/v1/deals/${dealId}/address-corrections/${correctionId}/approve`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(approveResponse.statusCode).toBe(200);

    const sellerNotifications = await app.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(sellerNotifications.statusCode).toBe(200);
    expect(sellerNotifications.json().notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "deal_address_correction_requested"
        })
      ])
    );

    const buyerNotifications = await app.inject({
      method: "GET",
      url: "/v1/notifications",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      }
    });
    expect(buyerNotifications.statusCode).toBe(200);
    expect(buyerNotifications.json().notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "deal_address_correction_approved"
        })
      ])
    );

    await app.close();
  });
});
