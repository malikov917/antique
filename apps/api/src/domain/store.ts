import type { UploadStatus, VideoFeedItem } from "@antique/types";

export interface UploadRecord {
  uploadId: string;
  status: UploadStatus;
  assetId?: string;
  playbackId?: string;
  createdAt: number;
}

export class InMemoryVideoStore {
  private readonly uploads = new Map<string, UploadRecord>();
  private readonly uploadByAsset = new Map<string, string>();
  private readonly feed = new Map<string, VideoFeedItem>();

  seedDemoItems(playbackIds: string[]): void {
    for (const playbackId of playbackIds) {
      const id = `seed-${playbackId}`;
      this.feed.set(id, {
        id,
        playbackId,
        caption: "Demo antique reel",
        author: "antique-demo",
        posterUrl: `https://image.mux.com/${playbackId}/thumbnail.jpg?time=1`,
        durationSec: 15,
        status: "ready"
      });
    }
  }

  createUpload(uploadId: string): UploadRecord {
    const record: UploadRecord = {
      uploadId,
      status: "waiting_upload",
      createdAt: Date.now()
    };
    this.uploads.set(uploadId, record);
    return record;
  }

  getUpload(uploadId: string): UploadRecord | undefined {
    return this.uploads.get(uploadId);
  }

  upsertUpload(record: UploadRecord): UploadRecord {
    this.uploads.set(record.uploadId, record);
    if (record.assetId) {
      this.uploadByAsset.set(record.assetId, record.uploadId);
    }
    return record;
  }

  setAsset(uploadId: string, assetId: string): UploadRecord {
    const current = this.uploads.get(uploadId);
    const next: UploadRecord = {
      uploadId,
      createdAt: current?.createdAt ?? Date.now(),
      playbackId: current?.playbackId,
      status: "asset_created",
      assetId
    };
    this.uploads.set(uploadId, next);
    this.uploadByAsset.set(assetId, uploadId);
    return next;
  }

  setPlayback(uploadId: string, playbackId: string, status: UploadStatus = "ready"): UploadRecord {
    const current = this.uploads.get(uploadId);
    const next: UploadRecord = {
      uploadId,
      createdAt: current?.createdAt ?? Date.now(),
      assetId: current?.assetId,
      playbackId,
      status
    };
    this.uploads.set(uploadId, next);
    this.publishFeedItem(next);
    return next;
  }

  findUploadIdByAssetId(assetId: string): string | undefined {
    return this.uploadByAsset.get(assetId);
  }

  setUploadErrored(uploadId: string): UploadRecord {
    const current = this.uploads.get(uploadId);
    const next: UploadRecord = {
      uploadId,
      createdAt: current?.createdAt ?? Date.now(),
      assetId: current?.assetId,
      playbackId: current?.playbackId,
      status: "errored"
    };
    this.uploads.set(uploadId, next);
    return next;
  }

  allReadyFeedItems(): VideoFeedItem[] {
    return [...this.feed.values()];
  }

  private publishFeedItem(record: UploadRecord): void {
    if (!record.playbackId || record.status !== "ready") {
      return;
    }
    const id = record.uploadId;
    this.feed.set(id, {
      id,
      playbackId: record.playbackId,
      caption: "New antique video",
      author: "seller",
      posterUrl: `https://image.mux.com/${record.playbackId}/thumbnail.jpg?time=1`,
      durationSec: 15,
      status: "ready"
    });
  }
}
