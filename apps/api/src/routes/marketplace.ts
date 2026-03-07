import type {
  AcceptOfferResponse,
  ChatMessagesResponse,
  ChatsResponse,
  CloseMarketSessionResponse,
  CreateListingRequest,
  CreateListingResponse,
  CreateBasketResponse,
  CreateOfferRequest,
  DeclineOfferResponse,
  DealsMeResponse,
  CreateOfferResponse,
  SendChatMessageRequest,
  SendChatMessageResponse,
  UpdateDealStatusRequest,
  UpdateDealStatusResponse,
  OpenMarketSessionResponse,
  SellerListingOffersResponse,
  UpdateListingRequest,
  UpdateListingResponse
} from "@antique/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError } from "../auth/errors.js";
import { requireBuyerRole, requireSellerRole } from "../auth/guards.js";
import { type AuthService } from "../services/authService.js";
import type {
  ListingMutationDomainService,
  MarketSessionDomainService
} from "../domain/marketplace/contracts.js";
import type { NotificationService } from "../services/notificationService.js";

interface MarketplaceRouteDeps {
  authService: AuthService;
  marketSessionService: MarketSessionDomainService;
  listingMutationService: ListingMutationDomainService;
  notificationService?: NotificationService;
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

        const session = deps.marketSessionService.openMarketSession(auth.user.id);
        deps.notificationService?.onSessionStateChanged({
          sessionId: session.id,
          sellerUserId: auth.user.id,
          state: "opened",
          requestIp: request.ip
        });
        return {
          session
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

        const result = deps.marketSessionService.closeMarketSession({
          sellerUserId: auth.user.id,
          sessionId: request.params.id
        });
        deps.notificationService?.onSessionStateChanged({
          sessionId: result.session.id,
          sellerUserId: auth.user.id,
          state: "closed",
          requestIp: request.ip
        });
        return result;
      } catch (error) {
        if (error instanceof AuthError) {
          return sendAuthError(reply, error);
        }
        throw error;
      }
    }
  );

  app.post<{ Body: CreateListingRequest; Reply: CreateListingResponse }>(
    "/v1/listings",
    async (request, reply) => {
      try {
        const auth = await deps.authService.authenticateFromAuthorizationHeader(
          getAuthorizationHeader(request)
        );
        requireSellerRole(auth.user);
        const body = assertObjectBody(request.body);

        if (typeof body.title !== "string" || !body.title.trim()) {
          throw new AuthError("invalid_request", "title is required", 400);
        }
        if (!Number.isInteger(body.listedPriceCents) || (body.listedPriceCents as number) <= 0) {
          throw new AuthError("invalid_request", "listedPriceCents must be a positive integer", 400);
        }
        if (body.description !== undefined && typeof body.description !== "string") {
          throw new AuthError("invalid_request", "description must be a string", 400);
        }
        if (body.currency !== undefined && typeof body.currency !== "string") {
          throw new AuthError("invalid_request", "currency must be a string", 400);
        }

        return {
          listing: deps.listingMutationService.createListing({
            sellerUserId: auth.user.id,
            title: body.title.trim(),
            description: (body.description as string | undefined)?.trim() ?? "",
            listedPriceCents: body.listedPriceCents as number,
            currency: ((body.currency as string | undefined) ?? "USD").trim().toUpperCase()
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

  app.patch<{ Params: { id: string }; Body: UpdateListingRequest; Reply: UpdateListingResponse }>(
    "/v1/listings/:id",
    async (request, reply) => {
      try {
        const auth = await deps.authService.authenticateFromAuthorizationHeader(
          getAuthorizationHeader(request)
        );
        requireSellerRole(auth.user);
        const body = assertObjectBody(request.body);

        if (
          body.title === undefined &&
          body.description === undefined &&
          body.listedPriceCents === undefined &&
          body.currency === undefined
        ) {
          throw new AuthError("invalid_request", "At least one listing field must be provided", 400);
        }
        if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim())) {
          throw new AuthError("invalid_request", "title must be a non-empty string", 400);
        }
        if (body.description !== undefined && typeof body.description !== "string") {
          throw new AuthError("invalid_request", "description must be a string", 400);
        }
        if (
          body.listedPriceCents !== undefined &&
          (!Number.isInteger(body.listedPriceCents) || (body.listedPriceCents as number) <= 0)
        ) {
          throw new AuthError("invalid_request", "listedPriceCents must be a positive integer", 400);
        }
        if (body.currency !== undefined && typeof body.currency !== "string") {
          throw new AuthError("invalid_request", "currency must be a string", 400);
        }

        return {
          listing: deps.listingMutationService.updateListing({
            sellerUserId: auth.user.id,
            listingId: request.params.id,
            title: typeof body.title === "string" ? body.title.trim() : undefined,
            description: typeof body.description === "string" ? body.description.trim() : undefined,
            listedPriceCents:
              typeof body.listedPriceCents === "number" ? body.listedPriceCents : undefined,
            currency:
              typeof body.currency === "string" ? body.currency.trim().toUpperCase() : undefined
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

        const offer = deps.listingMutationService.createOffer({
          buyerUserId: auth.user.id,
          listingId: request.params.id,
          amountCents: body.amountCents as number,
          shippingAddress: body.shippingAddress.trim(),
          requestIp: request.ip
        });
        deps.notificationService?.onOfferSubmitted({
          offerId: offer.id,
          listingId: request.params.id,
          buyerUserId: auth.user.id,
          requestIp: request.ip
        });
        return {
          offer
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

        const result = deps.listingMutationService.acceptOffer({
          sellerUserId: auth.user.id,
          offerId: request.params.id,
          requestIp: request.ip
        });
        deps.notificationService?.onOfferDecision({
          offerId: request.params.id,
          sellerUserId: auth.user.id,
          decision: "accepted",
          requestIp: request.ip
        });
        return result;
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

        const offer = deps.listingMutationService.declineOffer({
          sellerUserId: auth.user.id,
          offerId: request.params.id,
          requestIp: request.ip
        });
        deps.notificationService?.onOfferDecision({
          offerId: request.params.id,
          sellerUserId: auth.user.id,
          decision: "declined",
          requestIp: request.ip
        });
        return {
          offer
        };
      } catch (error) {
        if (error instanceof AuthError) {
          return sendAuthError(reply, error);
        }
        throw error;
      }
    }
  );

  app.get<{ Reply: DealsMeResponse }>("/v1/deals/me", async (request, reply) => {
    try {
      const auth = await deps.authService.authenticateFromAuthorizationHeader(
        getAuthorizationHeader(request)
      );

      return {
        deals: deps.listingMutationService.listDealsForUser({
          userId: auth.user.id
        })
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      throw error;
    }
  });

  app.patch<{ Params: { id: string }; Body: UpdateDealStatusRequest; Reply: UpdateDealStatusResponse }>(
    "/v1/deals/:id/status",
    async (request, reply) => {
      try {
        const auth = await deps.authService.authenticateFromAuthorizationHeader(
          getAuthorizationHeader(request)
        );
        const body = assertObjectBody(request.body);
        const status = body.status;
        if (status !== "paid" && status !== "completed" && status !== "canceled") {
          throw new AuthError(
            "invalid_request",
            "status must be one of: paid, completed, canceled",
            400
          );
        }

        return {
          deal: deps.listingMutationService.updateDealStatus({
            userId: auth.user.id,
            dealId: request.params.id,
            status
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

  app.get<{ Reply: ChatsResponse }>("/v1/chats", async (request, reply) => {
    try {
      const auth = await deps.authService.authenticateFromAuthorizationHeader(
        getAuthorizationHeader(request)
      );

      return {
        chats: deps.listingMutationService.listChatsForUser({
          userId: auth.user.id
        })
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      throw error;
    }
  });

  app.get<{ Params: { id: string }; Reply: ChatMessagesResponse }>(
    "/v1/chats/:id/messages",
    async (request, reply) => {
      try {
        const auth = await deps.authService.authenticateFromAuthorizationHeader(
          getAuthorizationHeader(request)
        );

        return {
          messages: deps.listingMutationService.listChatMessages({
            userId: auth.user.id,
            chatId: request.params.id
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

  app.post<{ Params: { id: string }; Body: SendChatMessageRequest; Reply: SendChatMessageResponse }>(
    "/v1/chats/:id/messages",
    async (request, reply) => {
      try {
        const auth = await deps.authService.authenticateFromAuthorizationHeader(
          getAuthorizationHeader(request)
        );
        const body = assertObjectBody(request.body);
        if (typeof body.text !== "string" || !body.text.trim()) {
          throw new AuthError("invalid_request", "text is required", 400);
        }

        return {
          message: deps.listingMutationService.createChatMessage({
            userId: auth.user.id,
            chatId: request.params.id,
            text: body.text.trim()
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
