import type { UploadStatusResponse } from "@antique/types";
import type { UploadRecord } from "../domain/store.js";
import { InMemoryVideoStore } from "../domain/store.js";
import { MuxVideoService } from "./videoProvider.js";

export interface UploadLookupResult {
  record: UploadRecord;
  existedBeforeLookup: boolean;
}

export class UploadLifecycleService {
  constructor(
    private readonly store: InMemoryVideoStore,
    private readonly muxVideoService: MuxVideoService
  ) {}

  async createUploadSession(): Promise<{
    uploadId: string;
    uploadUrl: string;
    expiresAt: string;
  }> {
    this.muxVideoService.ensureConfigured();
    const created = await this.muxVideoService.createDirectUpload();
    this.store.createUpload(created.uploadId);
    return created;
  }

  async lookupUploadStatus(uploadId: string): Promise<UploadLookupResult> {
    this.muxVideoService.ensureConfigured();
    const existing = this.store.getUpload(uploadId);
    const lookup = await this.muxVideoService.retrieveUpload(uploadId);
    if (lookup.status === "errored") {
      return {
        record: this.store.setUploadErrored(uploadId),
        existedBeforeLookup: Boolean(existing)
      };
    }

    let record = this.store.upsertUpload({
      uploadId: lookup.uploadId,
      createdAt: existing?.createdAt ?? Date.now(),
      assetId: lookup.assetId,
      playbackId: existing?.playbackId,
      status: lookup.status
    });

    if (!lookup.assetId) {
      return { record, existedBeforeLookup: Boolean(existing) };
    }

    record = this.store.setAsset(lookup.uploadId, lookup.assetId);
    record = await this.syncAssetState({
      uploadId: lookup.uploadId,
      assetId: lookup.assetId
    });
    return { record, existedBeforeLookup: Boolean(existing) };
  }

  async onAssetCreated(uploadId: string, assetId: string): Promise<void> {
    this.store.setAsset(uploadId, assetId);
  }

  async onAssetReady(params: {
    assetId: string;
    fallbackPlaybackId?: string;
    onPolicyMismatch?: (details: { uploadId: string; assetId: string; diagnostics: unknown }) => void;
  }): Promise<void> {
    const uploadId = this.store.findUploadIdByAssetId(params.assetId);
    if (!uploadId) {
      return;
    }
    await this.syncAssetState({
      uploadId,
      assetId: params.assetId,
      fallbackPlaybackId: params.fallbackPlaybackId,
      onPolicyMismatch: params.onPolicyMismatch
    });
  }

  async onAssetErrored(assetId: string): Promise<void> {
    const uploadId = this.store.findUploadIdByAssetId(assetId);
    if (uploadId) {
      this.store.setUploadErrored(uploadId);
    }
  }

  asUploadStatusResponse(record: UploadRecord): UploadStatusResponse {
    return {
      uploadId: record.uploadId,
      assetId: record.assetId,
      status: record.status,
      playbackId: record.playbackId
    };
  }

  private async syncAssetState(params: {
    uploadId: string;
    assetId: string;
    fallbackPlaybackId?: string;
    onPolicyMismatch?: (details: { uploadId: string; assetId: string; diagnostics: unknown }) => void;
  }): Promise<UploadRecord> {
    if (!this.muxVideoService.isConfigured()) {
      return this.store.upsertUpload({
        ...(this.store.getUpload(params.uploadId) ?? {
          uploadId: params.uploadId,
          createdAt: Date.now()
        }),
        assetId: params.assetId,
        status: "preparing"
      });
    }

    const asset = await this.muxVideoService.retrieveAsset(params.assetId);
    const resolvedPlaybackId = asset.playbackId ?? params.fallbackPlaybackId;
    if (asset.status === "ready" && resolvedPlaybackId && asset.diagnostics.policyCompliant) {
      return this.store.setPlayback(params.uploadId, resolvedPlaybackId, "ready");
    }
    if (asset.status === "errored" || !asset.diagnostics.policyCompliant) {
      if (!asset.diagnostics.policyCompliant && params.onPolicyMismatch) {
        params.onPolicyMismatch({
          uploadId: params.uploadId,
          assetId: params.assetId,
          diagnostics: asset.diagnostics
        });
      }
      return this.store.setUploadErrored(params.uploadId);
    }
    return this.store.upsertUpload({
      ...(this.store.getUpload(params.uploadId) ?? {
        uploadId: params.uploadId,
        createdAt: Date.now()
      }),
      assetId: params.assetId,
      playbackId: resolvedPlaybackId,
      status: "preparing"
    });
  }
}
