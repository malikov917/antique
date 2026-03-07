import type {
  BlockUserResponse,
  FlagListingModerationRequest,
  FlagListingModerationResponse,
  ReportUserRequest,
  ReportUserResponse,
  SuspendSellerRequest,
  SuspendSellerResponse
} from "@antique/types";
import type { FastifyInstance, FastifyReply } from "fastify";
import { AuthError } from "../auth/errors.js";
import { type AuthService } from "../services/authService.js";
import { TrustSafetyService } from "../services/trustSafetyService.js";

interface TrustSafetyRouteDeps {
  authService: AuthService;
  trustSafetyService: TrustSafetyService;
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

export async function registerTrustSafetyRoutes(
  app: FastifyInstance,
  deps: TrustSafetyRouteDeps
): Promise<void> {
  app.post<{ Params: { id: string }; Reply: BlockUserResponse }>("/v1/users/:id/block", async (request, reply) => {
    try {
      const auth = await deps.authService.authenticateFromAuthorizationHeader(request.headers.authorization);
      const targetUserId = request.params.id?.trim();
      if (!targetUserId) {
        throw new AuthError("invalid_request", "id route parameter is required", 400);
      }
      return deps.trustSafetyService.blockUser({
        actorUserId: auth.user.id,
        targetUserId
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      throw error;
    }
  });

  app.post<{ Params: { id: string }; Body: ReportUserRequest; Reply: ReportUserResponse }>(
    "/v1/users/:id/report",
    async (request, reply) => {
      try {
        const auth = await deps.authService.authenticateFromAuthorizationHeader(request.headers.authorization);
        const targetUserId = request.params.id?.trim();
        if (!targetUserId) {
          throw new AuthError("invalid_request", "id route parameter is required", 400);
        }

        const body = assertObjectBody(request.body);
        if (typeof body.reason !== "string") {
          throw new AuthError("invalid_request", "reason is required", 400);
        }
        if (body.details !== undefined && typeof body.details !== "string") {
          throw new AuthError("invalid_request", "details must be a string", 400);
        }

        return deps.trustSafetyService.reportUser({
          actorUserId: auth.user.id,
          targetUserId,
          reason: body.reason,
          details: typeof body.details === "string" ? body.details : undefined,
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

  app.post<{ Params: { userId: string }; Body: SuspendSellerRequest; Reply: SuspendSellerResponse }>(
    "/v1/admin/sellers/:userId/suspend",
    async (request, reply) => {
      try {
        const auth = await deps.authService.authenticateFromAuthorizationHeader(request.headers.authorization);
        if (auth.user.activeRole !== "admin") {
          throw new AuthError("forbidden_role", "Admin role is required", 403);
        }

        const targetUserId = request.params.userId?.trim();
        if (!targetUserId) {
          throw new AuthError("invalid_request", "userId route parameter is required", 400);
        }

        const body = assertObjectBody(request.body ?? {});
        if (body.reason !== undefined && typeof body.reason !== "string") {
          throw new AuthError("invalid_request", "reason must be a string", 400);
        }

        return deps.trustSafetyService.suspendSeller({
          actorUserId: auth.user.id,
          targetUserId,
          reason: typeof body.reason === "string" ? body.reason : undefined,
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

  app.post<{
    Params: { id: string };
    Body: FlagListingModerationRequest;
    Reply: FlagListingModerationResponse;
  }>("/v1/admin/listings/:id/moderation-flags", async (request, reply) => {
    try {
      const auth = await deps.authService.authenticateFromAuthorizationHeader(request.headers.authorization);
      if (auth.user.activeRole !== "admin") {
        throw new AuthError("forbidden_role", "Admin role is required", 403);
      }

      const listingId = request.params.id?.trim();
      if (!listingId) {
        throw new AuthError("invalid_request", "id route parameter is required", 400);
      }

      const body = assertObjectBody(request.body);
      if (typeof body.reasonCode !== "string") {
        throw new AuthError("invalid_request", "reasonCode is required", 400);
      }
      if (body.note !== undefined && typeof body.note !== "string") {
        throw new AuthError("invalid_request", "note must be a string", 400);
      }

      return deps.trustSafetyService.flagListing({
        actorUserId: auth.user.id,
        listingId,
        reasonCode: body.reasonCode,
        note: typeof body.note === "string" ? body.note : undefined,
        requestIp: request.ip
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      throw error;
    }
  });
}
