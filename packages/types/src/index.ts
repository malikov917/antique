export type UploadStatus =
  | "waiting_upload"
  | "asset_created"
  | "preparing"
  | "ready"
  | "errored";

export interface VideoFeedItem {
  id: string;
  playbackId: string;
  caption: string;
  author: string;
  posterUrl: string;
  durationSec: number;
  status: UploadStatus;
  freshnessUpdatedAt?: string;
  freshnessAgeSec?: number;
}

export interface CreateUploadResponse {
  uploadId: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface UploadStatusResponse {
  uploadId: string;
  assetId?: string;
  status: UploadStatus;
  playbackId?: string;
}

export interface FeedResponse {
  items: VideoFeedItem[];
  nextCursor?: string;
}

export type AuthRole = "buyer" | "seller" | "admin";

export type AuthPlatform = "ios" | "android";

export interface AuthUser {
  id: string;
  phone: string;
  displayName: string | null;
  tenantId: string;
  allowedRoles: AuthRole[];
  activeRole: AuthRole;
  sellerProfileId: string | null;
}

export interface AuthSession {
  id: string;
  deviceId: string;
  platform: AuthPlatform;
  createdAt: string;
}

export interface AuthTokens {
  tokenType: "Bearer";
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface AuthErrorResponse {
  error: string;
  code: string;
  retryAfterSec?: number;
}

export interface OtpRequestRequest {
  phone: string;
}

export interface OtpRequestResponse {
  status: "otp_sent";
  retryAfterSec: number;
}

export interface OtpVerifyRequest {
  phone: string;
  code: string;
  deviceId: string;
  platform: AuthPlatform;
}

export interface OtpVerifyResponse {
  user: AuthUser;
  session: AuthSession;
  tokens: AuthTokens;
  isNewUser: boolean;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  session: AuthSession;
  tokens: AuthTokens;
}

export interface LogoutRequest {
  refreshToken: string;
}

export interface LogoutResponse {
  success: true;
}

export type SellerApplicationStatus = "not_requested" | "pending" | "approved" | "rejected";

export interface SellerApplication {
  status: SellerApplicationStatus;
  fullName: string | null;
  shopName: string | null;
  note: string | null;
  rejectionReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  updatedAt: string | null;
}

export interface SellerApplyRequest {
  fullName: string;
  shopName: string;
  note?: string;
}

export interface SellerApplyResponse {
  application: SellerApplication;
}

export interface SellerApplicationResponse {
  application: SellerApplication;
}

export interface ApproveSellerApplicationResponse {
  application: SellerApplication;
}

export interface RejectSellerApplicationRequest {
  reason: string;
}

export interface RejectSellerApplicationResponse {
  application: SellerApplication;
}

export type SellerSaleFulfillmentStatus =
  | "open"
  | "payment_overdue"
  | "paid"
  | "completed"
  | "canceled"
  | "unknown";

export interface SellerSaleLedgerEntry {
  sellerUserId: string;
  sessionId: string;
  listingId: string;
  listingTitle: string;
  acceptedOfferAmountCents: number;
  currency: string;
  buyerUserId: string;
  soldAt: string;
  fulfillmentStatus: SellerSaleFulfillmentStatus;
}

export interface SellerSalesLedgerResponse {
  sales: SellerSaleLedgerEntry[];
}

export interface BlockUserResponse {
  success: true;
}

export interface ReportUserRequest {
  reason: string;
  details?: string;
}

export interface ReportUserResponse {
  reportId: string;
  createdAt: string;
}

export interface SuspendSellerRequest {
  reason?: string;
}

export interface SuspendSellerResponse {
  userId: string;
  suspendedAt: string;
}

export interface FlagListingModerationRequest {
  reasonCode: string;
  note?: string;
}

export interface FlagListingModerationResponse {
  flagId: string;
  listingId: string;
  status: "open";
  reasonCode: string;
  createdAt: string;
}

export interface MeResponse {
  user: AuthUser;
}

export interface UpdateMeRequest {
  displayName?: string | null;
}

export interface RoleSwitchRequest {
  role: AuthRole;
}

export interface RoleSwitchResponse {
  user: AuthUser;
}

export type MarketSessionStatus = "open" | "closed";

export interface MarketSession {
  id: string;
  sellerUserId: string;
  status: MarketSessionStatus;
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OpenMarketSessionResponse {
  session: MarketSession;
}

export interface CloseMarketSessionResponse {
  session: MarketSession;
  transitionedListingCount: number;
}

export type ListingStatus = "live" | "day_closed" | "sold" | "withdrawn";

export interface Listing {
  id: string;
  sellerUserId: string;
  marketSessionId: string;
  status: ListingStatus;
  title: string;
  description: string;
  listedPriceCents: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateListingRequest {
  title: string;
  description?: string;
  listedPriceCents: number;
  currency?: string;
}

export interface CreateListingResponse {
  listing: Listing;
}

export interface UpdateListingRequest {
  title?: string;
  description?: string;
  listedPriceCents?: number;
  currency?: string;
}

export interface UpdateListingResponse {
  listing: Listing;
}

export interface BasketItem {
  id: string;
  listingId: string;
  buyerUserId: string;
  createdAt: string;
}

export interface CreateBasketResponse {
  basketItem: BasketItem;
}

export interface CreateOfferRequest {
  amountCents: number;
  shippingAddress: string;
}

export interface Offer {
  id: string;
  listingId: string;
  buyerUserId: string;
  amountCents: number;
  shippingAddress: string;
  status: "submitted" | "accepted" | "declined";
  createdAt: string;
}

export interface CreateOfferResponse {
  offer: Offer;
}

export const MIN_OFFER_RULE = (offerAmountCents: number, listedPriceCents: number): boolean =>
  offerAmountCents >= listedPriceCents;

export type DealStatus =
  | "open"
  | "payment_overdue"
  | "paid"
  | "cancellation_requested"
  | "completed"
  | "canceled"
  | "refunded";

export const DEAL_STATUS_TRANSITIONS: Record<DealStatus, readonly DealStatus[]> = {
  open: ["payment_overdue", "paid", "cancellation_requested"],
  payment_overdue: ["paid", "cancellation_requested"],
  paid: ["completed", "cancellation_requested", "refunded"],
  cancellation_requested: ["paid", "canceled", "refunded"],
  completed: [],
  canceled: [],
  refunded: []
};

export const isDealStatusTransitionAllowed = (current: DealStatus, next: DealStatus): boolean =>
  current === next || DEAL_STATUS_TRANSITIONS[current].includes(next);

export interface Deal {
  id: string;
  listingId: string;
  acceptedOfferId: string;
  sellerUserId: string;
  buyerUserId: string;
  status: DealStatus;
  paymentDueAt: string;
  paymentOverdueAt: string | null;
  paymentExtendedAt: string | null;
  paymentTimeoutReason: string | null;
  activeShippingAddress: string;
  addressCorrection: DealAddressCorrectionSummary | null;
  createdAt: string;
  updatedAt: string;
}

export type DealAddressCorrectionStatus = "pending" | "approved" | "rejected";

export interface DealAddressCorrection {
  id: string;
  dealId: string;
  requestedByUserId: string;
  status: DealAddressCorrectionStatus;
  reason: string;
  proposedShippingAddress: string;
  resolvedByUserId: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DealAddressCorrectionSummary {
  latestCorrectionId: string;
  latestStatus: DealAddressCorrectionStatus;
  pendingCount: number;
  lastRequestedAt: string;
}

export interface SellerListingOffersResponse {
  offers: Offer[];
}

export interface AcceptOfferResponse {
  offer: Offer;
  deal: Deal;
  autoDeclinedCount: number;
}

export interface DeclineOfferResponse {
  offer: Offer;
}

export interface DealsMeResponse {
  deals: Deal[];
}

export interface UpdateDealStatusRequest {
  status: Exclude<DealStatus, "open" | "payment_overdue">;
  reasonCode?: string;
  note?: string;
  refundConfirmed?: boolean;
}

export interface UpdateDealStatusResponse {
  deal: Deal;
}

export interface CancelDealRequest {
  reasonCode: string;
  note?: string;
}

export interface CancelDealResponse {
  deal: Deal;
}

export interface CreateDealAddressCorrectionRequest {
  shippingAddress: string;
  reason: string;
}

export interface CreateDealAddressCorrectionResponse {
  correction: DealAddressCorrection;
  deal: Deal;
}

export interface ResolveDealAddressCorrectionResponse {
  correction: DealAddressCorrection;
  deal: Deal;
}

export interface Chat {
  id: string;
  dealId: string;
  listingId: string;
  sellerUserId: string;
  buyerUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  senderUserId: string;
  text: string;
  createdAt: string;
}

export interface ChatsResponse {
  chats: Chat[];
}

export interface ChatMessagesResponse {
  messages: ChatMessage[];
}

export interface SendChatMessageRequest {
  text: string;
}

export interface SendChatMessageResponse {
  message: ChatMessage;
}

export interface NotificationItem {
  id: string;
  type:
    | "offer_submitted"
    | "offer_accepted"
    | "offer_declined"
    | "session_opened"
    | "session_closed"
    | "deal_cancellation_requested"
    | "deal_cancellation_resolved"
    | "deal_refund_confirmed"
    | "announcement"
    | "deal_address_correction_requested"
    | "deal_address_correction_approved"
    | "deal_address_correction_rejected";
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationsResponse {
  notifications: NotificationItem[];
}

export interface RegisterPushTokenRequest {
  token: string;
  platform: AuthPlatform;
}

export interface RegisterPushTokenResponse {
  success: true;
}

export interface AnnouncementItem {
  id: string;
  sellerUserId: string;
  source: "manual" | "system";
  eventType?: "market_session_opened" | "market_session_closed";
  title: string;
  body: string;
  createdAt: string;
}

export interface ListAnnouncementsResponse {
  announcements: AnnouncementItem[];
}

export interface CreateAnnouncementRequest {
  title: string;
  body: string;
}

export interface CreateAnnouncementResponse {
  announcement: AnnouncementItem;
}
