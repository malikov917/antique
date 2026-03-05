import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { InMemoryVideoStore } from "./domain/store.js";
import { registerFeedRoutes } from "./routes/feed.js";
import { registerUploadRoutes } from "./routes/uploads.js";
import { registerWebhookRoutes } from "./routes/webhook.js";
import { type ApiConfig } from "./config.js";
import { UploadLifecycleService } from "./services/uploadLifecycle.js";
import { MuxVideoService, type MuxClient } from "./services/videoProvider.js";

export interface BuildServerParams {
  config: ApiConfig;
  store?: InMemoryVideoStore;
  muxClient?: MuxClient;
}

export async function buildServer(params: BuildServerParams): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true
  });

  const store = params.store ?? new InMemoryVideoStore();
  store.seedDemoItems(params.config.demoPlaybackIds);
  const muxVideoService = new MuxVideoService(
    {
      muxTokenId: params.config.muxTokenId,
      muxTokenSecret: params.config.muxTokenSecret,
      muxAssetPolicy: {
        maxResolutionTier: params.config.muxMaxResolutionTier,
        videoQuality: params.config.muxVideoQuality,
        playbackPolicy: ["public"]
      }
    },
    params.muxClient
  );
  const uploadLifecycle = new UploadLifecycleService(store, muxVideoService);

  await app.register(cors, { origin: true });
  await app.register(multipart);

  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const rawBody = typeof body === "string" ? body : body.toString("utf-8");
    request.rawBody = rawBody;
    try {
      done(null, JSON.parse(rawBody));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  app.get("/health", async () => ({ ok: true }));
  await registerUploadRoutes(app, { uploadLifecycle });
  await registerFeedRoutes(app, { store });
  await registerWebhookRoutes(app, {
    muxWebhookSecret: params.config.muxWebhookSecret,
    uploadLifecycle
  });

  return app;
}
