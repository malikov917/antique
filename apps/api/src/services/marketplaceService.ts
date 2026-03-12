import type { Database } from "better-sqlite3";
import type {
  BasketItem,
  Chat,
  ChatMessage,
  Deal,
  DealStatus,
  Listing,
  ListingStatus,
  MarketSession,
  MarketSessionStatus,
  Offer
} from "@antique/types";
import { MIN_OFFER_RULE, isDealStatusTransitionAllowed } from "@antique/types";
import { AuthError } from "../auth/errors.js";
import { requireTenantScope } from "../auth/guards.js";
import { newId } from "../auth/crypto.js";
import type {
  ListingMutationDomainService,
  MarketSessionDomainService
} from "../domain/marketplace/contracts.js";

interface MarketSessionRow {
  id: string;
  seller_user_id: string;
  tenant_id: string | null;
  status: MarketSessionStatus;
  opened_at: number;
  closed_at: number | null;
  created_at: number;
  updated_at: number;
}

interface ListingAvailabilityRow {
  id: string;
  seller_user_id: string;
  tenant_id: string | null;
  status: ListingStatus;
  session_status: MarketSessionStatus;
  listed_price_cents: number;
}

interface ListingRow {
  id: string;
  seller_user_id: string;
  market_session_id: string;
  status: ListingStatus;
  title: string;
  description: string;
  listed_price_cents: number;
  currency: string;
  created_at: number;
  updated_at: number;
}

interface OfferRow {
  id: string;
  listing_id: string;
  buyer_user_id: string;
  amount_cents: number;
  shipping_address: string;
  status: "submitted" | "accepted" | "declined";
  created_at: number;
}

interface OfferContextRow extends OfferRow {
  seller_user_id: string;
  listing_status: ListingStatus;
  session_status: MarketSessionStatus;
}

interface DealRow {
  id: string;
  listing_id: string;
  accepted_offer_id: string;
  seller_user_id: string;
  buyer_user_id: string;
  status: DealStatus;
  payment_due_at: number;
  payment_overdue_at: number | null;
  payment_extended_at: number | null;
  payment_timeout_reason: string | null;
  created_at: number;
  updated_at: number;
}

interface DealParticipantRow extends DealRow {
  tenant_id: string | null;
}

interface ChatRow {
  id: string;
  deal_id: string;
  listing_id: string;
  seller_user_id: string;
  buyer_user_id: string;
  tenant_id: string | null;
  created_at: number;
  updated_at: number;
}

interface ChatMessageRow {
  id: string;
  chat_id: string;
  sender_user_id: string;
  body: string;
  created_at: number;
}
export interface MarketplaceRuntimeConfig {
  offerSubmitPerUserPerHour: number;
  offerDecisionPerSellerPerHour: number;
  dealPaymentDueAfterMs: number;
}

const DEFAULT_RUNTIME_CONFIG: MarketplaceRuntimeConfig = {
  offerSubmitPerUserPerHour: 30,
  offerDecisionPerSellerPerHour: 120,
  dealPaymentDueAfterMs: 48 * 60 * 60 * 1000
};

function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function toMarketSession(row: MarketSessionRow): MarketSession {
  return {
    id: row.id,
    sellerUserId: row.seller_user_id,
    status: row.status,
    openedAt: toIso(row.opened_at),
    closedAt: row.closed_at === null ? null : toIso(row.closed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function toOffer(row: OfferRow): Offer {
  return {
    id: row.id,
    listingId: row.listing_id,
    buyerUserId: row.buyer_user_id,
    amountCents: row.amount_cents,
    shippingAddress: row.shipping_address,
    status: row.status,
    createdAt: toIso(row.created_at)
  };
}

function toDeal(row: DealRow): Deal {
  return {
    id: row.id,
    listingId: row.listing_id,
    acceptedOfferId: row.accepted_offer_id,
    sellerUserId: row.seller_user_id,
    buyerUserId: row.buyer_user_id,
    status: row.status,
    paymentDueAt: toIso(row.payment_due_at),
    paymentOverdueAt: row.payment_overdue_at === null ? null : toIso(row.payment_overdue_at),
    paymentExtendedAt: row.payment_extended_at === null ? null : toIso(row.payment_extended_at),
    paymentTimeoutReason: row.payment_timeout_reason,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function toChat(row: ChatRow): Chat {
  return {
    id: row.id,
    dealId: row.deal_id,
    listingId: row.listing_id,
    sellerUserId: row.seller_user_id,
    buyerUserId: row.buyer_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function toChatMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    chatId: row.chat_id,
    senderUserId: row.sender_user_id,
    text: row.body,
    createdAt: toIso(row.created_at)
  };
}

export interface PaymentOverdueSweepResult {
  transitionedDealCount: number;
  oldestDueOpenDealAgeMs: number | null;
  overdueOpenDealCount: number;
}
function toListing(row: ListingRow): Listing {
  return {
    id: row.id,
    sellerUserId: row.seller_user_id,
    marketSessionId: row.market_session_id,
    status: row.status,
    title: row.title,
    description: row.description,
    listedPriceCents: row.listed_price_cents,
    currency: row.currency,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

export class MarketplaceService
  implements MarketSessionDomainService, ListingMutationDomainService
{
  constructor(
    private readonly sqlite: Database,
    runtimeConfig: MarketplaceRuntimeConfig = DEFAULT_RUNTIME_CONFIG,
    private readonly now: () => number = () => Date.now()
  ) {
    this.runtimeConfig = runtimeConfig;
  }

  private readonly runtimeConfig: MarketplaceRuntimeConfig;

  openMarketSession(sellerUserId: string): MarketSession {
    this.assertSellerNotSuspended(sellerUserId);
    const existing = this.sqlite
      .prepare(
        `
          SELECT id
          FROM market_sessions
          WHERE seller_user_id = ?
            AND status = 'open'
          LIMIT 1
        `
      )
      .get(sellerUserId) as { id: string } | undefined;

    if (existing) {
      throw new AuthError("market_session_already_open", "Seller already has an open market session", 409);
    }

    const timestamp = this.now();
    const id = newId();
    const sellerTenantId = this.resolveUserTenantId(sellerUserId);
    this.sqlite
      .prepare(
        `
          INSERT INTO market_sessions (
            id,
            seller_user_id,
            tenant_id,
            status,
            opened_at,
            closed_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, 'open', ?, NULL, ?, ?)
        `
      )
      .run(id, sellerUserId, sellerTenantId, timestamp, timestamp, timestamp);

    const row = this.sqlite
      .prepare("SELECT * FROM market_sessions WHERE id = ? LIMIT 1")
      .get(id) as MarketSessionRow;

    return toMarketSession(row);
  }

  closeMarketSession(params: {
    sellerUserId: string;
    sessionId: string;
  }): { session: MarketSession; transitionedListingCount: number } {
    this.assertSellerNotSuspended(params.sellerUserId);
    const sellerTenantId = this.resolveUserTenantId(params.sellerUserId);
    const session = this.sqlite
      .prepare("SELECT * FROM market_sessions WHERE id = ? LIMIT 1")
      .get(params.sessionId) as MarketSessionRow | undefined;

    if (!session) {
      throw new AuthError("market_session_not_found", "Market session was not found", 404);
    }
    if (session.seller_user_id !== params.sellerUserId) {
      throw new AuthError("forbidden_owner_mismatch", "Market session does not belong to user", 403);
    }
    if (!session.tenant_id) {
      throw new AuthError("forbidden_tenant_scope", "Market session tenant could not be resolved", 403);
    }
    requireTenantScope(session.tenant_id, sellerTenantId);
    if (session.status !== "open") {
      throw new AuthError("market_session_not_open", "Market session is already closed", 409);
    }

    const timestamp = this.now();
    const tx = this.sqlite.transaction(
      (sessionId: string, nowTs: number): { transitionedListingCount: number } => {
        const listingResult = this.sqlite
          .prepare(
            `
              UPDATE listings
              SET status = 'day_closed',
                  updated_at = ?
              WHERE market_session_id = ?
                AND status = 'live'
            `
          )
          .run(nowTs, sessionId);

        this.sqlite
          .prepare(
            `
              UPDATE market_sessions
              SET status = 'closed',
                  closed_at = ?,
                  updated_at = ?
              WHERE id = ?
            `
          )
          .run(nowTs, nowTs, sessionId);

        return {
          transitionedListingCount: listingResult.changes
        };
      }
    );

    const result = tx(params.sessionId, timestamp);
    const updatedSession = this.sqlite
      .prepare("SELECT * FROM market_sessions WHERE id = ? LIMIT 1")
      .get(params.sessionId) as MarketSessionRow;

    return {
      session: toMarketSession(updatedSession),
      transitionedListingCount: result.transitionedListingCount
    };
  }

  createListing(params: {
    sellerUserId: string;
    title: string;
    description: string;
    listedPriceCents: number;
    currency: string;
  }): Listing {
    const session = this.requireOpenSessionForSeller(params.sellerUserId);
    const timestamp = this.now();
    const id = newId();
    this.sqlite
      .prepare(
        `
          INSERT INTO listings (
            id,
            seller_user_id,
            market_session_id,
            tenant_id,
            status,
            title,
            description,
            listed_price_cents,
            currency,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, 'live', ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        params.sellerUserId,
        session.id,
        session.tenant_id ?? this.resolveUserTenantId(params.sellerUserId),
        params.title,
        params.description,
        params.listedPriceCents,
        params.currency,
        timestamp,
        timestamp
      );

    const row = this.sqlite
      .prepare("SELECT * FROM listings WHERE id = ? LIMIT 1")
      .get(id) as ListingRow;
    return toListing(row);
  }

  updateListing(params: {
    sellerUserId: string;
    listingId: string;
    title?: string;
    description?: string;
    listedPriceCents?: number;
    currency?: string;
  }): Listing {
    const listing = this.sqlite
      .prepare(
        `
          SELECT *
          FROM listings
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(params.listingId) as ListingRow | undefined;

    if (!listing) {
      throw new AuthError("listing_not_found", "Listing was not found", 404);
    }
    if (listing.seller_user_id !== params.sellerUserId) {
      throw new AuthError("forbidden_owner_mismatch", "Listing does not belong to seller", 403);
    }

    this.requireOpenSessionForSeller(params.sellerUserId);

    if (listing.status !== "live") {
      throw new AuthError("listing_unavailable", "Listing cannot be updated in current state", 409);
    }

    const nextTitle = params.title ?? listing.title;
    const nextDescription = params.description ?? listing.description;
    const nextListedPriceCents = params.listedPriceCents ?? listing.listed_price_cents;
    const nextCurrency = params.currency ?? listing.currency;
    const timestamp = this.now();

    this.sqlite
      .prepare(
        `
          UPDATE listings
          SET title = ?,
              description = ?,
              listed_price_cents = ?,
              currency = ?,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        nextTitle,
        nextDescription,
        nextListedPriceCents,
        nextCurrency,
        timestamp,
        params.listingId
      );

    const row = this.sqlite
      .prepare("SELECT * FROM listings WHERE id = ? LIMIT 1")
      .get(params.listingId) as ListingRow;
    return toListing(row);
  }

  createBasketItem(params: { buyerUserId: string; listingId: string }): BasketItem {
    const tenantId = this.assertListingAllowsBuyerMutation({
      listingId: params.listingId,
      buyerUserId: params.buyerUserId
    });
    const id = newId();
    const timestamp = this.now();
    this.sqlite
      .prepare(
        `
          INSERT INTO basket_items (id, listing_id, buyer_user_id, tenant_id, created_at)
          VALUES (?, ?, ?, ?, ?)
        `
      )
      .run(id, params.listingId, params.buyerUserId, tenantId, timestamp);

    return {
      id,
      listingId: params.listingId,
      buyerUserId: params.buyerUserId,
      createdAt: toIso(timestamp)
    };
  }

  createOffer(params: {
    buyerUserId: string;
    listingId: string;
    amountCents: number;
    shippingAddress: string;
    requestIp?: string;
  }): Offer {
    const tenantId = this.assertListingAllowsBuyerMutation({
      listingId: params.listingId,
      buyerUserId: params.buyerUserId,
      offeredAmountCents: params.amountCents
    });
    this.assertOfferRateLimit(
      params.buyerUserId,
      "submit",
      this.runtimeConfig.offerSubmitPerUserPerHour
    );
    const id = newId();
    const timestamp = this.now();
    this.sqlite
      .prepare(
        `
          INSERT INTO offers (
            id,
            listing_id,
            buyer_user_id,
            tenant_id,
            amount_cents,
            shipping_address,
            status,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?)
        `
      )
      .run(
        id,
        params.listingId,
        params.buyerUserId,
        tenantId,
        params.amountCents,
        params.shippingAddress,
        timestamp
      );

    this.recordOfferAction({
      actorUserId: params.buyerUserId,
      actorRole: "buyer",
      reasonCode: "submit",
      requestIp: params.requestIp ?? null,
      metadata: { listingId: params.listingId, offerId: id }
    });

    return {
      id,
      listingId: params.listingId,
      buyerUserId: params.buyerUserId,
      amountCents: params.amountCents,
      shippingAddress: params.shippingAddress,
      status: "submitted",
      createdAt: toIso(timestamp)
    };
  }

  listSellerListingOffers(params: { sellerUserId: string; listingId: string }): Offer[] {
    this.assertSellerNotSuspended(params.sellerUserId);
    this.assertListingOwnedBySeller(params.listingId, params.sellerUserId);
    const sellerTenantId = this.resolveUserTenantId(params.sellerUserId);
    const rows = this.sqlite
      .prepare(
        `
          SELECT id, listing_id, buyer_user_id, amount_cents, shipping_address, status, created_at
          FROM offers
          WHERE listing_id = ?
            AND tenant_id = ?
          ORDER BY created_at DESC, id DESC
        `
      )
      .all(params.listingId, sellerTenantId) as OfferRow[];

    return rows.map((row) => toOffer(row));
  }

  listDealsForUser(params: { userId: string }): Deal[] {
    const tenantId = this.resolveUserTenantId(params.userId);
    const rows = this.sqlite
      .prepare(
        `
          SELECT
            deals.id,
            deals.listing_id,
            deals.accepted_offer_id,
            deals.seller_user_id,
            deals.buyer_user_id,
            deals.status,
            deals.payment_due_at,
            deals.payment_overdue_at,
            deals.payment_extended_at,
            deals.payment_timeout_reason,
            deals.created_at,
            deals.updated_at
          FROM deals
          INNER JOIN listings ON listings.id = deals.listing_id
          WHERE (deals.seller_user_id = ? OR deals.buyer_user_id = ?)
            AND listings.tenant_id = ?
          ORDER BY deals.updated_at DESC, deals.id DESC
        `
      )
      .all(params.userId, params.userId, tenantId) as DealRow[];

    return rows.map((row) => toDeal(row));
  }

  updateDealStatus(params: {
    userId: string;
    dealId: string;
    status: "paid" | "completed" | "canceled";
  }): Deal {
    const timestamp = this.now();
    const tx = this.sqlite.transaction((userId: string, dealId: string, nextStatus: DealStatus): Deal => {
      const context = this.getDealParticipantContext(dealId);
      if (!context) {
        throw new AuthError("deal_not_found", "Deal was not found", 404);
      }
      this.assertUserCanAccessDeal(context, userId);
      this.assertDealStatusTransitionAllowed(context.status, nextStatus);

      if (context.status !== nextStatus) {
        this.sqlite
          .prepare("UPDATE deals SET status = ?, updated_at = ? WHERE id = ?")
          .run(nextStatus, timestamp, dealId);
      }

      const updated = this.getDealById(dealId);
      if (!updated) {
        throw new AuthError("deal_not_found", "Deal was not found", 404);
      }
      return toDeal(updated);
    });

    return tx(params.userId, params.dealId, params.status);
  }

  runPaymentOverdueSweep(): PaymentOverdueSweepResult {
    const nowTs = this.now();
    const tx = this.sqlite.transaction(
      (timestamp: number): { transitionedDealIds: string[] } => {
        const dueRows = this.sqlite
          .prepare(
            `
              SELECT id
              FROM deals
              WHERE status = 'open'
                AND payment_due_at <= ?
              ORDER BY payment_due_at ASC
            `
          )
          .all(timestamp) as Array<{ id: string }>;

        if (dueRows.length === 0) {
          return { transitionedDealIds: [] };
        }

        this.sqlite
          .prepare(
            `
              UPDATE deals
              SET status = 'payment_overdue',
                  payment_overdue_at = ?,
                  payment_timeout_reason = 'payment_deadline_elapsed',
                  updated_at = ?
              WHERE status = 'open'
                AND payment_due_at <= ?
            `
          )
          .run(timestamp, timestamp, timestamp);

        return {
          transitionedDealIds: dueRows.map((row) => row.id)
        };
      }
    );

    const result = tx(nowTs);
    for (const dealId of result.transitionedDealIds) {
      this.recordDealPaymentTimeoutAudit({
        dealId,
        timeoutAtMs: nowTs
      });
    }

    return {
      transitionedDealCount: result.transitionedDealIds.length,
      ...this.getPaymentOverdueMetrics()
    };
  }

  getPaymentOverdueMetrics(): {
    oldestDueOpenDealAgeMs: number | null;
    overdueOpenDealCount: number;
  } {
    const nowTs = this.now();
    const overdueCountRow = this.sqlite
      .prepare(
        `
          SELECT COUNT(1) AS count
          FROM deals
          WHERE status = 'open'
            AND payment_due_at <= ?
        `
      )
      .get(nowTs) as { count: number } | undefined;
    const oldestDueRow = this.sqlite
      .prepare(
        `
          SELECT MIN(payment_due_at) AS oldest_due_at
          FROM deals
          WHERE status = 'open'
            AND payment_due_at <= ?
        `
      )
      .get(nowTs) as { oldest_due_at: number | null } | undefined;

    return {
      overdueOpenDealCount: overdueCountRow?.count ?? 0,
      oldestDueOpenDealAgeMs:
        oldestDueRow?.oldest_due_at === null || oldestDueRow?.oldest_due_at === undefined
          ? null
          : Math.max(0, nowTs - oldestDueRow.oldest_due_at)
    };
  }

  listChatsForUser(params: { userId: string }): Chat[] {
    const tenantId = this.resolveUserTenantId(params.userId);
    const rows = this.sqlite
      .prepare(
        `
          SELECT
            id,
            deal_id,
            listing_id,
            seller_user_id,
            buyer_user_id,
            tenant_id,
            created_at,
            updated_at
          FROM chats
          WHERE (seller_user_id = ? OR buyer_user_id = ?)
            AND tenant_id = ?
          ORDER BY updated_at DESC, id DESC
        `
      )
      .all(params.userId, params.userId, tenantId) as ChatRow[];

    return rows.map((row) => toChat(row));
  }

  listChatMessages(params: { userId: string; chatId: string }): ChatMessage[] {
    this.assertUserCanAccessChat(params.chatId, params.userId);
    const rows = this.sqlite
      .prepare(
        `
          SELECT id, chat_id, sender_user_id, body, created_at
          FROM chat_messages
          WHERE chat_id = ?
          ORDER BY created_at ASC, id ASC
        `
      )
      .all(params.chatId) as ChatMessageRow[];

    return rows.map((row) => toChatMessage(row));
  }

  createChatMessage(params: { userId: string; chatId: string; text: string }): ChatMessage {
    this.assertUserCanAccessChat(params.chatId, params.userId);
    const id = newId();
    const timestamp = this.now();
    this.sqlite
      .prepare(
        `
          INSERT INTO chat_messages (id, chat_id, sender_user_id, tenant_id, body, created_at)
          VALUES (
            ?,
            ?,
            ?,
            (SELECT tenant_id FROM chats WHERE id = ?),
            ?,
            ?
          )
        `
      )
      .run(id, params.chatId, params.userId, params.chatId, params.text, timestamp);
    this.sqlite
      .prepare("UPDATE chats SET updated_at = ? WHERE id = ?")
      .run(timestamp, params.chatId);

    const row = this.sqlite
      .prepare(
        `
          SELECT id, chat_id, sender_user_id, body, created_at
          FROM chat_messages
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(id) as ChatMessageRow;
    return toChatMessage(row);
  }

  acceptOffer(params: {
    sellerUserId: string;
    offerId: string;
    requestIp?: string;
  }): { offer: Offer; deal: Deal; autoDeclinedCount: number } {
    this.assertSellerNotSuspended(params.sellerUserId);
    this.assertOfferRateLimit(
      params.sellerUserId,
      "decision",
      this.runtimeConfig.offerDecisionPerSellerPerHour
    );
    const nowTs = this.now();
    const tx = this.sqlite.transaction(
      (
        sellerUserId: string,
        offerId: string,
        timestamp: number
      ): { offer: Offer; deal: Deal; autoDeclinedCount: number } => {
        const context = this.getOfferContext(offerId);
        if (!context) {
          throw new AuthError("offer_not_found", "Offer was not found", 404);
        }
        if (context.seller_user_id !== sellerUserId) {
          throw new AuthError("forbidden_owner_mismatch", "Offer does not belong to seller", 403);
        }
        this.assertListingCanBeDecided(context);

        const existingDeal = this.findDealByListingId(context.listing_id);
        if (existingDeal && existingDeal.accepted_offer_id !== offerId) {
          throw new AuthError(
            "offer_already_selected",
            "Another offer has already been accepted for this listing",
            409
          );
        }
        if (context.status === "declined") {
          throw new AuthError("offer_not_actionable", "Declined offers cannot be accepted", 409);
        }

        if (context.status === "submitted") {
          this.sqlite
            .prepare("UPDATE offers SET status = 'accepted' WHERE id = ? AND status = 'submitted'")
            .run(offerId);
        }

        const offerRow = this.sqlite
          .prepare(
            `
              SELECT id, listing_id, buyer_user_id, amount_cents, shipping_address, status, created_at
              FROM offers
              WHERE id = ?
              LIMIT 1
            `
          )
          .get(offerId) as OfferRow | undefined;
        if (!offerRow || offerRow.status !== "accepted") {
          throw new AuthError("offer_not_actionable", "Offer cannot be accepted", 409);
        }

        let autoDeclinedCount = 0;
        if (context.status === "submitted") {
          autoDeclinedCount = this.sqlite
            .prepare(
              `
                UPDATE offers
                SET status = 'declined'
                WHERE listing_id = ?
                  AND id <> ?
                  AND status = 'submitted'
              `
            )
            .run(context.listing_id, offerId).changes;
        }

        this.sqlite
          .prepare("UPDATE listings SET status = 'sold', updated_at = ? WHERE id = ?")
          .run(timestamp, context.listing_id);

        const deal = this.ensureDeal({
          listingId: context.listing_id,
          offerId,
          sellerUserId: context.seller_user_id,
          buyerUserId: offerRow.buyer_user_id,
          nowTs: timestamp
        });
        this.ensureChatForDeal(deal, context.listing_id, timestamp);

        return {
          offer: toOffer(offerRow),
          deal,
          autoDeclinedCount
        };
      }
    );
    const result = tx(params.sellerUserId, params.offerId, nowTs);
    this.recordOfferAction({
      actorUserId: params.sellerUserId,
      actorRole: "seller",
      reasonCode: "decision",
      requestIp: params.requestIp ?? null,
      metadata: { offerId: params.offerId, action: "accept" }
    });
    return result;
  }

  declineOffer(params: { sellerUserId: string; offerId: string; requestIp?: string }): Offer {
    this.assertSellerNotSuspended(params.sellerUserId);
    this.assertOfferRateLimit(
      params.sellerUserId,
      "decision",
      this.runtimeConfig.offerDecisionPerSellerPerHour
    );
    const tx = this.sqlite.transaction((sellerUserId: string, offerId: string): Offer => {
      const context = this.getOfferContext(offerId);
      if (!context) {
        throw new AuthError("offer_not_found", "Offer was not found", 404);
      }
      if (context.seller_user_id !== sellerUserId) {
        throw new AuthError("forbidden_owner_mismatch", "Offer does not belong to seller", 403);
      }
      this.assertListingCanBeDecided(context);

      if (context.status === "accepted") {
        throw new AuthError("offer_not_actionable", "Accepted offers cannot be declined", 409);
      }
      if (context.status === "declined") {
        return toOffer(context);
      }

      this.sqlite
        .prepare("UPDATE offers SET status = 'declined' WHERE id = ? AND status = 'submitted'")
        .run(offerId);
      const offerRow = this.sqlite
        .prepare(
          `
            SELECT id, listing_id, buyer_user_id, amount_cents, shipping_address, status, created_at
            FROM offers
            WHERE id = ?
            LIMIT 1
          `
        )
        .get(offerId) as OfferRow;
      return toOffer(offerRow);
    });
    const offer = tx(params.sellerUserId, params.offerId);
    this.recordOfferAction({
      actorUserId: params.sellerUserId,
      actorRole: "seller",
      reasonCode: "decision",
      requestIp: params.requestIp ?? null,
      metadata: { offerId: params.offerId, action: "decline" }
    });
    return offer;
  }
  private assertListingAllowsBuyerMutation(params: {
    listingId: string;
    buyerUserId: string;
    offeredAmountCents?: number;
  }): string {
    const row = this.sqlite
      .prepare(
        `
          SELECT
            listings.id,
            listings.seller_user_id,
            listings.tenant_id,
            listings.status,
            listings.listed_price_cents,
            market_sessions.status AS session_status
          FROM listings
          INNER JOIN market_sessions ON market_sessions.id = listings.market_session_id
          WHERE listings.id = ?
          LIMIT 1
        `
      )
      .get(params.listingId) as ListingAvailabilityRow | undefined;

    if (!row) {
      throw new AuthError("listing_not_found", "Listing was not found", 404);
    }
    if (row.status === "day_closed" || row.session_status === "closed") {
      throw new AuthError("listing_day_closed", "Listing is not accepting basket or offer mutations", 409);
    }
    if (row.status === "sold" || row.status === "withdrawn") {
      throw new AuthError("listing_unavailable", "Listing is no longer available", 409);
    }

    if (
      params.offeredAmountCents !== undefined &&
      !MIN_OFFER_RULE(params.offeredAmountCents, row.listed_price_cents)
    ) {
      throw new AuthError(
        "offer_below_listed_price",
        "Offer amount must be greater than or equal to listed price",
        409
      );
    }

    this.assertUsersCanInteract(params.buyerUserId, row.seller_user_id);
    const buyerTenantId = this.resolveUserTenantId(params.buyerUserId);
    if (!row.tenant_id) {
      throw new AuthError("forbidden_tenant_scope", "Listing tenant could not be resolved", 403);
    }
    requireTenantScope(row.tenant_id, buyerTenantId);
    return row.tenant_id;
  }

  private requireOpenSessionForSeller(sellerUserId: string): {
    id: string;
    tenant_id: string | null;
  } {
    const session = this.sqlite
      .prepare(
        `
          SELECT id, tenant_id
          FROM market_sessions
          WHERE seller_user_id = ?
            AND status = 'open'
          ORDER BY opened_at DESC
          LIMIT 1
        `
      )
      .get(sellerUserId) as { id: string; tenant_id: string | null } | undefined;

    if (!session) {
      throw new AuthError("market_session_not_open", "Seller must have an open market session", 409);
    }
    return session;
  }

  private assertListingOwnedBySeller(listingId: string, sellerUserId: string): void {
    const row = this.sqlite
      .prepare(
        `
          SELECT seller_user_id
          FROM listings
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(listingId) as { seller_user_id: string } | undefined;

    if (!row) {
      throw new AuthError("listing_not_found", "Listing was not found", 404);
    }
    if (row.seller_user_id !== sellerUserId) {
      throw new AuthError("forbidden_owner_mismatch", "Listing does not belong to seller", 403);
    }
  }

  private getOfferContext(offerId: string): OfferContextRow | undefined {
    return this.sqlite
      .prepare(
        `
          SELECT
            offers.id,
            offers.listing_id,
            offers.buyer_user_id,
            offers.amount_cents,
            offers.shipping_address,
            offers.status,
            offers.created_at,
            listings.seller_user_id,
            listings.status AS listing_status,
            market_sessions.status AS session_status
          FROM offers
          INNER JOIN listings ON listings.id = offers.listing_id
          INNER JOIN market_sessions ON market_sessions.id = listings.market_session_id
          WHERE offers.id = ?
          LIMIT 1
        `
      )
      .get(offerId) as OfferContextRow | undefined;
  }

  private findDealByListingId(listingId: string): DealRow | undefined {
    return this.sqlite
      .prepare(
        `
          SELECT
            id,
            listing_id,
            accepted_offer_id,
            seller_user_id,
            buyer_user_id,
            status,
            payment_due_at,
            payment_overdue_at,
            payment_extended_at,
            payment_timeout_reason,
            created_at,
            updated_at
          FROM deals
          WHERE listing_id = ?
          LIMIT 1
        `
      )
      .get(listingId) as DealRow | undefined;
  }

  private getDealById(dealId: string): DealRow | undefined {
    return this.sqlite
      .prepare(
        `
          SELECT
            id,
            listing_id,
            accepted_offer_id,
            seller_user_id,
            buyer_user_id,
            status,
            payment_due_at,
            payment_overdue_at,
            payment_extended_at,
            payment_timeout_reason,
            created_at,
            updated_at
          FROM deals
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(dealId) as DealRow | undefined;
  }

  private ensureDeal(params: {
    listingId: string;
    offerId: string;
    sellerUserId: string;
    buyerUserId: string;
    nowTs: number;
  }): Deal {
    const existing = this.findDealByListingId(params.listingId);
    if (existing) {
      if (existing.accepted_offer_id !== params.offerId) {
        throw new AuthError(
          "offer_already_selected",
          "Another offer has already been accepted for this listing",
          409
        );
      }
      return toDeal(existing);
    }

    const id = newId();
    this.sqlite
      .prepare(
        `
          INSERT INTO deals (
            id,
            listing_id,
            accepted_offer_id,
            seller_user_id,
            buyer_user_id,
            status,
            payment_due_at,
            payment_overdue_at,
            payment_extended_at,
            payment_timeout_reason,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, 'open', ?, NULL, NULL, NULL, ?, ?)
        `
      )
      .run(
        id,
        params.listingId,
        params.offerId,
        params.sellerUserId,
        params.buyerUserId,
        this.resolveInitialPaymentDueAt(params.nowTs),
        params.nowTs,
        params.nowTs
      );

    const created = this.sqlite
      .prepare(
        `
          SELECT
            id,
            listing_id,
            accepted_offer_id,
            seller_user_id,
            buyer_user_id,
            status,
            payment_due_at,
            payment_overdue_at,
            payment_extended_at,
            payment_timeout_reason,
            created_at,
            updated_at
          FROM deals
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(id) as DealRow;
    return toDeal(created);
  }

  private ensureChatForDeal(deal: Deal, listingId: string, timestamp: number): void {
    const existing = this.sqlite
      .prepare("SELECT id FROM chats WHERE deal_id = ? LIMIT 1")
      .get(deal.id) as { id: string } | undefined;
    if (existing) {
      return;
    }
    const tenantId = this.resolveListingTenantId(listingId);
    this.sqlite
      .prepare(
        `
          INSERT INTO chats (
            id,
            deal_id,
            listing_id,
            seller_user_id,
            buyer_user_id,
            tenant_id,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(newId(), deal.id, listingId, deal.sellerUserId, deal.buyerUserId, tenantId, timestamp, timestamp);
  }

  private getDealParticipantContext(dealId: string): DealParticipantRow | undefined {
    return this.sqlite
      .prepare(
        `
          SELECT
            deals.id,
            deals.listing_id,
            deals.accepted_offer_id,
            deals.seller_user_id,
            deals.buyer_user_id,
            deals.status,
            deals.payment_due_at,
            deals.payment_overdue_at,
            deals.payment_extended_at,
            deals.payment_timeout_reason,
            deals.created_at,
            deals.updated_at,
            listings.tenant_id
          FROM deals
          INNER JOIN listings ON listings.id = deals.listing_id
          WHERE deals.id = ?
          LIMIT 1
        `
      )
      .get(dealId) as DealParticipantRow | undefined;
  }

  private assertUserCanAccessDeal(deal: DealParticipantRow, userId: string): void {
    if (deal.seller_user_id !== userId && deal.buyer_user_id !== userId) {
      throw new AuthError("forbidden_owner_mismatch", "Deal does not belong to user", 403);
    }
    const actorTenantId = this.resolveUserTenantId(userId);
    if (!deal.tenant_id) {
      throw new AuthError("forbidden_tenant_scope", "Deal tenant could not be resolved", 403);
    }
    requireTenantScope(deal.tenant_id, actorTenantId);
  }

  private assertDealStatusTransitionAllowed(current: DealStatus, next: DealStatus): void {
    if (current === next) {
      return;
    }
    if (!isDealStatusTransitionAllowed(current, next)) {
      throw new AuthError("deal_invalid_status_transition", "Deal status transition is not allowed", 409);
    }
  }

  private getChatById(chatId: string): ChatRow | undefined {
    return this.sqlite
      .prepare(
        `
          SELECT
            id,
            deal_id,
            listing_id,
            seller_user_id,
            buyer_user_id,
            tenant_id,
            created_at,
            updated_at
          FROM chats
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(chatId) as ChatRow | undefined;
  }

  private assertUserCanAccessChat(chatId: string, userId: string): ChatRow {
    const chat = this.getChatById(chatId);
    if (!chat) {
      throw new AuthError("chat_not_found", "Chat was not found", 404);
    }
    if (chat.seller_user_id !== userId && chat.buyer_user_id !== userId) {
      throw new AuthError("forbidden_owner_mismatch", "Chat does not belong to user", 403);
    }
    const actorTenantId = this.resolveUserTenantId(userId);
    if (!chat.tenant_id) {
      throw new AuthError("forbidden_tenant_scope", "Chat tenant could not be resolved", 403);
    }
    requireTenantScope(chat.tenant_id, actorTenantId);
    return chat;
  }

  private resolveListingTenantId(listingId: string): string {
    const row = this.sqlite
      .prepare("SELECT tenant_id FROM listings WHERE id = ? LIMIT 1")
      .get(listingId) as { tenant_id: string } | undefined;
    if (!row?.tenant_id) {
      throw new AuthError("forbidden_tenant_scope", "Listing tenant could not be resolved", 403);
    }
    return row.tenant_id;
  }

  private assertListingCanBeDecided(context: OfferContextRow): void {
    if (context.listing_status === "withdrawn" || context.listing_status === "day_closed") {
      throw new AuthError(
        "listing_unavailable",
        "Listing is not in a state that allows offer decisions",
        409
      );
    }
    if (context.session_status !== "open" && context.listing_status !== "sold") {
      throw new AuthError(
        "listing_unavailable",
        "Listing is not in a state that allows offer decisions",
        409
      );
    }
    this.assertUsersCanInteract(context.buyer_user_id, context.seller_user_id);
  }
  private assertOfferRateLimit(actorUserId: string, reasonCode: "submit" | "decision", max: number): void {
    const hourAgo = this.now() - 60 * 60 * 1000;
    const row = this.sqlite
      .prepare(
        `
          SELECT COUNT(1) AS count
          FROM audit_events
          WHERE event_type = 'offer_action'
            AND actor_user_id = ?
            AND reason_code = ?
            AND created_at >= ?
        `
      )
      .get(actorUserId, reasonCode, hourAgo) as { count: number } | undefined;

    if ((row?.count ?? 0) >= max) {
      throw new AuthError(
        "offer_action_rate_limited",
        "Offer action rate limit exceeded",
        429,
        60
      );
    }
  }

  private recordOfferAction(params: {
    actorUserId: string;
    actorRole: "buyer" | "seller";
    reasonCode: "submit" | "decision";
    requestIp: string | null;
    metadata: Record<string, unknown>;
  }): void {
    this.sqlite
      .prepare(
        `
          INSERT INTO audit_events (
            id,
            event_type,
            actor_user_id,
            actor_role,
            target_seller_user_id,
            outcome,
            reason_code,
            request_ip,
            metadata_json,
            created_at
          ) VALUES (?, 'offer_action', ?, ?, NULL, 'allowed', ?, ?, ?, ?)
        `
      )
      .run(
        newId(),
        params.actorUserId,
        params.actorRole,
        params.reasonCode,
        params.requestIp,
        JSON.stringify(params.metadata),
        this.now()
      );
  }

  private recordDealPaymentTimeoutAudit(params: { dealId: string; timeoutAtMs: number }): void {
    this.sqlite
      .prepare(
        `
          INSERT INTO audit_events (
            id,
            event_type,
            actor_user_id,
            actor_role,
            target_seller_user_id,
            outcome,
            reason_code,
            request_ip,
            metadata_json,
            created_at
          ) VALUES (
            ?,
            'deal_payment_timeout',
            NULL,
            'system',
            (SELECT seller_user_id FROM deals WHERE id = ?),
            'allowed',
            'payment_deadline_elapsed',
            NULL,
            ?,
            ?
          )
        `
      )
      .run(
        newId(),
        params.dealId,
        JSON.stringify({ dealId: params.dealId }),
        params.timeoutAtMs
      );
  }

  private resolveInitialPaymentDueAt(createdAtMs: number): number {
    return createdAtMs + Math.max(1, this.runtimeConfig.dealPaymentDueAfterMs);
  }

  private assertUsersCanInteract(userAId: string, userBId: string): void {
    const row = this.sqlite
      .prepare(
        `
          SELECT id
          FROM user_blocks
          WHERE (blocker_user_id = ? AND blocked_user_id = ?)
             OR (blocker_user_id = ? AND blocked_user_id = ?)
          LIMIT 1
        `
      )
      .get(userAId, userBId, userBId, userAId) as { id: string } | undefined;

    if (row) {
      throw new AuthError("interaction_blocked", "Interaction is blocked between these users", 403);
    }
  }

  private assertSellerNotSuspended(sellerUserId: string): void {
    const row = this.sqlite
      .prepare(
        `
          SELECT suspended_at
          FROM users
          WHERE id = ?
          LIMIT 1
        `
      )
      .get(sellerUserId) as { suspended_at: number | null } | undefined;

    if (!row) {
      throw new AuthError("not_found", "User was not found", 404);
    }
    if (typeof row.suspended_at === "number") {
      throw new AuthError("seller_suspended", "Suspended sellers cannot perform seller actions", 403);
    }
  }

  private resolveUserTenantId(userId: string): string {
    const row = this.sqlite
      .prepare("SELECT tenant_id FROM users WHERE id = ? LIMIT 1")
      .get(userId) as { tenant_id: string } | undefined;

    if (!row?.tenant_id) {
      throw new AuthError("forbidden_tenant_scope", "User tenant could not be resolved", 403);
    }
    return row.tenant_id;
  }
}
