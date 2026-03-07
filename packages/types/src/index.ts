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

export interface Deal {
  id: string;
  listingId: string;
  acceptedOfferId: string;
  sellerUserId: string;
  buyerUserId: string;
  createdAt: string;
  updatedAt: string;
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

export interface NotificationItem {
  id: string;
  type: "offer_submitted" | "offer_accepted" | "offer_declined" | "session_opened" | "session_closed" | "announcement";
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
