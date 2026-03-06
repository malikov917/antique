import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { InMemoryVideoStore } from "./domain/store.js";
import { registerFeedRoutes } from "./routes/feed.js";
import { registerUploadRoutes } from "./routes/uploads.js";
import { registerWebhookRoutes } from "./routes/webhook.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerSellerRoutes } from "./routes/seller.js";
import { registerMeRoutes } from "./routes/me.js";
import { registerMarketplaceRoutes } from "./routes/marketplace.js";
import { type ApiConfig } from "./config.js";
import { createDatabaseClient, type DatabaseClient } from "./db/client.js";
import { initializeDatabase } from "./db/init.js";
import { UploadLifecycleService } from "./services/uploadLifecycle.js";
import { MuxVideoService, type MuxClient } from "./services/videoProvider.js";
import { AuthService, type SmsProvider } from "./services/authService.js";
import { LoggingSmsProvider } from "./services/smsProvider.js";
import { SellerApplicationService } from "./services/sellerApplicationService.js";
import { MarketplaceService } from "./services/marketplaceService.js";
import { SellerSalesService } from "./services/sellerSalesService.js";

export interface BuildServerParams {
  config: ApiConfig;
  store?: InMemoryVideoStore;
  muxClient?: MuxClient;
  dbClient?: DatabaseClient;
  smsProvider?: SmsProvider;
  now?: () => number;
}

export async function buildServer(params: BuildServerParams): Promise<FastifyInstance> {
  const app = Fastify({
    logger: true
  });

  const store = params.store ?? new InMemoryVideoStore();
  store.seedDemoItems(params.config.demoPlaybackIds);
  const dbClient = params.dbClient ?? createDatabaseClient(params.config.dbPath);
  initializeDatabase(dbClient.sqlite);

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
  const smsProvider = params.smsProvider ?? new LoggingSmsProvider(app.log);
  const authService = new AuthService(
    dbClient.sqlite,
    {
      authJwtSecret: params.config.authJwtSecret,
      authHashSecret: params.config.authHashSecret,
      authAccessTokenTtlSec: params.config.authAccessTokenTtlSec,
      authRefreshTokenTtlSec: params.config.authRefreshTokenTtlSec,
      authOtpTtlSec: params.config.authOtpTtlSec,
      authOtpMaxAttempts: params.config.authOtpMaxAttempts,
      authOtpCooldownSec: params.config.authOtpCooldownSec,
      authOtpRequestPerPhonePerHour: params.config.authOtpRequestPerPhonePerHour,
      authOtpVerifyPerPhoneIpPerHour: params.config.authOtpVerifyPerPhoneIpPerHour
    },
    smsProvider,
    params.now
  );
  const sellerApplicationService = new SellerApplicationService(dbClient.sqlite, params.now);
  const marketplaceService = new MarketplaceService(dbClient.sqlite, params.now);
  const sellerSalesService = new SellerSalesService(dbClient.sqlite, params.now);

  await app.register(cors, { origin: true });
  await app.register(multipart);
  await app.register(rateLimit, { global: false });

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
  await registerAuthRoutes(app, {
    authService,
    otpRequestIpRateLimitMax: params.config.authOtpRequestPerIpPerHour,
    otpVerifyIpRateLimitMax: params.config.authOtpVerifyPerPhoneIpPerHour
  });
  await registerMeRoutes(app, { authService });
  await registerSellerRoutes(app, {
    authService,
    sellerApplicationService,
    sellerSalesService
  });
  await registerMarketplaceRoutes(app, {
    authService,
    marketplaceService
  });
  await registerWebhookRoutes(app, {
    muxWebhookSecret: params.config.muxWebhookSecret,
    uploadLifecycle
  });

  app.addHook("onClose", async () => {
    dbClient.close();
  });

  return app;
}
