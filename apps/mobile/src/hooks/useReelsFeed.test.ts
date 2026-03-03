import { describe, expect, it } from "vitest";
import { toPlayableItems } from "./useReelsFeed";

describe("toPlayableItems", () => {
  it("maps playback ids to mux stream urls", () => {
    const result = toPlayableItems([
      {
        id: "1",
        playbackId: "abc123",
        caption: "caption",
        author: "author",
        posterUrl: "poster",
        durationSec: 10,
        status: "ready"
      }
    ]);

    expect(result[0]?.streamUrl).toBe("https://stream.mux.com/abc123.m3u8");
  });
});

