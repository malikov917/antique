import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NotificationItem } from "@antique/types";
import { useState } from "react";
import { useAuthSession } from "../auth/session";
import { useNotifications } from "../hooks/useNotifications";

type ActivityFilter = "all" | "buyer" | "seller";

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

function matchesFilter(entry: ActivityEntry, filter: ActivityFilter): boolean {
  if (filter === "all") {
    return true;
  }
  const type = entry.eventType;
  if (filter === "buyer") {
    return (
      type === "offer_accepted" ||
      type === "offer_declined" ||
      type === "deal_address_correction_requested" ||
      type === "deal_address_correction_approved" ||
      type === "deal_address_correction_rejected"
    );
  }
  // seller
  return type === "offer_submitted" || type === "session_opened" || type === "session_closed";
}

function groupLabel(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  if (isToday) {
    return "Today";
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear();
  if (isYesterday) {
    return "Yesterday";
  }
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export function ActivityScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { accessToken } = useAuthSession();
  const { notifications, announcements, loading, error, refresh } = useNotifications(accessToken);
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const allEntries: ActivityEntry[] = [
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

  const filteredEntries = allEntries.filter((entry) => matchesFilter(entry, filter));

  const sections: { title: string; data: ActivityEntry[] }[] = [];
  for (const entry of filteredEntries) {
    const label = groupLabel(entry.createdAt);
    const lastSection = sections[sections.length - 1];
    if (lastSection && lastSection.title === label) {
      lastSection.data.push(entry);
    } else {
      sections.push({ title: label, data: [entry] });
    }
  }

  const flatData: (ActivityEntry | { id: string; kind: "section"; title: string })[] = [];
  for (const section of sections) {
    flatData.push({ id: `section-${section.title}`, kind: "section" as const, title: section.title });
    for (const entry of section.data) {
      flatData.push(entry);
    }
  }

  const renderItem = ({
    item
  }: {
    item: ActivityEntry | { id: string; kind: "section"; title: string };
  }) => {
    if (item.kind === "section") {
      return (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{item.title}</Text>
        </View>
      );
    }
    return (
      <View style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.badge}>{toLabel(item.eventType)}</Text>
        </View>
        <Text style={styles.cardBody}>{item.body}</Text>
        <Text style={styles.cardMeta}>{new Date(item.createdAt).toLocaleString()}</Text>
      </View>
    );
  };

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
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 18 }]}
      testID="activity-screen"
      data={flatData}
      keyExtractor={(item) => `${item.kind}-${item.id}`}
      refreshing={loading}
      onRefresh={refresh}
      ListHeaderComponent={
        <View style={styles.headerBlock}>
          <View style={styles.headerRow}>
            <Text style={styles.heading}>Activity</Text>
            <Pressable style={styles.backButton} onPress={() => router.push("/(tabs)/feed")}>
              <Text style={styles.backButtonText}>Back to Feed</Text>
            </Pressable>
          </View>

          <View style={styles.filterRow}>
            {(["all", "buyer", "seller"] as ActivityFilter[]).map((f) => (
              <Pressable
                key={f}
                style={[styles.filterChip, filter === f ? styles.filterChipActive : null]}
                onPress={() => setFilter(f)}
              >
                <Text style={[styles.filterChipText, filter === f ? styles.filterChipTextActive : null]}>
                  {f === "all" ? "All" : f === "buyer" ? "Buying" : "Selling"}
                </Text>
              </Pressable>
            ))}
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {flatData.length === 0 ? (
            <Text style={styles.metaText}>
              {filter === "all" ? "No activity yet." : `No ${filter === "buyer" ? "buying" : "selling"} activity.`}
            </Text>
          ) : null}
        </View>
      }
      renderItem={renderItem}
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
    gap: 10,
    marginBottom: 6
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
  filterRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3a3a3a",
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 14,
    paddingVertical: 6
  },
  filterChipActive: {
    backgroundColor: "#2f5d2f",
    borderColor: "#2f5d2f"
  },
  filterChipText: {
    color: "#b8b8b8",
    fontWeight: "600",
    fontSize: 13
  },
  filterChipTextActive: {
    color: "#f5f5f5"
  },
  sectionHeader: {
    marginTop: 8,
    marginBottom: 4
  },
  sectionTitle: {
    color: "#969696",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5
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
    borderColor: "#242424",
    marginBottom: 8
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
