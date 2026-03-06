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
