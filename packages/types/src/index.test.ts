import { describe, expect, it } from "vitest";
import type { AuthPlatform, UploadStatus } from "./index.js";

describe("types", () => {
  it("contains ready upload status", () => {
    const status: UploadStatus = "ready";
    expect(status).toBe("ready");
  });

  it("contains supported auth platforms", () => {
    const platform: AuthPlatform = "ios";
    expect(platform).toBe("ios");
  });
});
