import type { FastifyInstance } from "fastify";
import { isMuxWebhookSignatureValid } from "../services/muxWebhookSignature.js";
import { UploadLifecycleService } from "../services/uploadLifecycle.js";

interface MuxWebhookPayload {
  type?: string;
  data?: {
    id?: string;
    upload_id?: string;
    asset_id?: string;
    playback_ids?: Array<{ id?: string }>;
  };
}

export async function registerWebhookRoutes(
  app: FastifyInstance,
  deps: { muxWebhookSecret?: string; uploadLifecycle: UploadLifecycleService }
): Promise<void> {
  app.post<{ Body: MuxWebhookPayload }>("/v1/webhooks/mux", async (request, reply) => {
    const validSignature = isMuxWebhookSignatureValid({
      signatureHeader: request.headers["mux-signature"] as string | undefined,
      rawBody: request.rawBody,
      secret: deps.muxWebhookSecret
    });
    if (!validSignature) {
      return reply.code(401).send({ error: "Invalid Mux signature" });
    }

    const payload = request.body;
    if (payload.type === "video.upload.asset_created") {
      const uploadId = payload.data?.upload_id ?? payload.data?.id;
      const assetId = payload.data?.asset_id;
      if (uploadId && assetId) {
        await deps.uploadLifecycle.onAssetCreated(uploadId, assetId);
      }
    }

    if (payload.type === "video.asset.ready") {
      const assetId = payload.data?.id;
      const playbackId = payload.data?.playback_ids?.[0]?.id;
      if (assetId) {
        await deps.uploadLifecycle.onAssetReady({
          assetId,
          fallbackPlaybackId: playbackId,
          onPolicyMismatch: (details) => {
            request.log.warn(
              {
                uploadId: details.uploadId,
                assetId: details.assetId,
                diagnostics: details.diagnostics
              },
              "Mux webhook ready event rejected due to policy mismatch"
            );
          }
        });
      }
    }

    if (payload.type === "video.asset.errored") {
      const assetId = payload.data?.id;
      if (assetId) {
        await deps.uploadLifecycle.onAssetErrored(assetId);
      }
    }

    return reply.code(204).send();
  });
}
