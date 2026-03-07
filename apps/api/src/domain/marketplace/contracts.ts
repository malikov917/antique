import type { BasketItem, Deal, Listing, MarketSession, Offer } from "@antique/types";

export interface CloseMarketSessionInput {
  sellerUserId: string;
  sessionId: string;
}

export interface CloseMarketSessionResult {
  session: MarketSession;
  transitionedListingCount: number;
}

export interface CreateBasketItemInput {
  buyerUserId: string;
  listingId: string;
}

export interface CreateOfferInput {
  buyerUserId: string;
  listingId: string;
  amountCents: number;
  shippingAddress: string;
  requestIp?: string;
}

export interface CreateListingInput {
  sellerUserId: string;
  title: string;
  description: string;
  listedPriceCents: number;
  currency: string;
}

export interface UpdateListingInput {
  sellerUserId: string;
  listingId: string;
  title?: string;
  description?: string;
  listedPriceCents?: number;
  currency?: string;
}

export interface MarketSessionDomainService {
  openMarketSession(sellerUserId: string): MarketSession;
  closeMarketSession(params: CloseMarketSessionInput): CloseMarketSessionResult;
}

export interface ListingMutationDomainService {
  createListing(params: CreateListingInput): Listing;
  updateListing(params: UpdateListingInput): Listing;
  createBasketItem(params: CreateBasketItemInput): BasketItem;
  createOffer(params: CreateOfferInput): Offer;
  listSellerListingOffers(params: { sellerUserId: string; listingId: string }): Offer[];
  acceptOffer(params: { sellerUserId: string; offerId: string; requestIp?: string }): {
    offer: Offer;
    deal: Deal;
    autoDeclinedCount: number;
  };
  declineOffer(params: { sellerUserId: string; offerId: string; requestIp?: string }): Offer;
}

// Forward contracts for upcoming P2-P4 extraction work.
export interface DealDomainService {
  acceptOffer(params: { sellerUserId: string; offerId: string }): {
    offer: Offer;
    deal: Deal;
    autoDeclinedCount: number;
  };
  declineOffer(params: { sellerUserId: string; offerId: string }): Offer;
}
export interface ChatDomainService {}
export interface NotificationDomainService {}
