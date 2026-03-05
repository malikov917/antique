import type { ImagePickerAsset } from "expo-image-picker";

export const MAX_VIDEO_LONG_EDGE = 1920;
export const MAX_VIDEO_SHORT_EDGE = 1080;
export const TARGET_VIDEO_BITRATE_BPS = 8_000_000;

export type UploadPlatform = "ios" | "android";

export interface UploadRuntimeContext {
  platform: UploadPlatform;
  isExpoGo: boolean;
  executionEnvironment: string | null;
}

export type UploadPrepErrorCode =
  | "PREP_TRANSCODER_UNAVAILABLE"
  | "PREP_TRANSCODE_FAILED"
  | "PREP_METADATA_MISSING"
  | "PREP_PROFILE_RESOLUTION_TOO_HIGH"
  | "PREP_PROFILE_BITRATE_TOO_HIGH";

export class UploadPrepError extends Error {
  readonly code: UploadPrepErrorCode;

  constructor(code: UploadPrepErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "UploadPrepError";
  }
}

export interface PreparedVideoArtifact {
  preparedUri: string;
  mimeType: string;
  originalSizeBytes: number;
  optimizedSizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  effectiveBitrateBps: number;
  prepDurationMs: number;
  optimizationApplied: boolean;
}

interface NativeCompressionInput {
  uri: string;
  targetBitrateBps: number;
  maxLongEdge: number;
}

interface NativeCompressionResult {
  uri: string;
  width?: number;
  height?: number;
  durationSec?: number;
  sizeBytes?: number;
}

interface PrepareVideoDeps {
  nowMs: () => number;
  getFileSizeBytes: (uri: string) => Promise<number | null>;
  compressWithNativeModule: (input: NativeCompressionInput) => Promise<NativeCompressionResult>;
}

export interface PrepareVideoForUploadInput {
  asset: ImagePickerAsset;
  runtime: UploadRuntimeContext;
  deps?: Partial<PrepareVideoDeps>;
}

const defaultDeps: PrepareVideoDeps = {
  nowMs: () => Date.now(),
  getFileSizeBytes: async (uri: string) => {
    const fileSystemLegacy = (await import("expo-file-system/legacy")) as {
      getInfoAsync: (path: string) => Promise<{ exists: boolean; size?: number }>;
    };
    const info = await fileSystemLegacy.getInfoAsync(uri);
    if (!info.exists) {
      return null;
    }
    return typeof info.size === "number" ? info.size : null;
  },
  compressWithNativeModule: async (input: NativeCompressionInput) => {
    type CompressorModule = {
      Video?: {
        compress: (
          fileUrl: string,
          options?: { bitrate?: number; maxSize?: number; compressionMethod?: "auto" | "manual" }
        ) => Promise<string>;
      };
      getVideoMetaData?: (filePath: string) => Promise<{
        duration?: number;
        width?: number;
        height?: number;
        size?: number;
      }>;
    };

    let compressorModule: CompressorModule;
    try {
      compressorModule = (await import("react-native-compressor")) as CompressorModule;
    } catch {
      throw new UploadPrepError(
        "PREP_TRANSCODER_UNAVAILABLE",
        "Video optimization is unavailable in this runtime."
      );
    }

    if (!compressorModule.Video?.compress) {
      throw new UploadPrepError(
        "PREP_TRANSCODER_UNAVAILABLE",
        "Video optimization is unavailable in this runtime."
      );
    }

    let compressedUri: string;
    try {
      compressedUri = await compressorModule.Video.compress(input.uri, {
        compressionMethod: "manual",
        maxSize: input.maxLongEdge,
        bitrate: input.targetBitrateBps
      });
    } catch {
      throw new UploadPrepError(
        "PREP_TRANSCODE_FAILED",
        "Failed to optimize video before upload. Please try another video."
      );
    }

    const metadata = await compressorModule.getVideoMetaData?.(compressedUri).catch(() => undefined);
    return {
      uri: compressedUri,
      width: toPositiveNumber(metadata?.width),
      height: toPositiveNumber(metadata?.height),
      durationSec: normalizeDurationSeconds(toPositiveNumber(metadata?.duration)),
      sizeBytes: toPositiveNumber(metadata?.size)
    };
  }
};

export function isUploadPrepError(error: unknown): error is UploadPrepError {
  return error instanceof UploadPrepError;
}

export async function prepareVideoForUpload(input: PrepareVideoForUploadInput): Promise<PreparedVideoArtifact> {
  const deps: PrepareVideoDeps = {
    ...defaultDeps,
    ...input.deps
  };

  const startedAtMs = deps.nowMs();
  const originalSizeBytes =
    toPositiveNumber(input.asset.fileSize) ?? (await deps.getFileSizeBytes(input.asset.uri));

  if (!originalSizeBytes) {
    throw new UploadPrepError(
      "PREP_METADATA_MISSING",
      "Could not read selected video details. Please pick another video."
    );
  }

  let preparedUri = input.asset.uri;
  let preparedWidth = toPositiveNumber(input.asset.width);
  let preparedHeight = toPositiveNumber(input.asset.height);
  let preparedDurationSec = normalizeDurationSeconds(toPositiveNumber(input.asset.duration));
  let preparedSizeBytes = originalSizeBytes;
  let optimizationApplied = false;

  const shouldSkipNativeTranscode =
    (input.runtime.platform === "android" && input.runtime.isExpoGo) ||
    (input.runtime.platform === "ios" && input.runtime.isExpoGo);

  if (shouldSkipNativeTranscode) {
    optimizationApplied = input.runtime.platform === "ios";
  } else {
    const compressed = await deps.compressWithNativeModule({
      uri: input.asset.uri,
      targetBitrateBps: TARGET_VIDEO_BITRATE_BPS,
      maxLongEdge: MAX_VIDEO_LONG_EDGE
    });
    preparedUri = compressed.uri;
    preparedWidth = compressed.width ?? preparedWidth;
    preparedHeight = compressed.height ?? preparedHeight;
    preparedDurationSec = compressed.durationSec ?? preparedDurationSec;
    preparedSizeBytes = compressed.sizeBytes ?? (await deps.getFileSizeBytes(preparedUri)) ?? preparedSizeBytes;
    optimizationApplied = true;
  }

  if (!preparedWidth || !preparedHeight || !preparedDurationSec) {
    throw new UploadPrepError(
      "PREP_METADATA_MISSING",
      "Could not read optimized video metadata. Please pick another video."
    );
  }

  const effectiveBitrateBps = Math.round((preparedSizeBytes * 8) / preparedDurationSec);
  enforceTargetProfile({
    width: preparedWidth,
    height: preparedHeight,
    effectiveBitrateBps
  });

  return {
    preparedUri,
    mimeType: input.asset.mimeType ?? "video/mp4",
    originalSizeBytes,
    optimizedSizeBytes: preparedSizeBytes,
    durationSec: preparedDurationSec,
    width: preparedWidth,
    height: preparedHeight,
    effectiveBitrateBps,
    prepDurationMs: Math.max(0, deps.nowMs() - startedAtMs),
    optimizationApplied
  };
}

function enforceTargetProfile(input: { width: number; height: number; effectiveBitrateBps: number }): void {
  const longEdge = Math.max(input.width, input.height);
  const shortEdge = Math.min(input.width, input.height);

  if (longEdge > MAX_VIDEO_LONG_EDGE || shortEdge > MAX_VIDEO_SHORT_EDGE) {
    throw new UploadPrepError(
      "PREP_PROFILE_RESOLUTION_TOO_HIGH",
      "Video must be 1080p or lower before upload."
    );
  }

  if (input.effectiveBitrateBps > TARGET_VIDEO_BITRATE_BPS) {
    throw new UploadPrepError(
      "PREP_PROFILE_BITRATE_TOO_HIGH",
      "Video bitrate is too high for upload. Please select a shorter or lower-quality video."
    );
  }
}

function normalizeDurationSeconds(value: number | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  if (value > 1000) {
    return value / 1000;
  }

  return value;
}

function toPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}
