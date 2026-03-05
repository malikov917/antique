import type {
  MeResponse,
  RoleSwitchRequest,
  RoleSwitchResponse,
  UpdateMeRequest
} from "@antique/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError } from "../auth/errors.js";
import { requireRoleAllowed } from "../auth/guards.js";
import { type AuthService } from "../services/authService.js";

interface MeRouteDeps {
  authService: AuthService;
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
      assertOnlySupportedKeys(body, ["displayName"]);
      if (body.displayName !== undefined && body.displayName !== null && typeof body.displayName !== "string") {
        throw new AuthError("invalid_display_name", "Display name must be a string or null", 400);
      }

      return {
        user: deps.authService.updateMe({
          userId: auth.user.id,
          displayName: body.displayName as string | null | undefined
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
}
