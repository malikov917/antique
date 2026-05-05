import { useEffect, useMemo, useState } from "react";
import type { Chat, ChatMessage, Deal, DealsMeResponse, MeResponse } from "@antique/types";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const POLL_INTERVAL_MS = 12000;

export interface ChatDetailState {
  chat: Chat | null;
  deal: Deal | null;
  messages: ChatMessage[];
  perspective: "buyer" | "seller" | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  sendMessage: (text: string) => Promise<boolean>;
  sending: boolean;
}

export function useChatDetail(chatId: string | undefined, accessToken?: string): ChatDetailState {
  const [chat, setChat] = useState<Chat | null>(null);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [perspective, setPerspective] = useState<"buyer" | "seller" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [sending, setSending] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);

  useEffect(() => {
    const abortController = new AbortController();

    const headers = accessToken
      ? {
          authorization: `Bearer ${accessToken}`
        }
      : undefined;

    const fetchData = async () => {
      try {
        if (!hasLoadedOnce) {
          setLoading(true);
        }
        if (!headers || !chatId) {
          setChat(null);
          setDeal(null);
          setMessages([]);
          setPerspective(null);
          setError("Sign in to view chat details.");
          setHasLoadedOnce(true);
          setLoading(false);
          return;
        }

        const [meResponse, dealsResponse, chatsResponse, messagesResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/v1/me`, { signal: abortController.signal, headers }),
          fetch(`${API_BASE_URL}/v1/deals/me`, { signal: abortController.signal, headers }),
          fetch(`${API_BASE_URL}/v1/chats`, { signal: abortController.signal, headers }),
          fetch(`${API_BASE_URL}/v1/chats/${chatId}/messages`, { signal: abortController.signal, headers })
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
        if (!messagesResponse.ok) {
          throw new Error(`Messages request failed: ${messagesResponse.status}`);
        }

        const mePayload = (await meResponse.json()) as MeResponse;
        const dealsPayload = (await dealsResponse.json()) as DealsMeResponse;
        const chatsPayload = (await chatsResponse.json()) as { chats?: Chat[] };
        const messagesPayload = (await messagesResponse.json()) as { messages?: ChatMessage[] };

        const foundChat = (chatsPayload.chats ?? []).find((c) => c.id === chatId) ?? null;
        const foundDeal = foundChat
          ? (dealsPayload.deals.find((d) => d.id === foundChat.dealId) ?? null)
          : null;
        const userPerspective =
          foundChat && mePayload.user.id === foundChat.sellerUserId ? "seller" : "buyer";

        setChat(foundChat);
        setDeal(foundDeal);
        setMessages(messagesPayload.messages ?? []);
        setPerspective(foundChat ? userPerspective : null);
        setError(null);
        setHasLoadedOnce(true);
      } catch (fetchError) {
        if (!abortController.signal.aborted) {
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load chat details");
          setHasLoadedOnce(true);
        }
      } finally {
        if (!abortController.signal.aborted) {
          if (!hasLoadedOnce) {
            setLoading(false);
          }
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
  }, [accessToken, chatId, refreshTick, hasLoadedOnce]);

  const sendMessage = async (text: string): Promise<boolean> => {
    if (!chatId || !accessToken) {
      return false;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      return false;
    }

    setSending(true);
    try {
      const response = await fetch(`${API_BASE_URL}/v1/chats/${chatId}/messages`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ text: trimmed })
      });
      if (!response.ok) {
        throw new Error(`Message send failed: ${response.status}`);
      }
      const created = (await response.json()) as { message?: ChatMessage };
      if (created.message) {
        setMessages((current) => [...current, created.message!]);
      }
      return true;
    } catch {
      return false;
    } finally {
      setSending(false);
    }
  };

  return useMemo(
    () => ({
      chat,
      deal,
      messages,
      perspective,
      loading,
      error,
      refresh: () => setRefreshTick((value) => value + 1),
      sendMessage,
      sending
    }),
    [chat, deal, error, loading, messages, perspective, sendMessage, sending]
  );
}
