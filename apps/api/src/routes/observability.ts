import type { FastifyInstance, FastifyReply } from "fastify";
import { AuthError } from "../auth/errors.js";
import type { AuthService } from "../services/authService.js";
import type { ObservabilityService } from "../services/observabilityService.js";

interface ObservabilityRouteDeps {
  authService: AuthService;
  observabilityService: ObservabilityService;
}

function sendAuthError(reply: FastifyReply, error: AuthError): ReturnType<FastifyReply["send"]> {
  return reply.code(error.statusCode).send({
    error: error.message,
    code: error.code,
    retryAfterSec: error.retryAfterSec
  });
}

export async function registerObservabilityRoutes(
  app: FastifyInstance,
  deps: ObservabilityRouteDeps
): Promise<void> {
  app.get("/v1/admin/observability/summary", async (request, reply) => {
    try {
      const authorization = request.headers.authorization;
      if (!authorization || Array.isArray(authorization)) {
        throw new AuthError("missing_access_token", "Authorization header is required", 401);
      }
      const auth = await deps.authService.authenticateFromAuthorizationHeader(authorization);
      if (auth.user.activeRole !== "admin") {
        throw new AuthError("forbidden_role", "Admin role is required", 403);
      }

      const query = (request.query ?? {}) as { windowHours?: string | number };
      const rawWindow = typeof query.windowHours === "number"
        ? query.windowHours
        : query.windowHours === undefined
          ? undefined
          : Number.parseInt(query.windowHours, 10);
      const windowHours = Number.isFinite(rawWindow) ? (rawWindow as number) : 24;

      return deps.observabilityService.getSummary(windowHours);
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      throw error;
    }
  });
}
