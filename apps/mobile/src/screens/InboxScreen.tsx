import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useInboxTimeline } from "../hooks/useInboxTimeline";

function formatDealStatus(status: string): string {
  return status.replace("_", " ");
}

export function InboxScreen() {
  const { items, loading, error } = useInboxTimeline();

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#f5f5f5" />
        <Text style={styles.metaText}>Loading inbox...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} testID="inbox-screen">
      <Text style={styles.heading}>Inbox</Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {items.length === 0 ? (
        <Text style={styles.metaText}>No active deal chats yet.</Text>
      ) : (
        items.map((item) => (
          <View key={item.chat.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.cardTitle}>Listing {item.chat.listingId}</Text>
              <Text style={styles.badge}>{item.perspective === "seller" ? "Selling" : "Buying"}</Text>
            </View>
            <Text style={styles.cardSubtitle}>
              Deal status: {formatDealStatus(item.deal?.status ?? "open")}
            </Text>
            <Text style={styles.messagePreview} numberOfLines={2}>
              {item.latestMessage?.text ?? "No messages yet. Start the conversation in this chat."}
            </Text>
            <Text style={styles.cardMeta}>
              {new Date(item.updatedAt).toLocaleString()} · Chat {item.chat.id}
            </Text>
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
    fontWeight: "600"
  },
  cardSubtitle: {
    color: "#bbbbbb",
    fontSize: 13
  },
  messagePreview: {
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
