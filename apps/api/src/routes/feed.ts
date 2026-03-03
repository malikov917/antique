import type { FeedResponse } from "@antique/types";
import type { FastifyInstance } from "fastify";
import type { InMemoryVideoStore } from "../domain/store.js";

export async function registerFeedRoutes(
  app: FastifyInstance,
  deps: { store: InMemoryVideoStore }
): Promise<void> {
  app.get("/v1/feed", async () => {
    const response: FeedResponse = {
      items: deps.store.allReadyFeedItems(),
      nextCursor: undefined
    };
    return response;
  });
}
