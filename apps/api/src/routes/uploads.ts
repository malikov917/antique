import type { CreateUploadResponse, UploadStatusResponse } from "@antique/types";
import type { FastifyInstance, FastifyReply } from "fastify";
import { UploadLifecycleService } from "../services/uploadLifecycle.js";
import { MissingMuxCredentialsError } from "../services/videoProvider.js";

async function withMuxCredentialsGuard<T>(
  reply: FastifyReply,
  task: () => Promise<T>
): Promise<T | ReturnType<FastifyReply["send"]>> {
  try {
    return await task();
  } catch (error) {
    if (error instanceof MissingMuxCredentialsError) {
      return reply.code(503).send({ error: error.message });
    }
    throw error;
  }
}

export async function registerUploadRoutes(
  app: FastifyInstance,
  deps: { uploadLifecycle: UploadLifecycleService }
): Promise<void> {
  app.post("/v1/uploads", async (_request, reply) => {
    return withMuxCredentialsGuard(reply, async () => {
      const created = await deps.uploadLifecycle.createUploadSession();
      const response: CreateUploadResponse = {
        uploadId: created.uploadId,
        uploadUrl: created.uploadUrl,
        expiresAt: created.expiresAt
      };
      return response;
    });
  });

  app.get<{ Params: { uploadId: string } }>("/v1/uploads/:uploadId", async (request, reply) => {
    return withMuxCredentialsGuard(reply, async () => {
      const lookedUp = await deps.uploadLifecycle.lookupUploadStatus(request.params.uploadId);
      reply.code(lookedUp.record.status === "errored" && !lookedUp.existedBeforeLookup ? 404 : 200);
      const response: UploadStatusResponse = deps.uploadLifecycle.asUploadStatusResponse(
        lookedUp.record
      );
      return response;
    });
  });
}
