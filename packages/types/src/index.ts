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

