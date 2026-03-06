import type {
  SellerApplicationResponse,
  SellerApplyRequest,
  SellerApplyResponse
} from "@antique/types";
import type { FastifyInstance, FastifyReply } from "fastify";
import { AuthError } from "../auth/errors.js";
import { type AuthService } from "../services/authService.js";
import type {
  SellerApplicationDomainService,
  SellerSalesDomainService
} from "../domain/seller/contracts.js";

interface SellerRouteDeps {
  authService: AuthService;
  sellerApplicationService: SellerApplicationDomainService;
  sellerSalesService: SellerSalesDomainService;
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

function extractBearerToken(authorization: string | undefined): string {
  if (!authorization) {
    throw new AuthError("missing_access_token", "Authorization header is required", 401);
  }
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new AuthError("invalid_access_token", "Authorization must be Bearer token", 401);
  }
  return token;
}

export async function registerSellerRoutes(
  app: FastifyInstance,
  deps: SellerRouteDeps
): Promise<void> {
  app.get("/v1/seller/sales.csv", async (request, reply) => {
    try {
      const accessToken = extractBearerToken(request.headers.authorization);
      const user = await deps.authService.authenticateAccessToken(accessToken);
      const query = (request.query ?? {}) as { sellerUserId?: string };
      const result = deps.sellerSalesService.exportSalesCsv({
        actor: user,
        requestedSellerUserId: query.sellerUserId,
        requestIp: request.ip
      });

      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${result.fileName}"`)
        .send(result.csv);
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      throw error;
    }
  });

  app.get<{ Reply: SellerApplicationResponse }>("/v1/seller/application", async (request, reply) => {
    try {
      const accessToken = extractBearerToken(request.headers.authorization);
      const user = await deps.authService.authenticateAccessToken(accessToken);

      return {
        application: deps.sellerApplicationService.getForUser(user.id)
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      throw error;
    }
  });

  app.post<{ Body: SellerApplyRequest; Reply: SellerApplyResponse }>(
    "/v1/seller/apply",
    async (request, reply) => {
      try {
        const accessToken = extractBearerToken(request.headers.authorization);
        const user = await deps.authService.authenticateAccessToken(accessToken);
        if (user.activeRole !== "buyer") {
          throw new AuthError(
            "forbidden_role",
            "Only users in buyer role can submit seller applications",
            403
          );
        }

        const body = assertObjectBody(request.body);
        if (typeof body.fullName !== "string") {
          throw new AuthError("invalid_request", "fullName is required", 400);
        }
        if (typeof body.shopName !== "string") {
          throw new AuthError("invalid_request", "shopName is required", 400);
        }
        if (body.note !== undefined && typeof body.note !== "string") {
          throw new AuthError("invalid_request", "note must be a string", 400);
        }

        return {
          application: deps.sellerApplicationService.submit({
            userId: user.id,
            fullName: body.fullName,
            shopName: body.shopName,
            note: typeof body.note === "string" ? body.note : undefined
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
