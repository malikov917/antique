import type { Database } from "better-sqlite3";
import type { BasketItem, Listing, ListingStatus, MarketSessionStatus, Offer } from "@antique/types";
import { MIN_OFFER_RULE } from "@antique/types";
import { newId } from "../../auth/crypto.js";
import { AuthError } from "../../auth/errors.js";
import { requireTenantScope } from "../../auth/guards.js";
import type {
  CreateBasketItemInput,
  CreateListingInput,
  CreateOfferInput,
  ListingMutationDomainService,
  UpdateListingInput
} from "../../domain/marketplace/contracts.js";

export interface ListingMutationRuntimeConfig {
  offerSubmitPerUserPerHour: number;
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

function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString();
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

export class SqliteListingMutationDomainService implements ListingMutationDomainService {
  constructor(
    private readonly sqlite: Database,
    private readonly runtimeConfig: ListingMutationRuntimeConfig,
    private readonly now: () => number = () => Date.now()
  ) {}

  createListing(params: CreateListingInput): Listing {
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

  updateListing(params: UpdateListingInput): Listing {
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

  createBasketItem(params: CreateBasketItemInput): BasketItem {
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

  createOffer(params: CreateOfferInput): Offer {
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
