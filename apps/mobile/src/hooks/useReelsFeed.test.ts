import { describe, expect, it } from "vitest";
import { buildFeedEntries, buildStoryRings, toPlayableItems } from "./useReelsFeed";

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

  it("builds author rings and marks unseen authors", () => {
    const items = toPlayableItems([
      {
        id: "1",
        playbackId: "abc123",
        caption: "caption",
        author: "seller-a",
        posterUrl: "poster-1",
        durationSec: 10,
        status: "ready"
      },
      {
        id: "2",
        playbackId: "abc456",
        caption: "caption",
        author: "seller-b",
        posterUrl: "poster-2",
        durationSec: 11,
        status: "ready"
      },
      {
        id: "3",
        playbackId: "abc789",
        caption: "caption",
        author: "seller-a",
        posterUrl: "poster-3",
        durationSec: 12,
        status: "ready"
      }
    ]);

    const rings = buildStoryRings(items, new Set(["seller-a"]));

    expect(rings).toHaveLength(2);
    expect(rings[0]).toMatchObject({ author: "seller-a", isUnseen: false });
    expect(rings[1]).toMatchObject({ author: "seller-b", isUnseen: true });
  });

  it("inserts announcement cards into feed entries", () => {
    const items = toPlayableItems([
      {
        id: "1",
        playbackId: "abc123",
        caption: "caption",
        author: "seller-a",
        posterUrl: "poster-1",
        durationSec: 10,
        status: "ready"
      },
      {
        id: "2",
        playbackId: "abc456",
        caption: "caption",
        author: "seller-b",
        posterUrl: "poster-2",
        durationSec: 11,
        status: "ready"
      },
      {
        id: "3",
        playbackId: "abc789",
        caption: "caption",
        author: "seller-c",
        posterUrl: "poster-3",
        durationSec: 12,
        status: "ready"
      }
    ]);
    const entries = buildFeedEntries(items, [
      {
        id: "announcement-1",
        sellerUserId: "seller-a",
        title: "Market opens at 6pm",
        body: "Bring your latest finds.",
        createdAt: "2026-03-12T00:00:00.000Z"
      }
    ]);

    expect(entries.map((entry) => entry.kind)).toEqual(["reel", "reel", "announcement", "reel"]);
    expect(entries[2]).toMatchObject({
      kind: "announcement",
      announcement: { title: "Market opens at 6pm" }
    });
  });
});
