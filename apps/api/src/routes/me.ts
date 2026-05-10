import type {
  BuyerStatusResponse,
  MeResponse,
  MeStatsResponse,
  RoleSwitchRequest,
  RoleSwitchResponse,
  UpdateMeRequest
} from "@antique/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Database } from "better-sqlite3";
import { AuthError } from "../auth/errors.js";
import { requireRoleAllowed } from "../auth/guards.js";
import { type AuthService } from "../services/authService.js";

interface MeRouteDeps {
  authService: AuthService;
  sqlite?: Database;
}

function sendAuthError(reply: FastifyReply, error: AuthError): ReturnType<FastifyReply["send"]> {
  return reply.code(error.statusCode).send({
    error: error.message,
    code: error.code,
    retryAfterSec: error.retryAfterSec
  });
}

function assertObjectBody(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    throw new AuthError("invalid_request", "Request body must be an object", 400);
  }
  return payload as Record<string, unknown>;
}

function getAuthorizationHeader(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (Array.isArray(header)) {
    throw new AuthError("invalid_authorization", "Authorization header must be a single value", 401);
  }
  return header;
}

function assertOnlySupportedKeys(body: Record<string, unknown>, allowedKeys: string[]): void {
  const keys = Object.keys(body);
  const invalidKey = keys.find((key) => !allowedKeys.includes(key));
  if (invalidKey) {
    throw new AuthError("invalid_request", `Unsupported field: ${invalidKey}`, 400);
  }
}

export async function registerMeRoutes(app: FastifyInstance, deps: MeRouteDeps): Promise<void> {
  app.get<{ Reply: MeResponse }>("/v1/me", async (request, reply) => {
    try {
      const auth = await deps.authService.authenticateFromAuthorizationHeader(getAuthorizationHeader(request));
      return { user: deps.authService.getMe(auth.user.id) };
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      throw error;
    }
  });

  app.patch<{ Body: UpdateMeRequest; Reply: MeResponse }>("/v1/me", async (request, reply) => {
    try {
      const auth = await deps.authService.authenticateFromAuthorizationHeader(getAuthorizationHeader(request));
      const body = assertObjectBody(request.body);
      assertOnlySupportedKeys(body, ["displayName", "paymentInfo"]);
      if (body.displayName !== undefined && body.displayName !== null && typeof body.displayName !== "string") {
        throw new AuthError("invalid_display_name", "Display name must be a string or null", 400);
      }
      if (body.paymentInfo !== undefined && body.paymentInfo !== null && typeof body.paymentInfo !== "string") {
        throw new AuthError("invalid_payment_info", "Payment info must be a string or null", 400);
      }

      return {
        user: deps.authService.updateMe({
          userId: auth.user.id,
          displayName: body.displayName as string | null | undefined,
          paymentInfo: body.paymentInfo as string | null | undefined
        })
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      throw error;
    }
  });

  app.post<{ Body: RoleSwitchRequest; Reply: RoleSwitchResponse }>(
    "/v1/me/role-switch",
    async (request, reply) => {
      try {
        const auth = await deps.authService.authenticateFromAuthorizationHeader(
          getAuthorizationHeader(request)
        );
        const body = assertObjectBody(request.body);
        assertOnlySupportedKeys(body, ["role"]);
        if (body.role !== "buyer" && body.role !== "seller" && body.role !== "admin") {
          throw new AuthError("invalid_role", "Role must be buyer, seller, or admin", 400);
        }

        requireRoleAllowed(auth.user, body.role);

        return {
          user: deps.authService.switchRole({
            userId: auth.user.id,
            role: body.role
          })
        };
      } catch (error) {
        if (error instanceof AuthError) {
          return sendAuthError(reply, error);
        }
        throw error;
      }
    }
  );

  app.get<{ Reply: BuyerStatusResponse }>("/v1/me/buyer-status", async (request, reply) => {
    try {
      const auth = await deps.authService.authenticateFromAuthorizationHeader(getAuthorizationHeader(request));
      const basketListingIds: string[] = [];
      const offerListingIds: string[] = [];
      if (deps.sqlite) {
        const basketRows = deps.sqlite
          .prepare("SELECT listing_id FROM basket_items WHERE buyer_user_id = ?")
          .all(auth.user.id) as Array<{ listing_id: string }>;
        basketListingIds.push(...basketRows.map((r) => r.listing_id));

        const offerRows = deps.sqlite
          .prepare("SELECT listing_id FROM offers WHERE buyer_user_id = ? AND status = 'submitted'")
          .all(auth.user.id) as Array<{ listing_id: string }>;
        offerListingIds.push(...offerRows.map((r) => r.listing_id));
      }
      return {
        basketListingIds,
        offerListingIds
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      throw error;
    }
  });

  app.get<{ Reply: MeStatsResponse }>("/v1/me/stats", async (request, reply) => {
    try {
      const auth = await deps.authService.authenticateFromAuthorizationHeader(getAuthorizationHeader(request));
      let offersMade = 0;
      let dealsWon = 0;
      let itemsInBasket = 0;
      let listingsCreated = 0;
      let listingsSold = 0;
      let sessionsHeld = 0;

      if (deps.sqlite) {
        const offersRow = deps.sqlite
          .prepare("SELECT COUNT(*) AS count FROM offers WHERE buyer_user_id = ?")
          .get(auth.user.id) as { count: number } | undefined;
        offersMade = offersRow?.count ?? 0;

        const dealsRow = deps.sqlite
          .prepare("SELECT COUNT(*) AS count FROM deals WHERE buyer_user_id = ?")
          .get(auth.user.id) as { count: number } | undefined;
        dealsWon = dealsRow?.count ?? 0;

        const basketRow = deps.sqlite
          .prepare("SELECT COUNT(*) AS count FROM basket_items WHERE buyer_user_id = ?")
          .get(auth.user.id) as { count: number } | undefined;
        itemsInBasket = basketRow?.count ?? 0;

        const listingsRow = deps.sqlite
          .prepare("SELECT COUNT(*) AS count FROM listings WHERE seller_user_id = ?")
          .get(auth.user.id) as { count: number } | undefined;
        listingsCreated = listingsRow?.count ?? 0;

        const salesRow = deps.sqlite
          .prepare("SELECT COUNT(*) AS count FROM seller_sales WHERE seller_user_id = ?")
          .get(auth.user.id) as { count: number } | undefined;
        listingsSold = salesRow?.count ?? 0;

        const sessionsRow = deps.sqlite
          .prepare("SELECT COUNT(*) AS count FROM market_sessions WHERE seller_user_id = ?")
          .get(auth.user.id) as { count: number } | undefined;
        sessionsHeld = sessionsRow?.count ?? 0;
      }

      return {
        buyerStats: {
          offersMade,
          dealsWon,
          itemsInBasket
        },
        sellerStats: {
          listingsCreated,
          listingsSold,
          sessionsHeld
        }
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      throw error;
    }
  });
}
