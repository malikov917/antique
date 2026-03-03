import { createHmac, timingSafeEqual } from "node:crypto";

function parseMuxSignature(header: string): { timestamp: string; v1: string } | null {
  const pieces = header.split(",");
  const values = new Map<string, string>();
  for (const piece of pieces) {
    const [rawKey, rawValue] = piece.split("=");
    if (rawKey && rawValue) {
      values.set(rawKey.trim(), rawValue.trim());
    }
  }
  const timestamp = values.get("t");
  const v1 = values.get("v1");
  if (!timestamp || !v1) {
    return null;
  }
  return { timestamp, v1 };
}

export function isMuxWebhookSignatureValid(params: {
  signatureHeader: string | undefined;
  rawBody: string | undefined;
  secret: string | undefined;
}): boolean {
  if (!params.secret) {
    return true;
  }
  if (!params.signatureHeader || !params.rawBody) {
    return false;
  }
  const parsed = parseMuxSignature(params.signatureHeader);
  if (!parsed) {
    return false;
  }
  const expected = createHmac("sha256", params.secret)
    .update(`${parsed.timestamp}.${params.rawBody}`)
    .digest("hex");

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(parsed.v1));
  } catch {
    return false;
  }
}

