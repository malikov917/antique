import { describe, expect, it } from "vitest";
import type { UploadStatus } from "./index.js";

describe("types", () => {
  it("contains ready upload status", () => {
    const status: UploadStatus = "ready";
    expect(status).toBe("ready");
  });
});

