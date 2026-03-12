import { Dimensions, StyleSheet, Text, View } from "react-native";
import type { AnnouncementItem } from "@antique/types";

const { height, width } = Dimensions.get("window");

export function AnnouncementFeedCard({ announcement, itemIndex }: { announcement: AnnouncementItem; itemIndex: number }) {
  return (
    <View style={styles.wrapper} testID={`announcement-item-${itemIndex}`}>
      <View style={styles.card}>
        <Text style={styles.kicker}>Market update</Text>
        <Text style={styles.title}>{announcement.title}</Text>
        <Text style={styles.body}>{announcement.body}</Text>
        <Text style={styles.meta}>{new Date(announcement.createdAt).toLocaleString()}</Text>
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
  }
});
