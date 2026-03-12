import type {
  BasketItem,
  Chat,
  ChatMessage,
  Deal,
  Listing,
  MarketSession,
  Offer
} from "@antique/types";

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
}

export interface DealDomainService {
  listSellerListingOffers(params: { sellerUserId: string; listingId: string }): Offer[];
  listDealsForUser(params: { userId: string }): Deal[];
  requestCancellation(params: {
    userId: string;
    userRole: "buyer" | "seller" | "admin";
    dealId: string;
  }): Deal;
  updateDealStatus(params: {
    userId: string;
    userRole: "buyer" | "seller" | "admin";
    dealId: string;
    status: "paid" | "cancellation_requested" | "completed" | "canceled" | "refunded";
    reasonCode?: string;
    refundConfirmed?: boolean;
  }): Deal;
  acceptOffer(params: { sellerUserId: string; offerId: string; requestIp?: string }): {
    offer: Offer;
    deal: Deal;
    autoDeclinedCount: number;
  };
  declineOffer(params: { sellerUserId: string; offerId: string; requestIp?: string }): Offer;
}

export interface ChatDomainService {
  listChatsForUser(params: { userId: string }): Chat[];
  listChatMessages(params: { userId: string; chatId: string }): ChatMessage[];
  createChatMessage(params: { userId: string; chatId: string; text: string }): ChatMessage;
}
export interface NotificationDomainService {}
