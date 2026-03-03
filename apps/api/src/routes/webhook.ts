import type { FastifyInstance } from "fastify";
import type { InMemoryVideoStore } from "../domain/store.js";
import { isMuxWebhookSignatureValid } from "../services/muxWebhookSignature.js";

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
  deps: { store: InMemoryVideoStore; muxWebhookSecret?: string }
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
          deps.store.setAsset(uploadId, assetId);
        }
      }

      if (payload.type === "video.asset.ready") {
        const assetId = payload.data?.id;
        const playbackId = payload.data?.playback_ids?.[0]?.id;
        if (assetId && playbackId) {
          const uploadId = deps.store.findUploadIdByAssetId(assetId);
          if (uploadId) {
            deps.store.setPlayback(uploadId, playbackId, "ready");
          }
        }
      }

      if (payload.type === "video.asset.errored") {
        const assetId = payload.data?.id;
        if (assetId) {
          const uploadId = deps.store.findUploadIdByAssetId(assetId);
          if (uploadId) {
            deps.store.setUploadErrored(uploadId);
          }
        }
      }

      return reply.code(204).send();
    });
}
