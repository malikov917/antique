import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildServer } from "../src/server.js";
import { MuxVideoService } from "../src/services/videoProvider.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function firstMediaLine(manifest: string): string | undefined {
  return manifest
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
}

function resolvePlaylistUrl(baseUrl: string, line: string): string {
  return new URL(line, baseUrl).toString();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return await response.text();
}

describe("mux integration", () => {
  const config = loadConfig();
  const appPromise = buildServer({
    config: {
      ...config,
      demoPlaybackIds: []
    }
  });
  let createdAssetId: string | undefined;

  afterAll(async () => {
    const app = await appPromise;
    await app.close();
    if (!createdAssetId) {
      return;
    }
    const cleaner = new MuxVideoService({
      muxTokenId: config.muxTokenId,
      muxTokenSecret: config.muxTokenSecret,
      muxAssetPolicy: {
        maxResolutionTier: config.muxMaxResolutionTier,
        videoQuality: config.muxVideoQuality,
        playbackPolicy: ["public"]
      }
    });
    await cleaner.deleteAsset(createdAssetId);
  });

  it("uploads real video and downloads stream manifest plus first segment", async () => {
    const app = await appPromise;
    const fixtureCandidates = [
      resolve(process.cwd(), "apps/api/test/fixtures/smoke.mp4"),
      resolve(process.cwd(), "test/fixtures/smoke.mp4"),
      resolve(join(process.cwd(), ".."), "apps/api/test/fixtures/smoke.mp4")
    ];
    const fixturePath = fixtureCandidates.find((candidate) => existsSync(candidate));
    if (!fixturePath) {
      throw new Error("Missing smoke fixture at apps/api/test/fixtures/smoke.mp4");
    }
    const videoBuffer = readFileSync(fixturePath);

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/uploads"
    });
    expect(createResponse.statusCode).toBe(200);
    const created = createResponse.json() as {
      uploadId: string;
      uploadUrl: string;
      expiresAt: string;
    };
    expect(created.uploadId).toBeTruthy();
    expect(created.uploadUrl).toContain("http");

    const uploadResponse = await fetch(created.uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": "video/mp4",
        "content-length": String(videoBuffer.length)
      },
      body: videoBuffer
    });
    expect(uploadResponse.ok).toBe(true);

    const pollUntil = Date.now() + 4 * 60 * 1000;
    let playbackId: string | undefined;
    while (Date.now() < pollUntil) {
      const statusResponse = await app.inject({
        method: "GET",
        url: `/v1/uploads/${created.uploadId}`
      });
      expect([200, 404]).toContain(statusResponse.statusCode);
      const statusPayload = statusResponse.json() as {
        uploadId: string;
        status: "waiting_upload" | "asset_created" | "preparing" | "ready" | "errored";
        assetId?: string;
        playbackId?: string;
      };

      if (statusPayload.assetId) {
        createdAssetId = statusPayload.assetId;
      }
      if (statusPayload.status === "errored") {
        throw new Error(
          `Mux asset moved to errored state for upload ${created.uploadId} (asset ${statusPayload.assetId ?? "unknown"})`
        );
      }
      if (statusPayload.status === "ready" && statusPayload.playbackId) {
        playbackId = statusPayload.playbackId;
        break;
      }
      await sleep(3000);
    }
    expect(playbackId).toBeTruthy();

    const feedResponse = await app.inject({
      method: "GET",
      url: "/v1/feed"
    });
    expect(feedResponse.statusCode).toBe(200);
    const feedItems = (feedResponse.json() as { items: Array<{ playbackId: string }> }).items;
    expect(feedItems.some((item) => item.playbackId === playbackId)).toBe(true);

    const masterManifestUrl = `https://stream.mux.com/${playbackId}.m3u8`;
    let manifest = "";
    const manifestDeadline = Date.now() + 2 * 60 * 1000;
    while (Date.now() < manifestDeadline) {
      try {
        manifest = await fetchText(masterManifestUrl);
        if (manifest.includes("#EXTM3U")) {
          break;
        }
      } catch {
        // keep retrying until stream is available
      }
      await sleep(2000);
    }
    expect(manifest).toContain("#EXTM3U");

    const firstLine = firstMediaLine(manifest);
    expect(firstLine).toBeTruthy();
    let segmentPlaylistUrl = resolvePlaylistUrl(masterManifestUrl, String(firstLine));
    for (let depth = 0; depth < 4 && segmentPlaylistUrl.endsWith(".m3u8"); depth += 1) {
      const variantManifest = await fetchText(segmentPlaylistUrl);
      const firstSegmentLine = firstMediaLine(variantManifest);
      expect(firstSegmentLine).toBeTruthy();
      segmentPlaylistUrl = resolvePlaylistUrl(segmentPlaylistUrl, String(firstSegmentLine));
    }

    const segmentResponse = await fetch(segmentPlaylistUrl);
    expect(segmentResponse.ok).toBe(true);
    const segmentBytes = await segmentResponse.arrayBuffer();
    expect(segmentBytes.byteLength).toBeGreaterThan(0);
  }, 8 * 60 * 1000);
});
