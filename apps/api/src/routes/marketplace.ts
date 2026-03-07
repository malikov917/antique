import type {
  AcceptOfferResponse,
  CloseMarketSessionResponse,
  CreateBasketResponse,
  CreateOfferRequest,
  DeclineOfferResponse,
  CreateOfferResponse,
  OpenMarketSessionResponse,
  SellerListingOffersResponse
} from "@antique/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError } from "../auth/errors.js";
import { requireBuyerRole, requireSellerRole } from "../auth/guards.js";
import { type AuthService } from "../services/authService.js";
import type {
  ListingMutationDomainService,
  MarketSessionDomainService
} from "../domain/marketplace/contracts.js";

interface MarketplaceRouteDeps {
  authService: AuthService;
  marketSessionService: MarketSessionDomainService;
  listingMutationService: ListingMutationDomainService;
}

function sendAuthError(reply: FastifyReply, error: AuthError): ReturnType<FastifyReply["send"]> {
  return reply.code(error.statusCode).send({
    error: error.message,
    code: error.code,
    retryAfterSec: error.retryAfterSec
  });
}

function getAuthorizationHeader(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (Array.isArray(header)) {
    throw new AuthError("invalid_authorization", "Authorization header must be a single value", 401);
  }
  return header;
}

function assertObjectBody(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    throw new AuthError("invalid_request", "Request body must be an object", 400);
  }
  return payload as Record<string, unknown>;
}

export async function registerMarketplaceRoutes(
  app: FastifyInstance,
  deps: MarketplaceRouteDeps
): Promise<void> {
  app.post<{ Reply: OpenMarketSessionResponse }>("/v1/seller/sessions/open", async (request, reply) => {
    try {
      const auth = await deps.authService.authenticateFromAuthorizationHeader(
        getAuthorizationHeader(request)
      );
      requireSellerRole(auth.user);

      return {
        session: deps.marketSessionService.openMarketSession(auth.user.id)
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      throw error;
    }
  });

  app.post<{ Params: { id: string }; Reply: CloseMarketSessionResponse }>(
    "/v1/seller/sessions/:id/close",
    async (request, reply) => {
      try {
        const auth = await deps.authService.authenticateFromAuthorizationHeader(
          getAuthorizationHeader(request)
        );
        requireSellerRole(auth.user);

        return deps.marketSessionService.closeMarketSession({
          sellerUserId: auth.user.id,
          sessionId: request.params.id
        });
      } catch (error) {
        if (error instanceof AuthError) {
          return sendAuthError(reply, error);
        }
        throw error;
      }
    }
  );

  app.post<{ Params: { id: string }; Reply: CreateBasketResponse }>(
    "/v1/listings/:id/basket",
    async (request, reply) => {
      try {
        const auth = await deps.authService.authenticateFromAuthorizationHeader(
          getAuthorizationHeader(request)
        );
        requireBuyerRole(auth.user);

        return {
          basketItem: deps.listingMutationService.createBasketItem({
            buyerUserId: auth.user.id,
            listingId: request.params.id
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

  app.post<{ Params: { id: string }; Body: CreateOfferRequest; Reply: CreateOfferResponse }>(
    "/v1/listings/:id/offers",
    async (request, reply) => {
      try {
        const auth = await deps.authService.authenticateFromAuthorizationHeader(
          getAuthorizationHeader(request)
        );
        requireBuyerRole(auth.user);
        const body = assertObjectBody(request.body);

        if (!Number.isInteger(body.amountCents) || (body.amountCents as number) <= 0) {
          throw new AuthError("invalid_request", "amountCents must be a positive integer", 400);
        }
        if (typeof body.shippingAddress !== "string" || !body.shippingAddress.trim()) {
          throw new AuthError("invalid_request", "shippingAddress is required", 400);
        }

        return {
          offer: deps.listingMutationService.createOffer({
            buyerUserId: auth.user.id,
            listingId: request.params.id,
            amountCents: body.amountCents as number,
            shippingAddress: body.shippingAddress.trim(),
            requestIp: request.ip
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

  app.get<{ Params: { id: string }; Reply: SellerListingOffersResponse }>(
    "/v1/seller/listings/:id/offers",
    async (request, reply) => {
      try {
        const auth = await deps.authService.authenticateFromAuthorizationHeader(
          getAuthorizationHeader(request)
        );
        requireSellerRole(auth.user);

        return {
          offers: deps.listingMutationService.listSellerListingOffers({
            sellerUserId: auth.user.id,
            listingId: request.params.id
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

  app.post<{ Params: { id: string }; Reply: AcceptOfferResponse }>(
    "/v1/offers/:id/accept",
    async (request, reply) => {
      try {
        const auth = await deps.authService.authenticateFromAuthorizationHeader(
          getAuthorizationHeader(request)
        );
        requireSellerRole(auth.user);

        return deps.listingMutationService.acceptOffer({
          sellerUserId: auth.user.id,
          offerId: request.params.id,
          requestIp: request.ip
        });
      } catch (error) {
        if (error instanceof AuthError) {
          return sendAuthError(reply, error);
        }
        throw error;
      }
    }
  );

  app.post<{ Params: { id: string }; Reply: DeclineOfferResponse }>(
    "/v1/offers/:id/decline",
    async (request, reply) => {
      try {
        const auth = await deps.authService.authenticateFromAuthorizationHeader(
          getAuthorizationHeader(request)
        );
        requireSellerRole(auth.user);

        return {
          offer: deps.listingMutationService.declineOffer({
            sellerUserId: auth.user.id,
            offerId: request.params.id,
            requestIp: request.ip
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
}
