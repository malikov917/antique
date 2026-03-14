import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnnouncementItem, FeedResponse, ListAnnouncementsResponse, VideoFeedItem } from "@antique/types";

const FALLBACK_PLAYBACK_IDS = ["DS00Spx1CV902zP2Yw6xh38GQ01CV5WfBvXMUdr74j4"];

export interface ReelPlayableItem extends VideoFeedItem {
  streamUrl: string;
}

export interface StoryRingItem {
  author: string;
  posterUrl: string;
  freshnessUpdatedAt?: string;
  isUnseen: boolean;
}

export type FeedEntry =
  | {
      kind: "reel";
      id: string;
      reel: ReelPlayableItem;
    }
  | {
      kind: "announcement";
      id: string;
      announcement: AnnouncementItem;
    };

export function toPlayableItems(items: VideoFeedItem[]): ReelPlayableItem[] {
  return items.map((item) => ({
    ...item,
    streamUrl: `https://stream.mux.com/${item.playbackId}.m3u8`
  }));
}

export function buildStoryRings(items: ReelPlayableItem[], seenAuthors: ReadonlySet<string>): StoryRingItem[] {
  const byAuthor = new Map<string, ReelPlayableItem>();
  for (const item of items) {
    if (!byAuthor.has(item.author)) {
      byAuthor.set(item.author, item);
    }
  }

  return [...byAuthor.values()].map((item) => ({
    author: item.author,
    posterUrl: item.posterUrl,
    freshnessUpdatedAt: item.freshnessUpdatedAt,
    isUnseen: !seenAuthors.has(item.author)
  }));
}

export function buildFeedEntries(items: ReelPlayableItem[], announcements: AnnouncementItem[]): FeedEntry[] {
  const entries: FeedEntry[] = [];
  let announcementIndex = 0;

  for (let index = 0; index < items.length; index += 1) {
    if (index > 0 && index % 2 === 0 && announcementIndex < announcements.length) {
      const announcement = announcements[announcementIndex];
      if (announcement) {
        entries.push({
          kind: "announcement",
          id: `announcement-${announcement.id}`,
          announcement
        });
        announcementIndex += 1;
      }
    }

    const item = items[index];
    if (item) {
      entries.push({
        kind: "reel",
        id: `reel-${item.id}`,
        reel: item
      });
    }
  }

  if (entries.length === 0) {
    return announcements.slice(0, 2).map((announcement) => ({
      kind: "announcement",
      id: `announcement-${announcement.id}`,
      announcement
    }));
  }

  return entries;
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

export function useReelsFeed(accessToken?: string) {
  const [items, setItems] = useState<ReelPlayableItem[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  const refresh = useCallback(() => {
    setRefreshNonce((current) => current + 1);
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    const fetchFeed = async () => {
      try {
        if (!hasLoadedOnce) {
          setLoading(true);
        }
        const headers = accessToken
          ? {
              authorization: `Bearer ${accessToken}`
            }
          : undefined;

        const [feedResponse, announcementsResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/v1/feed`, {
            signal: abortController.signal
          }),
          headers
            ? fetch(`${API_BASE_URL}/v1/announcements`, {
                signal: abortController.signal,
                headers
              })
            : Promise.resolve(null)
        ]);

        if (!feedResponse.ok) {
          throw new Error(`Feed request failed: ${feedResponse.status}`);
        }
        const payload = (await feedResponse.json()) as FeedResponse;
        const playable = toPlayableItems(payload.items ?? []);
        setItems(playable.length > 0 ? playable : fallbackItems());

        if (announcementsResponse) {
          if (announcementsResponse.ok) {
            const announcementsPayload = (await announcementsResponse.json()) as ListAnnouncementsResponse;
            setAnnouncements((announcementsPayload.announcements ?? []).slice(0, 3));
          } else {
            setAnnouncements([]);
          }
        } else {
          setAnnouncements([]);
        }
        setError(null);
        setHasLoadedOnce(true);
      } catch (fetchError) {
        if (abortController.signal.aborted) {
          return;
        }
        setItems(fallbackItems());
        setAnnouncements([]);
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load feed");
        setHasLoadedOnce(true);
      } finally {
        if (!abortController.signal.aborted) {
          if (!hasLoadedOnce) {
            setLoading(false);
          }
        }
      }
    };
    void fetchFeed();
    return () => abortController.abort();
  }, [accessToken, refreshNonce, hasLoadedOnce]);

  return useMemo(
    () => ({
      items,
      announcements,
      loading,
      error,
      refresh
    }),
    [announcements, error, items, loading, refresh]
  );
}
