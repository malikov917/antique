import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ApiConfig {
  port: number;
  dbPath: string;
  muxTokenId?: string;
  muxTokenSecret?: string;
  muxWebhookSecret?: string;
  muxMaxResolutionTier: "1080p" | "1440p" | "2160p";
  muxVideoQuality: "basic" | "plus" | "premium";
  demoPlaybackIds: string[];
  authJwtSecret: string;
  authHashSecret: string;
  authAccessTokenTtlSec: number;
  authRefreshTokenTtlSec: number;
  authOtpTtlSec: number;
  authOtpMaxAttempts: number;
  authOtpCooldownSec: number;
  authOtpRequestPerPhonePerHour: number;
  authOtpRequestPerIpPerHour: number;
  authOtpVerifyPerPhoneIpPerHour: number;
  offerSubmitPerUserPerHour: number;
  offerDecisionPerSellerPerHour: number;
  retentionPurgeEnabled: boolean;
  retentionPurgeIntervalSec: number;
}

let localEnvLoaded = false;

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseEnumValue<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  if (!value) {
    return fallback;
  }
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function parseNumberValue(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }
  return fallback;
}

function findApiRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, "..");
}

function resolveEnvCandidates(apiRoot: string): string[] {
  return [
    join(process.cwd(), "apps/api/.env"),
    join(process.cwd(), ".env"),
    join(apiRoot, ".env"),
    join(apiRoot, "..", ".env"),
    join(apiRoot, "..", "..", ".env")
  ].map((candidate) => resolve(candidate));
}

function parseAndApplyEnvFile(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }
  const lines = readFileSync(filePath, "utf-8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const normalized = line.startsWith("export ") ? line.slice("export ".length) : line;
    const separator = normalized.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = normalized.slice(0, separator).trim();
    const rawValue = normalized.slice(separator + 1).trim();
    const quoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"));
    const value = quoted ? rawValue.slice(1, -1) : rawValue;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadLocalApiEnvFile(): void {
  if (localEnvLoaded) {
    return;
  }
  localEnvLoaded = true;
  const apiRoot = findApiRoot();
  const candidatePaths = resolveEnvCandidates(apiRoot);
  const seen = new Set<string>();
  for (const candidatePath of candidatePaths) {
    if (seen.has(candidatePath)) {
      continue;
    }
    seen.add(candidatePath);
    parseAndApplyEnvFile(candidatePath);
  }
}

export function loadConfig(): ApiConfig {
  loadLocalApiEnvFile();
  const apiRoot = findApiRoot();
  return {
    port: Number(process.env.API_PORT ?? 4000),
    dbPath: resolve(process.env.API_DB_PATH ?? join(apiRoot, "data", "antique.sqlite")),
    muxTokenId: process.env.MUX_TOKEN_ID,
    muxTokenSecret: process.env.MUX_TOKEN_SECRET,
    muxWebhookSecret: process.env.MUX_WEBHOOK_SECRET,
    muxMaxResolutionTier: parseEnumValue(
      process.env.MUX_MAX_RESOLUTION_TIER,
      ["1080p", "1440p", "2160p"] as const,
      "1080p"
    ),
    muxVideoQuality: parseEnumValue(
      process.env.MUX_VIDEO_QUALITY,
      ["basic", "plus", "premium"] as const,
      "plus"
    ),
    demoPlaybackIds: splitCsv(process.env.DEMO_PLAYBACK_IDS),
    authJwtSecret: process.env.AUTH_JWT_SECRET ?? "dev-insecure-auth-jwt-secret-change-me",
    authHashSecret: process.env.AUTH_HASH_SECRET ?? "dev-insecure-auth-hash-secret-change-me",
    authAccessTokenTtlSec: parseNumberValue(process.env.AUTH_ACCESS_TOKEN_TTL_SEC, 15 * 60),
    authRefreshTokenTtlSec: parseNumberValue(
      process.env.AUTH_REFRESH_TOKEN_TTL_SEC,
      30 * 24 * 60 * 60
    ),
    authOtpTtlSec: parseNumberValue(process.env.AUTH_OTP_TTL_SEC, 5 * 60),
    authOtpMaxAttempts: parseNumberValue(process.env.AUTH_OTP_MAX_ATTEMPTS, 5),
    authOtpCooldownSec: parseNumberValue(process.env.AUTH_OTP_COOLDOWN_SEC, 60),
    authOtpRequestPerPhonePerHour: parseNumberValue(
      process.env.AUTH_OTP_REQUEST_PER_PHONE_PER_HOUR,
      5
    ),
    authOtpRequestPerIpPerHour: parseNumberValue(process.env.AUTH_OTP_REQUEST_PER_IP_PER_HOUR, 30),
    authOtpVerifyPerPhoneIpPerHour: parseNumberValue(
      process.env.AUTH_OTP_VERIFY_PER_PHONE_IP_PER_HOUR,
      10
    ),
    offerSubmitPerUserPerHour: parseNumberValue(process.env.OFFER_SUBMIT_PER_USER_PER_HOUR, 30),
    offerDecisionPerSellerPerHour: parseNumberValue(
      process.env.OFFER_DECISION_PER_SELLER_PER_HOUR,
      120
    ),
    retentionPurgeEnabled: parseBooleanValue(process.env.RETENTION_PURGE_ENABLED, true),
    retentionPurgeIntervalSec: parseNumberValue(process.env.RETENTION_PURGE_INTERVAL_SEC, 60 * 60)
  };
}
