import type { FeedResponse } from "@antique/types";
import type { FastifyInstance } from "fastify";
import type { InMemoryVideoStore } from "../domain/store.js";
import { AuthError } from "../auth/errors.js";
import type { AuthService } from "../services/authService.js";
import type { NotificationService } from "../services/notificationService.js";
import type { ListingQueryDomainService } from "../domain/marketplace/contracts.js";

export async function registerFeedRoutes(
  app: FastifyInstance,
  deps: {
    store: InMemoryVideoStore;
    listingQueryService: ListingQueryDomainService;
    authService?: AuthService;
    notificationService?: NotificationService;
  }
): Promise<void> {
  app.get("/v1/feed", async (request) => {
    const authorization = request.headers.authorization;
    if (deps.authService && deps.notificationService && authorization && !Array.isArray(authorization)) {
      try {
        const auth = await deps.authService.authenticateFromAuthorizationHeader(authorization);
        deps.notificationService.onFeedViewed({
          userId: auth.user.id,
          requestIp: request.ip
        });
      } catch (error) {
        if (!(error instanceof AuthError)) {
          throw error;
        }
      }
    }

    const marketplaceItems = deps.listingQueryService.listFeedItems();
    const items = marketplaceItems.length > 0 ? marketplaceItems : deps.store.allReadyFeedItems();

    const response: FeedResponse = {
      items,
      nextCursor: undefined
    };
    return response;
  });
}
