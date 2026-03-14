import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import type { AnnouncementItem } from "@antique/types";

const { height, width } = Dimensions.get("window");

export function AnnouncementFeedCard({
  announcement,
  itemIndex,
  onBackToTop
}: {
  announcement: AnnouncementItem;
  itemIndex: number;
  onBackToTop?: () => void;
}) {
  return (
    <View style={styles.wrapper} testID={`announcement-item-${itemIndex}`}>
      <View style={styles.card}>
        <Text style={styles.kicker}>Market update</Text>
        <Text style={styles.title}>{announcement.title}</Text>
        <Text style={styles.body}>{announcement.body}</Text>
        <Text style={styles.meta}>{new Date(announcement.createdAt).toLocaleString()}</Text>
        {onBackToTop ? (
          <Pressable style={styles.actionButton} onPress={onBackToTop} testID={`announcement-back-${itemIndex}`}>
            <Text style={styles.actionButtonText}>Go to first reel</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width,
    height,
    backgroundColor: "#050505",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18
  },
  card: {
    width: "100%",
    backgroundColor: "#131313",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#2f2f2f",
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 8
  },
  kicker: {
    color: "#ffc978",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase"
  },
  title: {
    color: "#f4f4f4",
    fontSize: 20,
    fontWeight: "700"
  },
  body: {
    color: "#dedede",
    fontSize: 15,
    lineHeight: 21
  },
  meta: {
    color: "#a5a5a5",
    fontSize: 12
  },
  actionButton: {
    marginTop: 4,
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: "#3c3c3c",
    backgroundColor: "#1f1f1f"
  },
  actionButtonText: {
    color: "#f5f5f5",
    fontWeight: "700",
    fontSize: 12
  }
});
