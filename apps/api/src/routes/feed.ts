import type { FeedResponse } from "@antique/types";
import type { FastifyInstance } from "fastify";
import type { InMemoryVideoStore } from "../domain/store.js";
import { AuthError } from "../auth/errors.js";
import type { AuthService } from "../services/authService.js";
import type { NotificationService } from "../services/notificationService.js";

export async function registerFeedRoutes(
  app: FastifyInstance,
  deps: {
    store: InMemoryVideoStore;
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

    const response: FeedResponse = {
      items: deps.store.allReadyFeedItems(),
      nextCursor: undefined
    };
    return response;
  });
}
