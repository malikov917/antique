import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import type { VideoProvider } from "../src/services/videoProvider.js";

class TestProvider implements VideoProvider {
  async createDirectUpload() {
    return {
      uploadId: "upload-1",
      uploadUrl: "https://example.com/upload-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    };
  }

  async retrieveUpload(uploadId: string) {
    return {
      uploadId,
      status: "asset_created" as const,
      assetId: "asset-1"
    };
  }

  async retrieveAsset(assetId: string) {
    return {
      assetId,
      status: "ready" as const,
      playbackId: "playback-1"
    };
  }
}

describe("api", () => {
  const secret = "whsec_test";
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer({
      config: {
        port: 4000,
        demoPlaybackIds: [],
        muxWebhookSecret: secret
      },
      videoProvider: new TestProvider()
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates direct upload session", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      uploadId: "upload-1",
      uploadUrl: "https://example.com/upload-1"
    });
  });

  it("rejects invalid mux signature", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/mux",
      payload: {
        type: "video.asset.ready",
        data: { id: "asset-1", playback_ids: [{ id: "playback-1" }] }
      },
      headers: {
        "mux-signature": "t=1000,v1=invalid"
      }
    });

    expect(response.statusCode).toBe(401);
  });

  it("marks upload ready via webhook and exposes in feed", async () => {
    await app.inject({ method: "POST", url: "/v1/uploads" });
    await app.inject({ method: "GET", url: "/v1/uploads/upload-1" });

    const payload = JSON.stringify({
      type: "video.asset.ready",
      data: { id: "asset-1", playback_ids: [{ id: "playback-1" }] }
    });
    const timestamp = `${Math.floor(Date.now() / 1000)}`;
    const digest = createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");

    const webhookResponse = await app.inject({
      method: "POST",
      url: "/v1/webhooks/mux",
      payload,
      headers: {
        "content-type": "application/json",
        "mux-signature": `t=${timestamp},v1=${digest}`
      }
    });

    expect(webhookResponse.statusCode).toBe(204);

    const feedResponse = await app.inject({
      method: "GET",
      url: "/v1/feed"
    });

    expect(feedResponse.statusCode).toBe(200);
    expect(feedResponse.json().items).toHaveLength(1);
    expect(feedResponse.json().items[0]).toMatchObject({
      id: "upload-1",
      playbackId: "playback-1",
      status: "ready"
    });
  });
});

