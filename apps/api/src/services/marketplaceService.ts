import type { Database } from "better-sqlite3";
import type {
  BasketItem,
  Deal,
  MarketSession,
  MarketSessionStatus,
  Offer
} from "@antique/types";
import { AuthError } from "../auth/errors.js";
import { newId } from "../auth/crypto.js";
import type {
  ListingMutationDomainService,
  MarketSessionDomainService
} from "../domain/marketplace/contracts.js";

type ListingStatus = "live" | "day_closed" | "sold" | "withdrawn";

interface MarketSessionRow {
  id: string;
  seller_user_id: string;
  status: MarketSessionStatus;
  opened_at: number;
  closed_at: number | null;
  created_at: number;
  updated_at: number;
}

interface ListingAvailabilityRow {
  id: string;
  status: ListingStatus;
  session_status: MarketSessionStatus;
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

export class MarketplaceService
  implements MarketSessionDomainService, ListingMutationDomainService
{
  constructor(
    private readonly sqlite: Database,
    private readonly now: () => number = () => Date.now()
  ) {}

  openMarketSession(sellerUserId: string): MarketSession {
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
    this.sqlite
      .prepare(
        `
          INSERT INTO market_sessions (
            id,
            seller_user_id,
            status,
            opened_at,
            closed_at,
            created_at,
            updated_at
          )
          VALUES (?, ?, 'open', ?, NULL, ?, ?)
        `
      )
      .run(id, sellerUserId, timestamp, timestamp, timestamp);

    const row = this.sqlite
      .prepare("SELECT * FROM market_sessions WHERE id = ? LIMIT 1")
      .get(id) as MarketSessionRow;

    return toMarketSession(row);
  }

  closeMarketSession(params: {
    sellerUserId: string;
    sessionId: string;
  }): { session: MarketSession; transitionedListingCount: number } {
    const session = this.sqlite
      .prepare("SELECT * FROM market_sessions WHERE id = ? LIMIT 1")
      .get(params.sessionId) as MarketSessionRow | undefined;

    if (!session) {
      throw new AuthError("market_session_not_found", "Market session was not found", 404);
    }
    if (session.seller_user_id !== params.sellerUserId) {
      throw new AuthError("forbidden_owner_mismatch", "Market session does not belong to user", 403);
    }
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

  createBasketItem(params: { buyerUserId: string; listingId: string }): BasketItem {
    this.assertListingAllowsBuyerMutation(params.listingId);
    const id = newId();
    const timestamp = this.now();
    this.sqlite
      .prepare(
        `
          INSERT INTO basket_items (id, listing_id, buyer_user_id, created_at)
          VALUES (?, ?, ?, ?)
        `
      )
      .run(id, params.listingId, params.buyerUserId, timestamp);

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
  }): Offer {
    this.assertListingAllowsBuyerMutation(params.listingId);
    const id = newId();
    const timestamp = this.now();
    this.sqlite
      .prepare(
        `
          INSERT INTO offers (
            id,
            listing_id,
            buyer_user_id,
            amount_cents,
            shipping_address,
            status,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, 'submitted', ?)
        `
      )
      .run(id, params.listingId, params.buyerUserId, params.amountCents, params.shippingAddress, timestamp);

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
    this.assertListingOwnedBySeller(params.listingId, params.sellerUserId);
    const rows = this.sqlite
      .prepare(
        `
          SELECT id, listing_id, buyer_user_id, amount_cents, shipping_address, status, created_at
          FROM offers
          WHERE listing_id = ?
          ORDER BY created_at DESC, id DESC
        `
      )
      .all(params.listingId) as OfferRow[];

    return rows.map((row) => toOffer(row));
  }

  acceptOffer(params: {
    sellerUserId: string;
    offerId: string;
  }): { offer: Offer; deal: Deal; autoDeclinedCount: number } {
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

    return tx(params.sellerUserId, params.offerId, nowTs);
  }

  declineOffer(params: { sellerUserId: string; offerId: string }): Offer {
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

    return tx(params.sellerUserId, params.offerId);
  }

  private assertListingAllowsBuyerMutation(listingId: string): void {
    const row = this.sqlite
      .prepare(
        `
          SELECT
            listings.id,
            listings.status,
            market_sessions.status AS session_status
          FROM listings
          INNER JOIN market_sessions ON market_sessions.id = listings.market_session_id
          WHERE listings.id = ?
          LIMIT 1
        `
      )
      .get(listingId) as ListingAvailabilityRow | undefined;

    if (!row) {
      throw new AuthError("listing_not_found", "Listing was not found", 404);
    }
    if (row.status === "day_closed" || row.session_status === "closed") {
      throw new AuthError("listing_day_closed", "Listing is not accepting basket or offer mutations", 409);
    }
    if (row.status === "sold" || row.status === "withdrawn") {
      throw new AuthError("listing_unavailable", "Listing is no longer available", 409);
    }
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
  }
}
