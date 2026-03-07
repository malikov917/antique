import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import type { NotificationItem } from "@antique/types";
import { useNotifications } from "../hooks/useNotifications";

type ActivityEntry =
  | {
      id: string;
      kind: "notification";
      title: string;
      body: string;
      eventType: NotificationItem["type"];
      createdAt: string;
    }
  | {
      id: string;
      kind: "announcement";
      title: string;
      body: string;
      eventType: "announcement";
      createdAt: string;
    };

function toLabel(type: NotificationItem["type"]): string {
  switch (type) {
    case "offer_submitted":
      return "Offer submitted";
    case "offer_accepted":
      return "Offer accepted";
    case "offer_declined":
      return "Offer declined";
    case "session_opened":
      return "Market opened";
    case "session_closed":
      return "Market closed";
    case "announcement":
      return "Announcement";
  }
}

export function ActivityScreen() {
  const { notifications, announcements, loading, error } = useNotifications();

  const entries: ActivityEntry[] = [
    ...notifications.map((item) => ({
      id: item.id,
      kind: "notification" as const,
      title: item.title,
      body: item.message,
      eventType: item.type,
      createdAt: item.createdAt
    })),
    ...announcements.map((item) => ({
      id: item.id,
      kind: "announcement" as const,
      title: item.title,
      body: item.body,
      eventType: "announcement" as const,
      createdAt: item.createdAt
    }))
  ].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#f5f5f5" />
        <Text style={styles.metaText}>Loading activity...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} testID="activity-screen">
      <Text style={styles.heading}>Activity</Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {entries.length === 0 ? (
        <Text style={styles.metaText}>No activity yet.</Text>
      ) : (
        entries.map((entry) => (
          <View key={`${entry.kind}-${entry.id}`} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.cardTitle}>{entry.title}</Text>
              <Text style={styles.badge}>{toLabel(entry.eventType)}</Text>
            </View>
            <Text style={styles.cardBody}>{entry.body}</Text>
            <Text style={styles.cardMeta}>{new Date(entry.createdAt).toLocaleString()}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#070707"
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 10
  },
  centered: {
    flex: 1,
    backgroundColor: "#070707",
    alignItems: "center",
    justifyContent: "center",
    gap: 10
  },
  heading: {
    color: "#f5f5f5",
    fontSize: 22,
    fontWeight: "700"
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10
  },
  card: {
    backgroundColor: "#161616",
    borderRadius: 14,
    padding: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: "#242424"
  },
  cardTitle: {
    color: "#f2f2f2",
    fontSize: 15,
    fontWeight: "600",
    flex: 1
  },
  cardBody: {
    color: "#dddddd",
    lineHeight: 20,
    fontSize: 14
  },
  cardMeta: {
    color: "#969696",
    fontSize: 12
  },
  badge: {
    color: "#f0f0f0",
    fontSize: 12,
    fontWeight: "700",
    backgroundColor: "#2a2a2a",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999
  },
  metaText: {
    color: "#b8b8b8"
  },
  errorText: {
    color: "#ff9789"
  }
});
