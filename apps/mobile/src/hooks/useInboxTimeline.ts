import { useEffect, useMemo, useState } from "react";
import type { Chat, ChatMessage, Deal, DealsMeResponse, MeResponse } from "@antique/types";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const DEV_ACCESS_TOKEN = process.env.EXPO_PUBLIC_ACCESS_TOKEN;
const POLL_INTERVAL_MS = 12000;

export interface InboxItem {
  chat: Chat;
  deal: Deal | null;
  latestMessage: ChatMessage | null;
  perspective: "buyer" | "seller";
  updatedAt: string;
}

export interface InboxTimelineState {
  items: InboxItem[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useInboxTimeline(): InboxTimelineState {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const abortController = new AbortController();

    const headers = DEV_ACCESS_TOKEN
      ? {
          authorization: `Bearer ${DEV_ACCESS_TOKEN}`
        }
      : undefined;

    const fetchData = async () => {
      try {
        setLoading(true);
        if (!headers) {
          setItems([]);
          setError("Set EXPO_PUBLIC_ACCESS_TOKEN to load inbox timeline.");
          return;
        }

        const [meResponse, dealsResponse, chatsResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/v1/me`, { signal: abortController.signal, headers }),
          fetch(`${API_BASE_URL}/v1/deals/me`, { signal: abortController.signal, headers }),
          fetch(`${API_BASE_URL}/v1/chats`, { signal: abortController.signal, headers })
        ]);

        if (!meResponse.ok) {
          throw new Error(`Me request failed: ${meResponse.status}`);
        }
        if (!dealsResponse.ok) {
          throw new Error(`Deals request failed: ${dealsResponse.status}`);
        }
        if (!chatsResponse.ok) {
          throw new Error(`Chats request failed: ${chatsResponse.status}`);
        }

        const mePayload = (await meResponse.json()) as MeResponse;
        const dealsPayload = (await dealsResponse.json()) as DealsMeResponse;
        const chatsPayload = (await chatsResponse.json()) as { chats?: Chat[] };

        const dealsById = new Map(dealsPayload.deals.map((deal) => [deal.id, deal]));
        const chats = chatsPayload.chats ?? [];

        const chatMessagePairs = await Promise.all(
          chats.map(async (chat) => {
            const messagesResponse = await fetch(`${API_BASE_URL}/v1/chats/${chat.id}/messages`, {
              signal: abortController.signal,
              headers
            });
            if (!messagesResponse.ok) {
              throw new Error(`Chat messages request failed: ${messagesResponse.status}`);
            }
            const messagesPayload = (await messagesResponse.json()) as { messages?: ChatMessage[] };
            const messages = messagesPayload.messages ?? [];

            let latestMessage: ChatMessage | null = null;
            for (const message of messages) {
              if (!latestMessage || Date.parse(message.createdAt) > Date.parse(latestMessage.createdAt)) {
                latestMessage = message;
              }
            }

            return { chat, latestMessage };
          })
        );

        const nextItems = chatMessagePairs
          .map(({ chat, latestMessage }) => {
            const deal = dealsById.get(chat.dealId) ?? null;
            const perspective = mePayload.user.id === chat.sellerUserId ? "seller" : "buyer";
            return {
              chat,
              deal,
              latestMessage,
              perspective,
              updatedAt: latestMessage?.createdAt ?? chat.updatedAt
            } satisfies InboxItem;
          })
          .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

        setItems(nextItems);
        setError(null);
      } catch (fetchError) {
        if (!abortController.signal.aborted) {
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load inbox timeline");
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void fetchData();
    const intervalId = setInterval(() => {
      void fetchData();
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
      abortController.abort();
    };
  }, [refreshTick]);

  return useMemo(
    () => ({
      items,
      loading,
      error,
      refresh: () => setRefreshTick((value) => value + 1)
    }),
    [error, items, loading]
  );
}
