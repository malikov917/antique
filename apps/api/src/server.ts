import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { InMemoryVideoStore } from "./domain/store.js";
import { registerFeedRoutes } from "./routes/feed.js";
import { registerUploadRoutes } from "./routes/uploads.js";
import { registerWebhookRoutes } from "./routes/webhook.js";
import { type ApiConfig } from "./config.js";
import { createVideoProvider, type VideoProvider } from "./services/videoProvider.js";

export interface BuildServerParams {
  config: ApiConfig;
  store?: InMemoryVideoStore;
  videoProvider?: VideoProvider;
}

export async function buildServer(params: BuildServerParams): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true
  });

  const store = params.store ?? new InMemoryVideoStore();
  store.seedDemoItems(params.config.demoPlaybackIds);
  const videoProvider =
    params.videoProvider ??
    createVideoProvider({
      muxTokenId: params.config.muxTokenId,
      muxTokenSecret: params.config.muxTokenSecret,
      demoPlaybackIds: params.config.demoPlaybackIds
    });

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
  await registerUploadRoutes(app, { store, videoProvider });
  await registerFeedRoutes(app, { store });
  await registerWebhookRoutes(app, { store, muxWebhookSecret: params.config.muxWebhookSecret });

  return app;
}
