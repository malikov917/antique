import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuthSession } from "../auth/session";
import { useNotifications } from "../hooks/useNotifications";

export function NotificationsSheet() {
  const { accessToken } = useAuthSession();
  const { notifications, announcements, loading, error } = useNotifications(accessToken);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#ffffff" />
        <Text style={styles.emptyText}>Loading notifications...</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.root} testID="notifications-sheet">
      <Text style={styles.heading}>Notifications</Text>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {notifications.length === 0 ? (
        <Text style={styles.emptyText}>No notifications yet.</Text>
      ) : (
        notifications.map((item) => (
          <View key={item.id} style={styles.card}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardBody}>{item.message}</Text>
            <Text style={styles.cardMeta}>{new Date(item.createdAt).toLocaleString()}</Text>
          </View>
        ))
      )}

      <Text style={styles.heading}>Announcements</Text>
      {announcements.length === 0 ? (
        <Text style={styles.emptyText}>No announcements yet.</Text>
      ) : (
        announcements.map((announcement) => (
          <View key={announcement.id} style={styles.card}>
            <Text style={styles.cardTitle}>{announcement.title}</Text>
            <Text style={styles.cardBody}>{announcement.body}</Text>
            <Text style={styles.cardMeta}>{new Date(announcement.createdAt).toLocaleString()}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
    gap: 10
  },
  centered: {
    paddingVertical: 28,
    alignItems: "center",
    justifyContent: "center",
    gap: 10
  },
  heading: {
    color: "#f2f2f2",
    fontSize: 18,
    fontWeight: "700",
    marginTop: 4
  },
  card: {
    backgroundColor: "#222222",
    borderRadius: 12,
    padding: 12,
    gap: 6
  },
  cardTitle: {
    color: "#f7f7f7",
    fontSize: 15,
    fontWeight: "600"
  },
  cardBody: {
    color: "#d8d8d8",
    fontSize: 14,
    lineHeight: 20
  },
  cardMeta: {
    color: "#9f9f9f",
    fontSize: 12
  },
  emptyText: {
    color: "#bbbbbb"
  },
  errorText: {
    color: "#ff9586"
  }
});
