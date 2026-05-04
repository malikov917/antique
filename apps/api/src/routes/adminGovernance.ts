import type {
  AdminAllowlistResponse,
  AddAdminAllowlistRequest,
  AddAdminAllowlistResponse,
  RemoveAdminAllowlistResponse
} from "@antique/types";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AuthError } from "../auth/errors.js";
import { requireAdminRole } from "../auth/guards.js";
import { type AuthService } from "../services/authService.js";

interface AdminGovernanceRouteDeps {
  authService: AuthService;
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

function assertOnlySupportedKeys(body: Record<string, unknown>, allowedKeys: string[]): void {
  const keys = Object.keys(body);
  const invalidKey = keys.find((key) => !allowedKeys.includes(key));
  if (invalidKey) {
    throw new AuthError("invalid_request", `Unsupported field: ${invalidKey}`, 400);
  }
}

export async function registerAdminGovernanceRoutes(
  app: FastifyInstance,
  deps: AdminGovernanceRouteDeps
): Promise<void> {
  app.get<{ Reply: AdminAllowlistResponse }>("/v1/admin/allowlist", async (request, reply) => {
    try {
      const auth = await deps.authService.authenticateFromAuthorizationHeader(
        getAuthorizationHeader(request)
      );
      requireAdminRole(auth.user);

      const entries = deps.authService.listAdminAllowlist();
      return {
        entries: entries.map((entry) => ({
          phoneE164: entry.phoneE164,
          createdAt: new Date(entry.createdAt).toISOString()
        }))
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      throw error;
    }
  });

  app.post<{ Body: AddAdminAllowlistRequest; Reply: AddAdminAllowlistResponse }>(
    "/v1/admin/allowlist",
    async (request, reply) => {
      try {
        const auth = await deps.authService.authenticateFromAuthorizationHeader(
          getAuthorizationHeader(request)
        );
        requireAdminRole(auth.user);

        const body = assertObjectBody(request.body);
        assertOnlySupportedKeys(body, ["phoneE164"]);
        if (typeof body.phoneE164 !== "string" || !body.phoneE164) {
          throw new AuthError("invalid_request", "phoneE164 is required and must be a string", 400);
        }

        const entry = deps.authService.addAdminAllowlistEntry({ phoneE164: body.phoneE164 });
        return {
          entry: {
            phoneE164: entry.phoneE164,
            createdAt: new Date(entry.createdAt).toISOString()
          }
        };
      } catch (error) {
        if (error instanceof AuthError) {
          return sendAuthError(reply, error);
        }
        throw error;
      }
    }
  );

  app.delete<{ Params: { phoneE164: string }; Reply: RemoveAdminAllowlistResponse }>(
    "/v1/admin/allowlist/:phoneE164",
    async (request, reply) => {
      try {
        const auth = await deps.authService.authenticateFromAuthorizationHeader(
          getAuthorizationHeader(request)
        );
        requireAdminRole(auth.user);

        const removed = deps.authService.removeAdminAllowlistEntry(request.params.phoneE164);
        return { removed };
      } catch (error) {
        if (error instanceof AuthError) {
          return sendAuthError(reply, error);
        }
        throw error;
      }
    }
  );
}
