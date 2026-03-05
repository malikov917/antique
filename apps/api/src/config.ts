import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ApiConfig {
  port: number;
  muxTokenId?: string;
  muxTokenSecret?: string;
  muxWebhookSecret?: string;
  muxMaxResolutionTier: "1080p" | "1440p" | "2160p";
  muxVideoQuality: "basic" | "plus" | "premium";
  demoPlaybackIds: string[];
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

function findApiRoot(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, "..", "..");
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
  const candidatePaths = [
    join(process.cwd(), "apps/api/.env"),
    join(process.cwd(), ".env"),
    join(apiRoot, ".env")
  ];
  const seen = new Set<string>();
  for (const path of candidatePaths) {
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    parseAndApplyEnvFile(path);
  }
}

export function loadConfig(): ApiConfig {
  loadLocalApiEnvFile();
  return {
    port: Number(process.env.API_PORT ?? 4000),
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
    demoPlaybackIds: splitCsv(process.env.DEMO_PLAYBACK_IDS)
  };
}
