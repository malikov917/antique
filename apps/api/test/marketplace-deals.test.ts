import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { createDatabaseClient } from "../src/db/client.js";
import { MarketplaceService } from "../src/services/marketplaceService.js";
import {
  buildMockMuxClient,
  buildTestConfig,
  createAuthenticatedBuyer,
  createAuthenticatedSeller,
  createAuthenticatedSession,
  createAuthenticatedUser,
  TestSmsProvider
} from "./helpers/apiTestHarness.js";

describe("marketplace deals api", () => {
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

  it("supports seller cancellation request and buyer resolution for unpaid deals", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155552693");
    const buyer = await createAuthenticatedUser(app, smsProvider, "+14155552694");

    const openSession = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: { authorization: `Bearer ${seller.accessToken}` }
    });
    const sessionId = openSession.json().session.id as string;

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO listings (id, seller_user_id, market_session_id, tenant_id, status, created_at, updated_at)
          VALUES ('listing-cancel-open', ?, ?, ?, 'live', 1, 1)
        `
      )
      .run(seller.userId, sessionId, "default");

    const offerResponse = await app.inject({
      method: "POST",
      url: "/v1/listings/listing-cancel-open/offers",
      headers: { authorization: `Bearer ${buyer.accessToken}` },
      payload: { amountCents: 1600, shippingAddress: "12 Request Lane" }
    });
    const offerId = offerResponse.json().offer.id as string;

    const acceptResponse = await app.inject({
      method: "POST",
      url: `/v1/offers/${offerId}/accept`,
      headers: { authorization: `Bearer ${seller.accessToken}` }
    });
    const dealId = acceptResponse.json().deal.id as string;

    const requestResponse = await app.inject({
      method: "POST",
      url: `/v1/deals/${dealId}/cancel-request`,
      headers: { authorization: `Bearer ${seller.accessToken}` },
      payload: { reasonCode: "seller_unavailable", note: "Item damaged during packing" }
    });
    expect(requestResponse.statusCode).toBe(200);
    expect(requestResponse.json().deal).toMatchObject({ status: "cancellation_requested" });

    const sellerResolveResponse = await app.inject({
      method: "PATCH",
      url: `/v1/deals/${dealId}/status`,
      headers: { authorization: `Bearer ${seller.accessToken}` },
      payload: { status: "canceled", reasonCode: "seller_unavailable" }
    });
    expect(sellerResolveResponse.statusCode).toBe(403);
    expect(sellerResolveResponse.json()).toMatchObject({ code: "deal_cancellation_not_allowed" });

    const buyerResolveResponse = await app.inject({
      method: "PATCH",
      url: `/v1/deals/${dealId}/status`,
      headers: { authorization: `Bearer ${buyer.accessToken}` },
      payload: { status: "canceled", reasonCode: "buyer_acknowledged" }
    });
    expect(buyerResolveResponse.statusCode).toBe(200);
    expect(buyerResolveResponse.json().deal).toMatchObject({ status: "canceled" });

    const auditRows = dbClient.sqlite
      .prepare(
        `
          SELECT event_type, reason_code
          FROM audit_events
          WHERE event_type IN ('deal_cancellation_requested', 'deal_cancellation_resolved')
          ORDER BY created_at ASC
        `
      )
      .all() as Array<{ event_type: string; reason_code: string }>;
    expect(auditRows).toEqual([
      { event_type: "deal_cancellation_requested", reason_code: "seller_unavailable" },
      { event_type: "deal_cancellation_resolved", reason_code: "buyer_acknowledged" }
    ]);

    await app.close();
  });

  it("requires admin refund confirmation for paid cancellation resolution", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155552695");
    const buyer = await createAuthenticatedUser(app, smsProvider, "+14155552696");
    const admin = await createAuthenticatedSession(
      app,
      smsProvider,
      "+14155552697",
      "ios-device-cancel-admin"
    );
    dbClient.sqlite
      .prepare("UPDATE users SET allowed_roles = ?, active_role = 'admin' WHERE id = ?")
      .run(JSON.stringify(["buyer", "admin"]), admin.userId);

    const openSession = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: { authorization: `Bearer ${seller.accessToken}` }
    });
    const sessionId = openSession.json().session.id as string;

    dbClient.sqlite
      .prepare(
        `
          INSERT INTO listings (id, seller_user_id, market_session_id, tenant_id, status, created_at, updated_at)
          VALUES ('listing-cancel-paid', ?, ?, ?, 'live', 1, 1)
        `
      )
      .run(seller.userId, sessionId, "default");

    const offerResponse = await app.inject({
      method: "POST",
      url: "/v1/listings/listing-cancel-paid/offers",
      headers: { authorization: `Bearer ${buyer.accessToken}` },
      payload: { amountCents: 2200, shippingAddress: "44 Refund Ave" }
    });
    const offerId = offerResponse.json().offer.id as string;

    const acceptResponse = await app.inject({
      method: "POST",
      url: `/v1/offers/${offerId}/accept`,
      headers: { authorization: `Bearer ${seller.accessToken}` }
    });
    const dealId = acceptResponse.json().deal.id as string;

    const paidResponse = await app.inject({
      method: "PATCH",
      url: `/v1/deals/${dealId}/status`,
      headers: { authorization: `Bearer ${buyer.accessToken}` },
      payload: { status: "paid" }
    });
    expect(paidResponse.statusCode).toBe(200);

    const requestResponse = await app.inject({
      method: "POST",
      url: `/v1/deals/${dealId}/cancel-request`,
      headers: { authorization: `Bearer ${seller.accessToken}` },
      payload: { reasonCode: "seller_logistics" }
    });
    expect(requestResponse.statusCode).toBe(200);

    const buyerRefundResponse = await app.inject({
      method: "PATCH",
      url: `/v1/deals/${dealId}/status`,
      headers: { authorization: `Bearer ${buyer.accessToken}` },
      payload: { status: "refunded", refundConfirmed: true, reasonCode: "buyer_request" }
    });
    expect(buyerRefundResponse.statusCode).toBe(409);
    expect(buyerRefundResponse.json()).toMatchObject({ code: "deal_cancellation_requires_refund" });

    const adminWithoutConfirmation = await app.inject({
      method: "PATCH",
      url: `/v1/deals/${dealId}/status`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: { status: "refunded", reasonCode: "admin_resolution" }
    });
    expect(adminWithoutConfirmation.statusCode).toBe(409);
    expect(adminWithoutConfirmation.json()).toMatchObject({ code: "deal_cancellation_requires_refund" });

    const adminWithConfirmation = await app.inject({
      method: "PATCH",
      url: `/v1/deals/${dealId}/status`,
      headers: { authorization: `Bearer ${admin.accessToken}` },
      payload: {
        status: "refunded",
        refundConfirmed: true,
        reasonCode: "admin_resolution"
      }
    });
    expect(adminWithConfirmation.statusCode).toBe(200);
    expect(adminWithConfirmation.json().deal).toMatchObject({ status: "refunded" });

    const refundAudit = dbClient.sqlite
      .prepare(
        `
          SELECT event_type, reason_code
          FROM audit_events
          WHERE event_type = 'deal_refund_confirmed'
          ORDER BY created_at DESC
          LIMIT 1
        `
      )
      .get() as { event_type: string; reason_code: string } | undefined;
    expect(refundAudit).toMatchObject({
      event_type: "deal_refund_confirmed",
      reason_code: "admin_resolution"
    });

    await app.close();
  });

  it("transitions open deals to payment_overdue via sweep and keeps transitions idempotent", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    let nowMs = Date.now();
    const app = await buildServer({
      config: buildTestConfig({
        dealPaymentDueAfterSec: 60
      }),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient,
      now: () => nowMs
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155552693");
    const buyer = await createAuthenticatedUser(app, smsProvider, "+14155552694");

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
          VALUES ('listing-overdue-1', ?, ?, ?, 'live', ?, ?)
        `
      )
      .run(seller.userId, sessionId, "default", nowMs, nowMs);

    const offerResponse = await app.inject({
      method: "POST",
      url: "/v1/listings/listing-overdue-1/offers",
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        amountCents: 25000,
        shippingAddress: "201 Timeout Street"
      }
    });
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
      status: "open",
      paymentOverdueAt: null,
      paymentTimeoutReason: null
    });

    const overdueByApi = await app.inject({
      method: "PATCH",
      url: `/v1/deals/${dealId}/status`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      },
      payload: {
        status: "payment_overdue"
      }
    });
    expect(overdueByApi.statusCode).toBe(400);
    expect(overdueByApi.json()).toMatchObject({
      code: "invalid_request"
    });

    nowMs += 61_000;
    const sweep = new MarketplaceService(
      dbClient.sqlite,
      {
        offerSubmitPerUserPerHour: 30,
        offerDecisionPerSellerPerHour: 120,
        dealPaymentDueAfterMs: 60_000
      },
      () => nowMs
    );

    const firstRun = sweep.runPaymentOverdueSweep();
    expect(firstRun.transitionedDealCount).toBe(1);
    expect(firstRun.overdueOpenDealCount).toBe(0);

    const secondRun = sweep.runPaymentOverdueSweep();
    expect(secondRun.transitionedDealCount).toBe(0);

    const dealsResponse = await app.inject({
      method: "GET",
      url: "/v1/deals/me",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(dealsResponse.statusCode).toBe(200);
    expect(dealsResponse.json().deals[0]).toMatchObject({
      id: dealId,
      status: "payment_overdue",
      paymentOverdueAt: new Date(nowMs).toISOString(),
      paymentTimeoutReason: "payment_deadline_elapsed"
    });

    const buyerPaid = await app.inject({
      method: "PATCH",
      url: `/v1/deals/${dealId}/status`,
      headers: {
        authorization: `Bearer ${buyer.accessToken}`
      },
      payload: {
        status: "paid"
      }
    });
    expect(buyerPaid.statusCode).toBe(200);
    expect(buyerPaid.json().deal).toMatchObject({
      status: "paid"
    });

    const timeoutAuditRows = dbClient.sqlite
      .prepare(
        `
          SELECT event_type, reason_code, metadata_json
          FROM audit_events
          WHERE event_type = 'deal_payment_timeout'
            AND reason_code = 'payment_deadline_elapsed'
        `
      )
      .all() as Array<{ event_type: string; reason_code: string; metadata_json: string }>;
    expect(timeoutAuditRows).toHaveLength(1);
    const timeoutAudit = timeoutAuditRows[0];
    expect(timeoutAudit).toBeDefined();
    expect(JSON.parse(timeoutAudit!.metadata_json)).toMatchObject({ dealId });

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

  it("supports address correction request/approval flow with audited metadata", async () => {
    const smsProvider = new TestSmsProvider();
    const dbClient = createDatabaseClient(":memory:");
    const app = await buildServer({
      config: buildTestConfig(),
      smsProvider,
      muxClient: buildMockMuxClient(),
      dbClient
    });

    const seller = await createAuthenticatedSeller(app, smsProvider, dbClient, "+14155550161");
    const buyer = await createAuthenticatedBuyer(app, smsProvider, "+14155550162");

    const openSession = await app.inject({
      method: "POST",
      url: "/v1/seller/sessions/open",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(openSession.statusCode).toBe(200);

    const listing = await app.inject({
      method: "POST",
      url: "/v1/listings",
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      },
      payload: {
        title: "Address correction listing",
        listedPriceCents: 5000
      }
    });
    expect(listing.statusCode).toBe(200);
    const listingId = listing.json().listing.id as string;

    const offerResponse = await app.inject({
      method: "POST",
      url: `/v1/listings/${listingId}/offers`,
      headers: {
        authorization: `Bearer ${buyer}`
      },
      payload: {
        amountCents: 5100,
        shippingAddress: "Old Shipping Address 1"
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

    const requestCorrection = await app.inject({
      method: "POST",
      url: `/v1/deals/${dealId}/address-corrections`,
      headers: {
        authorization: `Bearer ${buyer}`
      },
      payload: {
        shippingAddress: "New Shipping Address 9",
        reason: "Apartment number changed"
      }
    });
    expect(requestCorrection.statusCode).toBe(200);
    const correctionId = requestCorrection.json().correction.id as string;
    expect(requestCorrection.json().deal).toMatchObject({
      activeShippingAddress: "Old Shipping Address 1",
      addressCorrection: {
        latestCorrectionId: correctionId,
        latestStatus: "pending",
        pendingCount: 1
      }
    });

    const approveCorrection = await app.inject({
      method: "POST",
      url: `/v1/deals/${dealId}/address-corrections/${correctionId}/approve`,
      headers: {
        authorization: `Bearer ${seller.accessToken}`
      }
    });
    expect(approveCorrection.statusCode).toBe(200);
    expect(approveCorrection.json().deal).toMatchObject({
      activeShippingAddress: "New Shipping Address 9",
      addressCorrection: {
        latestCorrectionId: correctionId,
        latestStatus: "approved",
        pendingCount: 0
      }
    });

    const dealRows = await app.inject({
      method: "GET",
      url: "/v1/deals/me",
      headers: {
        authorization: `Bearer ${buyer}`
      }
    });
    expect(dealRows.statusCode).toBe(200);
    expect(dealRows.json().deals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: dealId,
          activeShippingAddress: "New Shipping Address 9",
          addressCorrection: expect.objectContaining({
            latestCorrectionId: correctionId,
            latestStatus: "approved"
          })
        })
      ])
    );

    const auditRows = dbClient.sqlite
      .prepare(
        `
          SELECT reason_code, metadata_json
          FROM audit_events
          WHERE event_type = 'deal_address_correction'
          ORDER BY created_at ASC
        `
      )
      .all() as Array<{ reason_code: string; metadata_json: string }>;
    expect(auditRows.map((row) => row.reason_code)).toEqual([
      "deal_address_correction_requested",
      "deal_address_correction_approved"
    ]);
    expect(auditRows[0]?.metadata_json).not.toContain("New Shipping Address 9");

    await app.close();
  });
});
