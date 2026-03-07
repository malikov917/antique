import type {
  CreateAnnouncementRequest,
  CreateAnnouncementResponse,
  ListAnnouncementsResponse,
  NotificationsResponse,
  RegisterPushTokenRequest,
  RegisterPushTokenResponse
} from "@antique/types";
import type { FastifyInstance, FastifyReply } from "fastify";
import { AuthError } from "../auth/errors.js";
import { type AuthService } from "../services/authService.js";
import { NotificationService } from "../services/notificationService.js";

interface NotificationRouteDeps {
  authService: AuthService;
  notificationService: NotificationService;
}

function sendAuthError(reply: FastifyReply, error: AuthError): ReturnType<FastifyReply["send"]> {
  return reply.code(error.statusCode).send({
    error: error.message,
    code: error.code,
    retryAfterSec: error.retryAfterSec
  });
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

function assertObjectBody(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    throw new AuthError("invalid_request", "Request body must be an object", 400);
  }
  return payload as Record<string, unknown>;
}

export async function registerNotificationRoutes(
  app: FastifyInstance,
  deps: NotificationRouteDeps
): Promise<void> {
  app.get<{ Reply: NotificationsResponse }>("/v1/notifications", async (request, reply) => {
    try {
      const accessToken = extractBearerToken(request.headers.authorization);
      const user = await deps.authService.authenticateAccessToken(accessToken);
      return {
        notifications: deps.notificationService.listNotifications(user.id)
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      throw error;
    }
  });

  app.post<{ Body: RegisterPushTokenRequest; Reply: RegisterPushTokenResponse }>(
    "/v1/me/push-token",
    async (request, reply) => {
      try {
        const accessToken = extractBearerToken(request.headers.authorization);
        const user = await deps.authService.authenticateAccessToken(accessToken);
        const body = assertObjectBody(request.body);
        if (typeof body.token !== "string" || !body.token.trim()) {
          throw new AuthError("invalid_request", "token is required", 400);
        }
        if (body.platform !== "ios" && body.platform !== "android") {
          throw new AuthError("invalid_request", "platform must be ios or android", 400);
        }

        deps.notificationService.registerPushToken({
          userId: user.id,
          token: body.token.trim(),
          platform: body.platform
        });

        return {
          success: true
        };
      } catch (error) {
        if (error instanceof AuthError) {
          return sendAuthError(reply, error);
        }
        throw error;
      }
    }
  );

  app.get<{ Reply: ListAnnouncementsResponse }>("/v1/announcements", async (request, reply) => {
    try {
      const accessToken = extractBearerToken(request.headers.authorization);
      const user = await deps.authService.authenticateAccessToken(accessToken);
      return {
        announcements: deps.notificationService.listAnnouncements(user.id)
      };
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      throw error;
    }
  });

  app.post<{ Body: CreateAnnouncementRequest; Reply: CreateAnnouncementResponse }>(
    "/v1/announcements",
    async (request, reply) => {
      try {
        const accessToken = extractBearerToken(request.headers.authorization);
        const user = await deps.authService.authenticateAccessToken(accessToken);
        if (user.activeRole !== "seller" && user.activeRole !== "admin") {
          throw new AuthError("forbidden_role", "Seller or admin role is required", 403);
        }

        const body = assertObjectBody(request.body);
        if (typeof body.title !== "string" || !body.title.trim()) {
          throw new AuthError("invalid_request", "title is required", 400);
        }
        if (typeof body.body !== "string" || !body.body.trim()) {
          throw new AuthError("invalid_request", "body is required", 400);
        }

        return {
          announcement: deps.notificationService.createAnnouncement({
            actorUserId: user.id,
            title: body.title.trim(),
            body: body.body.trim(),
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
