import { createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function generateOtpCode(): string {
  const value = randomInt(0, 1_000_000);
  return String(value).padStart(6, "0");
}

export function generateToken(): string {
  return randomBytes(48).toString("base64url");
}

export function hashWithSecret(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}
