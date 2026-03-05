import type {
  LogoutRequest,
  OtpRequestRequest,
  OtpVerifyRequest,
  RefreshRequest
} from "@antique/types";
import type { FastifyInstance, FastifyReply } from "fastify";
import { AuthError } from "../auth/errors.js";
import { type AuthService } from "../services/authService.js";

interface AuthRouteDeps {
  authService: AuthService;
  otpRequestIpRateLimitMax: number;
  otpVerifyIpRateLimitMax: number;
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

export async function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): Promise<void> {
  app.post<{ Body: OtpRequestRequest }>(
    "/v1/auth/otp/request",
    {
      config: {
        rateLimit: {
          max: deps.otpRequestIpRateLimitMax,
          timeWindow: "1 hour"
        }
      }
    },
    async (request, reply) => {
      try {
        const body = assertObjectBody(request.body);
        if (typeof body.phone !== "string") {
          throw new AuthError("invalid_phone", "Phone number is required", 400);
        }

        return await deps.authService.requestOtp({
          phone: body.phone,
          ipAddress: request.ip
        });
      } catch (error) {
        if (error instanceof AuthError) {
          return sendAuthError(reply, error);
        }
        throw error;
      }
    }
  );

  app.post<{ Body: OtpVerifyRequest }>(
    "/v1/auth/otp/verify",
    {
      config: {
        rateLimit: {
          max: deps.otpVerifyIpRateLimitMax,
          timeWindow: "1 hour"
        }
      }
    },
    async (request, reply) => {
      try {
        const body = assertObjectBody(request.body);
        if (typeof body.phone !== "string") {
          throw new AuthError("invalid_phone", "Phone number is required", 400);
        }
        if (typeof body.code !== "string") {
          throw new AuthError("invalid_otp_code", "OTP code is required", 400);
        }
        if (typeof body.deviceId !== "string") {
          throw new AuthError("invalid_device_id", "Device ID is required", 400);
        }
        if (body.platform !== "ios" && body.platform !== "android") {
          throw new AuthError("invalid_platform", "Platform must be ios or android", 400);
        }

        return await deps.authService.verifyOtp({
          phone: body.phone,
          code: body.code,
          deviceId: body.deviceId,
          platform: body.platform,
          ipAddress: request.ip
        });
      } catch (error) {
        if (error instanceof AuthError) {
          return sendAuthError(reply, error);
        }
        throw error;
      }
    }
  );

  app.post<{ Body: RefreshRequest }>("/v1/auth/refresh", async (request, reply) => {
    try {
      const body = assertObjectBody(request.body);
      if (typeof body.refreshToken !== "string") {
        throw new AuthError("missing_refresh_token", "Refresh token is required", 400);
      }

      return await deps.authService.refresh({
        refreshToken: body.refreshToken
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      throw error;
    }
  });

  app.post<{ Body: LogoutRequest }>("/v1/auth/logout", async (request, reply) => {
    try {
      const body = assertObjectBody(request.body);
      if (typeof body.refreshToken !== "string") {
        throw new AuthError("missing_refresh_token", "Refresh token is required", 400);
      }

      return deps.authService.logout({
        refreshToken: body.refreshToken
      });
    } catch (error) {
      if (error instanceof AuthError) {
        return sendAuthError(reply, error);
      }
      throw error;
    }
  });
}
