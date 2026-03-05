import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MUX_ASSET_POLICY,
  MuxVideoService,
  type MuxAssetPolicy
} from "../src/services/videoProvider.js";

describe("MuxVideoService", () => {
  it("applies explicit mux asset policy in direct upload creation", async () => {
    const createUpload = vi.fn(async () => ({
      id: "upload-123",
      url: "https://storage.mux.com/upload-123"
    }));

    const service = new MuxVideoService(
      {
        muxTokenId: "token-id",
        muxTokenSecret: "token-secret",
        muxAssetPolicy: DEFAULT_MUX_ASSET_POLICY
      },
      {
        video: {
          uploads: {
            create: createUpload,
            retrieve: async () => ({ id: "upload-123" })
          },
          assets: {
            retrieve: async () => ({
              status: "ready",
              playback_ids: [{ id: "playback-123" }],
              max_resolution_tier: "1080p",
              video_quality: "plus"
            }),
            delete: async () => undefined
          }
        }
      }
    );

    await service.createDirectUpload();

    expect(createUpload).toHaveBeenCalledWith({
      cors_origin: "*",
      new_asset_settings: {
        playback_policy: ["public"],
        max_resolution_tier: "1080p",
        video_quality: "plus"
      }
    });
  });

  it("marks ready assets errored when policy does not match", async () => {
    const policy: MuxAssetPolicy = {
      maxResolutionTier: "1080p",
      videoQuality: "plus",
      playbackPolicy: ["public"]
    };

    const service = new MuxVideoService(
      {
        muxTokenId: "token-id",
        muxTokenSecret: "token-secret",
        muxAssetPolicy: policy
      },
      {
        video: {
          uploads: {
            create: async () => ({ id: "upload-123", url: "https://storage.mux.com/upload-123" }),
            retrieve: async () => ({ id: "upload-123" })
          },
          assets: {
            retrieve: async () => ({
              status: "ready",
              playback_ids: [{ id: "playback-123" }],
              max_resolution_tier: "1440p",
              video_quality: "plus"
            }),
            delete: async () => undefined
          }
        }
      }
    );

    const asset = await service.retrieveAsset("asset-123");

    expect(asset.status).toBe("errored");
    expect(asset.diagnostics.policyCompliant).toBe(false);
    expect(asset.diagnostics.policyIssues[0]).toContain("max_resolution_tier");
  });

  it("throws deterministic error when credentials are missing", async () => {
    const service = new MuxVideoService({
      muxAssetPolicy: DEFAULT_MUX_ASSET_POLICY
    });
    await expect(service.createDirectUpload()).rejects.toThrow("Mux credentials are required");
  });
});
