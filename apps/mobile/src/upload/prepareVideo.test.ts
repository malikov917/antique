import { describe, expect, it, vi } from "vitest";
import {
  prepareVideoForUpload,
  type PrepareVideoForUploadInput,
  type UploadRuntimeContext
} from "./prepareVideo";

const baseAsset: PrepareVideoForUploadInput["asset"] = {
  uri: "file:///video.mp4",
  width: 1920,
  height: 1080,
  duration: 10_000,
  fileSize: 8_000_000,
  mimeType: "video/mp4"
};

function buildRuntime(partial: Partial<UploadRuntimeContext>): UploadRuntimeContext {
  return {
    platform: "ios",
    isExpoGo: true,
    executionEnvironment: "storeClient",
    ...partial
  };
}

describe("prepareVideoForUpload", () => {
  it("returns prepared artifact for iOS success path", async () => {
    const artifact = await prepareVideoForUpload({
      asset: baseAsset,
      runtime: buildRuntime({ platform: "ios", isExpoGo: true }),
      deps: {
        nowMs: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(140)
      }
    });

    expect(artifact.preparedUri).toBe(baseAsset.uri);
    expect(artifact.optimizationApplied).toBe(true);
    expect(artifact.originalSizeBytes).toBe(8_000_000);
    expect(artifact.optimizedSizeBytes).toBe(8_000_000);
    expect(artifact.prepDurationMs).toBe(40);
  });

  it("fails on Android Expo Go when selected video is non-compliant", async () => {
    await expect(
      prepareVideoForUpload({
        asset: {
          ...baseAsset,
          width: 3840,
          height: 2160,
          fileSize: 20_000_000
        },
        runtime: buildRuntime({ platform: "android", isExpoGo: true })
      })
    ).rejects.toMatchObject({
      name: "UploadPrepError",
      code: "PREP_PROFILE_RESOLUTION_TOO_HIGH"
    });
  });

  it("allows non-compliant source on iOS Expo Go for raw testing uploads", async () => {
    const artifact = await prepareVideoForUpload({
      asset: {
        ...baseAsset,
        width: 3840,
        height: 2160,
        fileSize: 20_000_000
      },
      runtime: buildRuntime({ platform: "ios", isExpoGo: true })
    });

    expect(artifact.preparedUri).toBe("file:///video.mp4");
    expect(artifact.originalSizeBytes).toBe(20_000_000);
  });

  it("falls back to raw source on iOS when native compression fails", async () => {
    const artifact = await prepareVideoForUpload({
      asset: baseAsset,
      runtime: buildRuntime({ platform: "ios", isExpoGo: false, executionEnvironment: "standalone" }),
      deps: {
        compressWithNativeModule: vi.fn().mockRejectedValue(new Error("compress failed"))
      }
    });

    expect(artifact.preparedUri).toBe(baseAsset.uri);
    expect(artifact.optimizationApplied).toBe(false);
    expect(artifact.optimizedSizeBytes).toBe(baseAsset.fileSize);
  });

  it("uses native compressor on Android non-Expo-Go runtime", async () => {
    const compressWithNativeModule = vi.fn().mockResolvedValue({
      uri: "file:///compressed.mp4",
      width: 1920,
      height: 1080,
      durationSec: 10,
      sizeBytes: 5_000_000
    });

    const artifact = await prepareVideoForUpload({
      asset: {
        ...baseAsset,
        width: 2560,
        height: 1440,
        fileSize: 14_000_000
      },
      runtime: buildRuntime({ platform: "android", isExpoGo: false, executionEnvironment: "standalone" }),
      deps: {
        compressWithNativeModule
      }
    });

    expect(compressWithNativeModule).toHaveBeenCalledTimes(1);
    expect(artifact.preparedUri).toBe("file:///compressed.mp4");
    expect(artifact.optimizationApplied).toBe(true);
    expect(artifact.optimizedSizeBytes).toBe(5_000_000);
  });
});
