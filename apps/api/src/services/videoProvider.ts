import Mux from "@mux/mux-node";

export interface DirectUpload {
  uploadId: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface UploadLookup {
  uploadId: string;
  status: "waiting_upload" | "asset_created" | "preparing" | "ready" | "errored";
  assetId?: string;
}

export interface AssetLookup {
  assetId: string;
  status: "preparing" | "ready" | "errored";
  playbackId?: string;
}

export interface VideoProvider {
  createDirectUpload(): Promise<DirectUpload>;
  retrieveUpload(uploadId: string): Promise<UploadLookup>;
  retrieveAsset(assetId: string): Promise<AssetLookup>;
}

interface MuxUploadResponse {
  id?: string;
  url?: string;
  asset_id?: string;
}

interface MuxAssetResponse {
  status?: string;
  playback_ids?: Array<{ id?: string }>;
}

class MuxVideoProvider implements VideoProvider {
  private readonly mux: Mux;

  constructor(tokenId: string, tokenSecret: string) {
    this.mux = new Mux({
      tokenId,
      tokenSecret
    });
  }

  async createDirectUpload(): Promise<DirectUpload> {
    const upload = (await this.mux.video.uploads.create({
      cors_origin: "*",
      new_asset_settings: {
        playback_policy: ["public"]
      }
    })) as MuxUploadResponse;

    return {
      uploadId: String(upload.id),
      uploadUrl: String(upload.url),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    };
  }

  async retrieveUpload(uploadId: string): Promise<UploadLookup> {
    const upload = (await this.mux.video.uploads.retrieve(uploadId)) as MuxUploadResponse;
    const assetId = upload.asset_id ? String(upload.asset_id) : undefined;
    if (!assetId) {
      return {
        uploadId,
        status: "waiting_upload"
      };
    }
    return {
      uploadId,
      status: "asset_created",
      assetId
    };
  }

  async retrieveAsset(assetId: string): Promise<AssetLookup> {
    const asset = (await this.mux.video.assets.retrieve(assetId)) as MuxAssetResponse;
    const playbackId = Array.isArray(asset.playback_ids)
      ? asset.playback_ids[0]?.id
      : undefined;
    const rawStatus = String(asset.status ?? "preparing");
    return {
      assetId,
      playbackId: playbackId ? String(playbackId) : undefined,
      status:
        rawStatus === "ready"
          ? "ready"
          : rawStatus === "errored"
            ? "errored"
            : "preparing"
    };
  }
}

class MockVideoProvider implements VideoProvider {
  private readonly uploads = new Map<string, { createdAt: number; assetId?: string }>();
  private readonly demoPlaybackIds: string[];
  private sequence = 0;

  constructor(demoPlaybackIds: string[]) {
    this.demoPlaybackIds = demoPlaybackIds;
  }

  async createDirectUpload(): Promise<DirectUpload> {
    const uploadId = `mock-upload-${++this.sequence}`;
    this.uploads.set(uploadId, { createdAt: Date.now() });
    return {
      uploadId,
      uploadUrl: "https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    };
  }

  async retrieveUpload(uploadId: string): Promise<UploadLookup> {
    const row = this.uploads.get(uploadId);
    if (!row) {
      return { uploadId, status: "errored" };
    }
    if (!row.assetId && Date.now() - row.createdAt > 1500) {
      row.assetId = `mock-asset-${uploadId}`;
    }
    if (!row.assetId) {
      return { uploadId, status: "waiting_upload" };
    }
    return {
      uploadId,
      assetId: row.assetId,
      status: "asset_created"
    };
  }

  async retrieveAsset(assetId: string): Promise<AssetLookup> {
    const index = Math.max(this.sequence - 1, 0);
    const playbackId = this.demoPlaybackIds[index] ?? this.demoPlaybackIds[0];
    return {
      assetId,
      status: playbackId ? "ready" : "preparing",
      playbackId
    };
  }
}

export function createVideoProvider(params: {
  muxTokenId?: string;
  muxTokenSecret?: string;
  demoPlaybackIds: string[];
}): VideoProvider {
  if (params.muxTokenId && params.muxTokenSecret) {
    return new MuxVideoProvider(params.muxTokenId, params.muxTokenSecret);
  }
  return new MockVideoProvider(params.demoPlaybackIds);
}
