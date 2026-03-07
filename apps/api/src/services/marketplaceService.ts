import type { Database } from "better-sqlite3";
import type {
  BasketItem,
  Deal,
  Listing,
  ListingStatus,
  MarketSession,
  MarketSessionStatus,
  Offer
} from "@antique/types";
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
  created_at: number;
  updated_at: number;
}

export interface MarketplaceRuntimeConfig {
  offerSubmitPerUserPerHour: number;
  offerDecisionPerSellerPerHour: number;
}

const DEFAULT_RUNTIME_CONFIG: MarketplaceRuntimeConfig = {
  offerSubmitPerUserPerHour: 30,
  offerDecisionPerSellerPerHour: 120
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
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
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
      params.offeredAmountCents < row.listed_price_cents
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
            created_at,
            updated_at
          FROM deals
          WHERE listing_id = ?
          LIMIT 1
        `
      )
      .get(listingId) as DealRow | undefined;
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
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)
        `
      )
      .run(
        id,
        params.listingId,
        params.offerId,
        params.sellerUserId,
        params.buyerUserId,
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
