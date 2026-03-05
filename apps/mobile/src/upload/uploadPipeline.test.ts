import { describe, expect, it, vi } from "vitest";
import { runUploadPipeline, type UploadPipelineDeps } from "./uploadPipeline";
import type { PreparedVideoArtifact } from "./prepareVideo";

const preparedArtifact: PreparedVideoArtifact = {
  preparedUri: "file:///prepared.mp4",
  mimeType: "video/mp4",
  originalSizeBytes: 9_000_000,
  optimizedSizeBytes: 5_000_000,
  durationSec: 10,
  width: 1920,
  height: 1080,
  effectiveBitrateBps: 4_000_000,
  prepDurationMs: 220,
  optimizationApplied: true
};

const selectedAsset = {
  uri: "file:///source.mp4",
  width: 1920,
  height: 1080,
  duration: 10_000,
  fileSize: 9_000_000,
  mimeType: "video/mp4"
};

function createDeps(overrides: Partial<UploadPipelineDeps> = {}): { deps: UploadPipelineDeps; statuses: string[] } {
  const statuses: string[] = [];
  const deps: UploadPipelineDeps = {
    requestMediaPermission: async () => ({ granted: true }),
    pickVideo: async () => selectedAsset,
    prepareVideo: async () => preparedArtifact,
    createUploadSession: async () => ({
      uploadId: "upload-1",
      uploadUrl: "https://example.com/upload",
      expiresAt: new Date().toISOString()
    }),
    uploadPreparedVideo: async () => undefined,
    pollUploadStatus: async () => ({
      uploadId: "upload-1",
      status: "ready"
    }),
    setStatus: (status) => {
      statuses.push(status);
    },
    onDone: vi.fn(),
    sleep: async () => undefined,
    ...overrides
  };

  return { deps, statuses };
}

describe("runUploadPipeline", () => {
  it("handles prepare-step failure with deterministic status", async () => {
    const { deps, statuses } = createDeps({
      prepareVideo: async () => {
        throw new Error("Video must be 1080p or lower before upload.");
      }
    });

    await runUploadPipeline(deps);

    expect(statuses).toEqual(["Preparing video...", "Video must be 1080p or lower before upload."]);
  });

  it("handles upload failure after successful prepare", async () => {
    const { deps, statuses } = createDeps({
      uploadPreparedVideo: async () => {
        throw new Error("Upload failed (500)");
      }
    });

    await runUploadPipeline(deps);

    expect(statuses).toEqual([
      "Preparing video...",
      "Creating upload session...",
      "Uploading optimized video...",
      "Upload failed (500)"
    ]);
  });

  it("emits deterministic success status progression", async () => {
    const onDone = vi.fn();
    const { deps, statuses } = createDeps({
      onDone,
      pollUploadStatus: vi
        .fn()
        .mockResolvedValueOnce({ uploadId: "upload-1", status: "asset_created" })
        .mockResolvedValueOnce({ uploadId: "upload-1", status: "ready", playbackId: "abc123" })
    });

    await runUploadPipeline(deps);

    expect(statuses).toEqual([
      "Preparing video...",
      "Creating upload session...",
      "Uploading optimized video...",
      "Processing video...",
      "Video ready in feed"
    ]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
