import type { CreateUploadResponse, UploadStatusResponse } from "@antique/types";
import type { FastifyInstance } from "fastify";
import type { InMemoryVideoStore } from "../domain/store.js";
import type { VideoProvider } from "../services/videoProvider.js";

export async function registerUploadRoutes(
  app: FastifyInstance,
  deps: { store: InMemoryVideoStore; videoProvider: VideoProvider }
): Promise<void> {
  app.post("/v1/uploads", async () => {
    const created = await deps.videoProvider.createDirectUpload();
    deps.store.createUpload(created.uploadId);
    const response: CreateUploadResponse = {
      uploadId: created.uploadId,
      uploadUrl: created.uploadUrl,
      expiresAt: created.expiresAt
    };
    return response;
  });

  app.get<{ Params: { uploadId: string } }>("/v1/uploads/:uploadId", async (request, reply) => {
    const existing = deps.store.getUpload(request.params.uploadId);
    const lookup = await deps.videoProvider.retrieveUpload(request.params.uploadId);
    if (lookup.status === "errored") {
      const errored = deps.store.setUploadErrored(request.params.uploadId);
      reply.code(existing ? 200 : 404);
      const response: UploadStatusResponse = {
        uploadId: errored.uploadId,
        status: errored.status,
        assetId: errored.assetId,
        playbackId: errored.playbackId
      };
      return response;
    }

    let record = deps.store.upsertUpload({
      uploadId: lookup.uploadId,
      createdAt: existing?.createdAt ?? Date.now(),
      assetId: lookup.assetId,
      playbackId: existing?.playbackId,
      status: lookup.status
    });

    if (lookup.assetId) {
      record = deps.store.setAsset(lookup.uploadId, lookup.assetId);
      const asset = await deps.videoProvider.retrieveAsset(lookup.assetId);
      if (asset.status === "ready" && asset.playbackId) {
        record = deps.store.setPlayback(lookup.uploadId, asset.playbackId, "ready");
      } else if (asset.status === "errored") {
        record = deps.store.setUploadErrored(lookup.uploadId);
      } else {
        record = deps.store.upsertUpload({ ...record, status: "preparing" });
      }
    }

    const response: UploadStatusResponse = {
      uploadId: record.uploadId,
      assetId: record.assetId,
      status: record.status,
      playbackId: record.playbackId
    };
    return response;
  });
}
