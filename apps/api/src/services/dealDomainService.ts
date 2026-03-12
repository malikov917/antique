import type { Database } from "better-sqlite3";
import type {
  Deal,
  DealStatus,
  ListingStatus,
  MarketSessionStatus,
  Offer
} from "@antique/types";
import { isDealStatusTransitionAllowed } from "@antique/types";
import { newId } from "../auth/crypto.js";
import { AuthError } from "../auth/errors.js";
import { requireTenantScope } from "../auth/guards.js";
import type { DealDomainService } from "../domain/marketplace/contracts.js";

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
  created_at: number;
  updated_at: number;
}

interface DealParticipantRow extends DealRow {
  tenant_id: string | null;
}

export interface DealDomainRuntimeConfig {
  offerDecisionPerSellerPerHour: number;
}

function toIso(timestamp: number): string {
  return new Date(timestamp).toISOString();
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
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

export class SqliteDealDomainService implements DealDomainService {
  constructor(
    private readonly sqlite: Database,
    private readonly runtimeConfig: DealDomainRuntimeConfig,
    private readonly now: () => number = () => Date.now()
  ) {}

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
            status,
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
