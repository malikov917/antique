import { isUploadPrepError, type PreparedVideoArtifact, type UploadRuntimeContext } from "./prepareVideo";

interface UploadPrepCompletedEvent {
  event: "upload_prep_completed";
  platform: UploadRuntimeContext["platform"];
  isExpoGo: boolean;
  executionEnvironment: string | null;
  originalSizeBytes: number;
  optimizedSizeBytes: number;
  sizeDeltaBytes: number;
  prepDurationMs: number;
  effectiveBitrateBps: number;
  width: number;
  height: number;
  durationSec: number;
  optimizationApplied: boolean;
}

interface UploadPrepFailedEvent {
  event: "upload_prep_failed";
  platform: UploadRuntimeContext["platform"];
  isExpoGo: boolean;
  executionEnvironment: string | null;
  prepDurationMs: number;
  originalSizeBytes?: number;
  errorCode: string;
  errorMessage: string;
}

export function logUploadPrepCompleted(params: {
  runtime: UploadRuntimeContext;
  artifact: PreparedVideoArtifact;
}): void {
  const event: UploadPrepCompletedEvent = {
    event: "upload_prep_completed",
    platform: params.runtime.platform,
    isExpoGo: params.runtime.isExpoGo,
    executionEnvironment: params.runtime.executionEnvironment,
    originalSizeBytes: params.artifact.originalSizeBytes,
    optimizedSizeBytes: params.artifact.optimizedSizeBytes,
    sizeDeltaBytes: params.artifact.originalSizeBytes - params.artifact.optimizedSizeBytes,
    prepDurationMs: params.artifact.prepDurationMs,
    effectiveBitrateBps: params.artifact.effectiveBitrateBps,
    width: params.artifact.width,
    height: params.artifact.height,
    durationSec: params.artifact.durationSec,
    optimizationApplied: params.artifact.optimizationApplied
  };

  console.log(JSON.stringify(event));
}

export function logUploadPrepFailed(params: {
  runtime: UploadRuntimeContext;
  error: unknown;
  startedAtMs: number;
  originalSizeBytes?: number;
}): void {
  const prepErrorCode = isUploadPrepError(params.error) ? params.error.code : "PREP_UNKNOWN_ERROR";
  const prepErrorMessage =
    params.error instanceof Error ? params.error.message : "Video optimization failed before upload.";

  const event: UploadPrepFailedEvent = {
    event: "upload_prep_failed",
    platform: params.runtime.platform,
    isExpoGo: params.runtime.isExpoGo,
    executionEnvironment: params.runtime.executionEnvironment,
    prepDurationMs: Math.max(0, Date.now() - params.startedAtMs),
    originalSizeBytes: params.originalSizeBytes,
    errorCode: prepErrorCode,
    errorMessage: prepErrorMessage
  };

  console.log(JSON.stringify(event));
}
