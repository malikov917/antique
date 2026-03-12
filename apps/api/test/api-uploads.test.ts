import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";
import { buildMockMuxClient, buildTestConfig } from "./helpers/apiTestHarness.js";

describe("api", () => {
  const secret = "whsec_test";
  let app: Awaited<ReturnType<typeof buildServer>>;

  beforeAll(async () => {
    app = await buildServer({
      config: buildTestConfig({ muxWebhookSecret: secret }),
      muxClient: buildMockMuxClient()
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
    expect(typeof feedResponse.json().items[0].freshnessUpdatedAt).toBe("string");
    expect(typeof feedResponse.json().items[0].freshnessAgeSec).toBe("number");
  });

  it("does not transition to ready when mux policy is non-compliant", async () => {
    const policyMismatchApp = await buildServer({
      config: buildTestConfig({
        port: 4010,
        muxWebhookSecret: secret,
        muxMaxResolutionTier: "1080p",
        muxVideoQuality: "plus"
      }),
      muxClient: buildMockMuxClient({
        maxResolutionTier: "1440p"
      })
    });

    await policyMismatchApp.inject({ method: "POST", url: "/v1/uploads" });
    await policyMismatchApp.inject({ method: "GET", url: "/v1/uploads/upload-1" });

    const payload = JSON.stringify({
      type: "video.asset.ready",
      data: { id: "asset-1", playback_ids: [{ id: "playback-1" }] }
    });
    const timestamp = `${Math.floor(Date.now() / 1000)}`;
    const digest = createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");

    const webhookResponse = await policyMismatchApp.inject({
      method: "POST",
      url: "/v1/webhooks/mux",
      payload,
      headers: {
        "content-type": "application/json",
        "mux-signature": `t=${timestamp},v1=${digest}`
      }
    });

    expect(webhookResponse.statusCode).toBe(204);

    const statusResponse = await policyMismatchApp.inject({
      method: "GET",
      url: "/v1/uploads/upload-1"
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json()).toMatchObject({
      uploadId: "upload-1",
      status: "errored"
    });

    const feedResponse = await policyMismatchApp.inject({
      method: "GET",
      url: "/v1/feed"
    });
    expect(feedResponse.statusCode).toBe(200);
    expect(feedResponse.json().items).toHaveLength(0);

    await policyMismatchApp.close();
  });

  it("fails fast with 503 on upload routes when mux credentials are missing", async () => {
    const noCredsApp = await buildServer({
      config: buildTestConfig({
        port: 4012,
        muxWebhookSecret: secret,
        muxTokenId: undefined,
        muxTokenSecret: undefined
      })
    });

    const createResponse = await noCredsApp.inject({
      method: "POST",
      url: "/v1/uploads"
    });
    expect(createResponse.statusCode).toBe(503);
    expect(createResponse.json().error).toContain("Mux credentials");

    const lookupResponse = await noCredsApp.inject({
      method: "GET",
      url: "/v1/uploads/nonexistent"
    });
    expect(lookupResponse.statusCode).toBe(503);
    expect(lookupResponse.json().error).toContain("Mux credentials");

    await noCredsApp.close();
  });
});
