import type { Database } from "better-sqlite3";
import type {
  BasketItem,
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
}
