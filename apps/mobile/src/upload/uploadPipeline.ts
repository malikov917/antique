import type { CreateUploadResponse, UploadStatusResponse } from "@antique/types";
import type { PreparedVideoArtifact } from "./prepareVideo";

export interface SelectedVideoAsset {
  uri: string;
  width: number;
  height: number;
  duration?: number | null;
  fileSize?: number | null;
  mimeType?: string;
}

export interface UploadPipelineDeps {
  requestMediaPermission: () => Promise<{ granted: boolean }>;
  pickVideo: () => Promise<SelectedVideoAsset | null>;
  prepareVideo: (asset: SelectedVideoAsset) => Promise<PreparedVideoArtifact>;
  createUploadSession: () => Promise<CreateUploadResponse>;
  uploadPreparedVideo: (uploadUrl: string, prepared: PreparedVideoArtifact) => Promise<void>;
  pollUploadStatus: (uploadId: string) => Promise<UploadStatusResponse>;
  setStatus: (status: string) => void;
  onDone: () => void;
  sleep?: (ms: number) => Promise<void>;
  pollAttempts?: number;
  pollIntervalMs?: number;
}

export async function runUploadPipeline(deps: UploadPipelineDeps): Promise<void> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const pollAttempts = deps.pollAttempts ?? 30;
  const pollIntervalMs = deps.pollIntervalMs ?? 1500;

  try {
    const permission = await deps.requestMediaPermission();
    if (!permission.granted) {
      deps.setStatus("Media permission denied");
      return;
    }

    const pickedAsset = await deps.pickVideo();
    if (!pickedAsset) {
      deps.setStatus("Upload canceled");
      return;
    }

    deps.setStatus("Preparing video...");
    const preparedVideo = await deps.prepareVideo(pickedAsset);

    deps.setStatus("Creating upload session...");
    const uploadSession = await deps.createUploadSession();

    deps.setStatus("Uploading optimized video...");
    await deps.uploadPreparedVideo(uploadSession.uploadUrl, preparedVideo);

    deps.setStatus("Processing video...");
    for (let attempt = 0; attempt < pollAttempts; attempt++) {
      const body = await deps.pollUploadStatus(uploadSession.uploadId);

      if (body.status === "ready") {
        deps.setStatus("Video ready in feed");
        deps.onDone();
        return;
      }

      if (body.status === "errored") {
        throw new Error("Video processing failed");
      }

      await sleep(pollIntervalMs);
    }

    deps.setStatus("Still processing, check back in a moment");
  } catch (error) {
    deps.setStatus(error instanceof Error ? error.message : "Upload failed");
  }
}
