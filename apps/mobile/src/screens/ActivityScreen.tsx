import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { Pressable } from "react-native";
import { useRouter } from "expo-router";
import type { NotificationItem } from "@antique/types";
import { useAuthSession } from "../auth/session";
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
    case "deal_cancellation_requested":
      return "Cancellation requested";
    case "deal_cancellation_resolved":
      return "Cancellation resolved";
    case "deal_refund_confirmed":
      return "Refund confirmed";
    case "announcement":
      return "Announcement";
    case "deal_address_correction_requested":
      return "Address update requested";
    case "deal_address_correction_approved":
      return "Address update approved";
    case "deal_address_correction_rejected":
      return "Address update rejected";
    default:
      return "Activity";
  }
}

export function ActivityScreen() {
  const router = useRouter();
  const { accessToken } = useAuthSession();
  const { notifications, announcements, loading, error } = useNotifications(accessToken);

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
    <FlatList
      style={styles.root}
      contentContainerStyle={styles.content}
      testID="activity-screen"
      data={entries}
      keyExtractor={(item) => `${item.kind}-${item.id}`}
      ListHeaderComponent={
        <View style={styles.headerBlock}>
          <View style={styles.headerRow}>
            <Text style={styles.heading}>Activity</Text>
            <Pressable style={styles.backButton} onPress={() => router.push("/(tabs)/feed")}>
              <Text style={styles.backButtonText}>Back to Feed</Text>
            </Pressable>
          </View>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {entries.length === 0 ? <Text style={styles.metaText}>No activity yet.</Text> : null}
        </View>
      }
      renderItem={({ item: entry }) => (
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>{entry.title}</Text>
            <Text style={styles.badge}>{toLabel(entry.eventType)}</Text>
          </View>
          <Text style={styles.cardBody}>{entry.body}</Text>
          <Text style={styles.cardMeta}>{new Date(entry.createdAt).toLocaleString()}</Text>
        </View>
      )}
    />
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
  headerBlock: {
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
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10
  },
  backButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3a3a3a",
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  backButtonText: {
    color: "#f2f2f2",
    fontWeight: "700",
    fontSize: 12
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
