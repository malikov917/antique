import { useEffect, useMemo, useState } from "react";
import type { FeedResponse, VideoFeedItem } from "@antique/types";

const FALLBACK_PLAYBACK_IDS = ["DS00Spx1CV902zP2Yw6xh38GQ01CV5WfBvXMUdr74j4"];

export interface ReelPlayableItem extends VideoFeedItem {
  streamUrl: string;
}

export function toPlayableItems(items: VideoFeedItem[]): ReelPlayableItem[] {
  return items.map((item) => ({
    ...item,
    streamUrl: `https://stream.mux.com/${item.playbackId}.m3u8`
  }));
}

function fallbackItems(): ReelPlayableItem[] {
  const base: VideoFeedItem[] = FALLBACK_PLAYBACK_IDS.map((playbackId, index) => ({
    id: `fallback-${index}`,
    playbackId,
    caption: "Fallback reel preview",
    author: "antique-preview",
    posterUrl: `https://image.mux.com/${playbackId}/thumbnail.jpg?time=1`,
    durationSec: 15,
    status: "ready"
  }));
  return toPlayableItems(base);
}

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

export function useReelsFeed() {
  const [items, setItems] = useState<ReelPlayableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    const fetchFeed = async () => {
      try {
        setLoading(true);
        const response = await fetch(`${API_BASE_URL}/v1/feed`, {
          signal: abortController.signal
        });
        if (!response.ok) {
          throw new Error(`Feed request failed: ${response.status}`);
        }
        const payload = (await response.json()) as FeedResponse;
        const playable = toPlayableItems(payload.items ?? []);
        setItems(playable.length > 0 ? playable : fallbackItems());
        setError(null);
      } catch (fetchError) {
        if (abortController.signal.aborted) {
          return;
        }
        setItems(fallbackItems());
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load feed");
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    };
    void fetchFeed();
    return () => abortController.abort();
  }, []);

  return useMemo(
    () => ({
      items,
      loading,
      error
    }),
    [error, items, loading]
  );
}
