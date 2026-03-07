import { useEffect, useMemo, useState } from "react";
import type {
  AnnouncementItem,
  ListAnnouncementsResponse,
  NotificationItem,
  NotificationsResponse
} from "@antique/types";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
const DEV_ACCESS_TOKEN = process.env.EXPO_PUBLIC_ACCESS_TOKEN;
const POLL_INTERVAL_MS = 12000;

export interface NotificationsState {
  notifications: NotificationItem[];
  announcements: AnnouncementItem[];
  loading: boolean;
  error: string | null;
}

export function useNotifications(): NotificationsState {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          setNotifications([]);
          setAnnouncements([]);
          setError("Set EXPO_PUBLIC_ACCESS_TOKEN to load timeline data.");
          return;
        }

        const [notificationsResponse, announcementsResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/v1/notifications`, { signal: abortController.signal, headers }),
          fetch(`${API_BASE_URL}/v1/announcements`, { signal: abortController.signal, headers })
        ]);

        if (!notificationsResponse.ok) {
          throw new Error(`Notifications request failed: ${notificationsResponse.status}`);
        }
        if (!announcementsResponse.ok) {
          throw new Error(`Announcements request failed: ${announcementsResponse.status}`);
        }

        const notificationsPayload = (await notificationsResponse.json()) as NotificationsResponse;
        const announcementsPayload = (await announcementsResponse.json()) as ListAnnouncementsResponse;

        setNotifications(notificationsPayload.notifications ?? []);
        setAnnouncements(announcementsPayload.announcements ?? []);
        setError(null);
      } catch (fetchError) {
        if (!abortController.signal.aborted) {
          setError(fetchError instanceof Error ? fetchError.message : "Failed to load notifications");
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
  }, []);

  return useMemo(
    () => ({
      notifications,
      announcements,
      loading,
      error
    }),
    [announcements, error, loading, notifications]
  );
}
