import Mux from "@mux/mux-node";

export type MuxMaxResolutionTier = "1080p" | "1440p" | "2160p";
export type MuxVideoQuality = "basic" | "plus" | "premium";
export type MuxPlaybackPolicy = "public" | "signed";

export interface MuxAssetPolicy {
  maxResolutionTier: MuxMaxResolutionTier;
  videoQuality: MuxVideoQuality;
  playbackPolicy: MuxPlaybackPolicy[];
}

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

export interface AssetDiagnostics {
  policyCompliant: boolean;
  policyIssues: string[];
  expectedMaxResolutionTier: MuxMaxResolutionTier;
  actualMaxResolutionTier?: MuxMaxResolutionTier;
  expectedVideoQuality: MuxVideoQuality;
  actualVideoQuality?: MuxVideoQuality;
}

export interface AssetLookup {
  assetId: string;
  status: "preparing" | "ready" | "errored";
  playbackId?: string;
  diagnostics: AssetDiagnostics;
}

export const DEFAULT_MUX_ASSET_POLICY: MuxAssetPolicy = {
  maxResolutionTier: "1080p",
  videoQuality: "plus",
  playbackPolicy: ["public"]
};

interface MuxUploadResponse {
  id?: string;
  url?: string;
  asset_id?: string;
}

interface MuxAssetResponse {
  status?: string;
  playback_ids?: Array<{ id?: string }>;
  max_resolution_tier?: MuxMaxResolutionTier;
  video_quality?: MuxVideoQuality;
}

export interface MuxClient {
  video: {
    uploads: {
      create(input: unknown): Promise<MuxUploadResponse>;
      retrieve(uploadId: string): Promise<MuxUploadResponse>;
    };
    assets: {
      retrieve(assetId: string): Promise<MuxAssetResponse>;
      delete(assetId: string): Promise<void>;
    };
  };
}

export class MissingMuxCredentialsError extends Error {
  constructor() {
    super("Mux credentials are required for upload routes");
    this.name = "MissingMuxCredentialsError";
  }
}

export interface MuxVideoServiceConfig {
  muxTokenId?: string;
  muxTokenSecret?: string;
  muxAssetPolicy: MuxAssetPolicy;
}

export class MuxVideoService {
  private readonly mux?: MuxClient;
  private readonly assetPolicy: MuxAssetPolicy;

  constructor(config: MuxVideoServiceConfig, muxClient?: MuxClient) {
    this.assetPolicy = config.muxAssetPolicy;
    if (muxClient) {
      this.mux = muxClient;
      return;
    }
    if (config.muxTokenId && config.muxTokenSecret) {
      this.mux = new Mux({
        tokenId: config.muxTokenId,
        tokenSecret: config.muxTokenSecret
      });
    }
  }

  isConfigured(): boolean {
    return Boolean(this.mux);
  }

  ensureConfigured(): void {
    if (!this.mux) {
      throw new MissingMuxCredentialsError();
    }
  }

  async createDirectUpload(): Promise<DirectUpload> {
    this.ensureConfigured();
    const mux = this.mux;
    if (!mux) {
      throw new MissingMuxCredentialsError();
    }
    const upload = (await mux.video.uploads.create({
      cors_origin: "*",
      new_asset_settings: {
        playback_policy: this.assetPolicy.playbackPolicy,
        max_resolution_tier: this.assetPolicy.maxResolutionTier,
        video_quality: this.assetPolicy.videoQuality
      }
    })) as MuxUploadResponse;

    return {
      uploadId: String(upload.id),
      uploadUrl: String(upload.url),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
    };
  }

  async retrieveUpload(uploadId: string): Promise<UploadLookup> {
    this.ensureConfigured();
    const mux = this.mux;
    if (!mux) {
      throw new MissingMuxCredentialsError();
    }
    const upload = (await mux.video.uploads.retrieve(uploadId)) as MuxUploadResponse;
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
    this.ensureConfigured();
    const mux = this.mux;
    if (!mux) {
      throw new MissingMuxCredentialsError();
    }
    const asset = (await mux.video.assets.retrieve(assetId)) as MuxAssetResponse;
    const playbackId = Array.isArray(asset.playback_ids)
      ? asset.playback_ids[0]?.id
      : undefined;
    const rawStatus = String(asset.status ?? "preparing");
    const diagnostics = this.evaluateAssetPolicy(asset);
    const isPolicyCompliant = diagnostics.policyCompliant;
    return {
      assetId,
      playbackId: playbackId ? String(playbackId) : undefined,
      diagnostics,
      status:
        rawStatus === "ready" && isPolicyCompliant
          ? "ready"
          : rawStatus === "errored" || (rawStatus === "ready" && !isPolicyCompliant)
            ? "errored"
            : "preparing"
    };
  }

  async deleteAsset(assetId: string): Promise<void> {
    if (!this.mux) {
      return;
    }
    await this.mux.video.assets.delete(assetId);
  }

  private evaluateAssetPolicy(asset: MuxAssetResponse): AssetDiagnostics {
    const policyIssues: string[] = [];
    const actualMaxResolutionTier = asset.max_resolution_tier;
    const actualVideoQuality = asset.video_quality;

    if (!actualMaxResolutionTier) {
      policyIssues.push("Missing max_resolution_tier on Mux asset response");
    } else if (actualMaxResolutionTier !== this.assetPolicy.maxResolutionTier) {
      policyIssues.push(
        `Expected max_resolution_tier=${this.assetPolicy.maxResolutionTier}, got ${actualMaxResolutionTier}`
      );
    }

    if (!actualVideoQuality) {
      policyIssues.push("Missing video_quality on Mux asset response");
    } else if (actualVideoQuality !== this.assetPolicy.videoQuality) {
      policyIssues.push(
        `Expected video_quality=${this.assetPolicy.videoQuality}, got ${actualVideoQuality}`
      );
    }

    return {
      policyCompliant: policyIssues.length === 0,
      policyIssues,
      expectedMaxResolutionTier: this.assetPolicy.maxResolutionTier,
      actualMaxResolutionTier,
      expectedVideoQuality: this.assetPolicy.videoQuality,
      actualVideoQuality
    };
  }
}
