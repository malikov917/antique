import type { FastifyBaseLogger } from "fastify";
import type { SmsProvider } from "./authService.js";

export class LoggingSmsProvider implements SmsProvider {
  constructor(private readonly logger: FastifyBaseLogger) {}

  async sendOtp(params: { phoneE164: string; code: string }): Promise<void> {
    this.logger.info(
      {
        phoneE164: params.phoneE164,
        otpCode: params.code
      },
      "OTP issued"
    );
  }
}
