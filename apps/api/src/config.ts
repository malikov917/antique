export interface ApiConfig {
  port: number;
  muxTokenId?: string;
  muxTokenSecret?: string;
  muxWebhookSecret?: string;
  demoPlaybackIds: string[];
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadConfig(): ApiConfig {
  return {
    port: Number(process.env.API_PORT ?? 4000),
    muxTokenId: process.env.MUX_TOKEN_ID,
    muxTokenSecret: process.env.MUX_TOKEN_SECRET,
    muxWebhookSecret: process.env.MUX_WEBHOOK_SECRET,
    demoPlaybackIds: splitCsv(process.env.DEMO_PLAYBACK_IDS)
  };
}

