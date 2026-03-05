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
