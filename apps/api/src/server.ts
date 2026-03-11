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
import { registerTrustSafetyRoutes } from "./routes/trustSafety.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { registerObservabilityRoutes } from "./routes/observability.js";
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
import { RetentionPurgeService } from "./services/retentionPurgeService.js";
import { TrustSafetyService } from "./services/trustSafetyService.js";
import { NotificationService, type NotificationPushProvider } from "./services/notificationService.js";
import { ObservabilityService } from "./services/observabilityService.js";

export interface BuildServerParams {
  config: ApiConfig;
  store?: InMemoryVideoStore;
  muxClient?: MuxClient;
  dbClient?: DatabaseClient;
  smsProvider?: SmsProvider;
  notificationPushProvider?: NotificationPushProvider;
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
  const marketplaceService = new MarketplaceService(
    dbClient.sqlite,
    {
      offerSubmitPerUserPerHour: params.config.offerSubmitPerUserPerHour,
      offerDecisionPerSellerPerHour: params.config.offerDecisionPerSellerPerHour
    },
    params.now
  );
  const sellerSalesService = new SellerSalesService(dbClient.sqlite, params.now);
  const trustSafetyService = new TrustSafetyService(dbClient.sqlite, params.now);
  const notificationService = new NotificationService(dbClient.sqlite, {
    now: params.now,
    pushProvider: params.notificationPushProvider
  });
  const observabilityService = new ObservabilityService(dbClient.sqlite, params.now);
  const retentionPurgeService = new RetentionPurgeService(dbClient.sqlite, params.now);
  let retentionTimer: ReturnType<typeof setInterval> | undefined;

  if (params.config.retentionPurgeEnabled) {
    retentionTimer = setInterval(() => {
      try {
        const purgeResult = retentionPurgeService.runDuePurge();
        const metrics = retentionPurgeService.getMetrics();
        app.log.info(
          {
            purgedOfferAddresses: purgeResult.purgedOfferAddresses,
            purgedSellerSalesPii: purgeResult.purgedSellerSalesPii,
            purgedAuditEvents: purgeResult.purgedAuditEvents,
            dueOfferAddressPurges: metrics.dueOfferAddressPurges,
            offerBacklogAgeMs: metrics.offerBacklogAgeMs,
            offerBacklogSlaBreached: metrics.offerBacklogSlaBreached
          },
          "Retention purge run completed"
        );
        if (metrics.offerBacklogSlaBreached) {
          app.log.warn(
            { offerBacklogAgeMs: metrics.offerBacklogAgeMs },
            "Retention purge backlog breached 24h SLA"
          );
        }
      } catch (error) {
        app.log.error({ err: error }, "Retention purge run failed");
      }
    }, params.config.retentionPurgeIntervalSec * 1000);
    retentionTimer.unref();
  }

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

  app.addHook("onRequest", async (request) => {
    request.receivedAtMs = Date.now();
  });

  app.addHook("onResponse", async (request, reply) => {
    const receivedAtMs = request.receivedAtMs ?? Date.now();
    const routePattern = request.routeOptions.url ?? request.url.split("?")[0] ?? "unknown";
    observabilityService.recordRequestMetric({
      method: request.method,
      routePattern,
      statusCode: reply.statusCode,
      durationMs: Date.now() - receivedAtMs
    });
  });

  app.get("/health", async () => ({ ok: true }));
  await registerUploadRoutes(app, { uploadLifecycle });
  await registerFeedRoutes(app, { store, authService, notificationService });
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
  await registerTrustSafetyRoutes(app, {
    authService,
    trustSafetyService
  });
  await registerNotificationRoutes(app, {
    authService,
    notificationService
  });
  await registerObservabilityRoutes(app, {
    authService,
    observabilityService
  });
  await registerMarketplaceRoutes(app, {
    authService,
    marketSessionService: marketplaceService,
    listingMutationService: marketplaceService,
    notificationService
  });
  await registerWebhookRoutes(app, {
    muxWebhookSecret: params.config.muxWebhookSecret,
    uploadLifecycle
  });

  app.addHook("onClose", async () => {
    if (retentionTimer) {
      clearInterval(retentionTimer);
    }
    dbClient.close();
  });

  return app;
}
