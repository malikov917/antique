export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly retryAfterSec?: number
  ) {
    super(message);
  }
}
