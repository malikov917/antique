import { StyleSheet, Text, View } from "react-native";

interface PlaceholderScreenProps {
  title: string;
  description: string;
}

export function PlaceholderScreen({ title, description }: PlaceholderScreenProps) {
  return (
    <View style={styles.root} testID={`${title.toLowerCase()}-placeholder`}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      <Text style={styles.badge}>MVP placeholder</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#050505",
    paddingHorizontal: 20,
    justifyContent: "center",
    gap: 16
  },
  title: {
    color: "#f8f8f8",
    fontWeight: "700",
    fontSize: 32
  },
  description: {
    color: "#c8c8c8",
    fontSize: 16,
    lineHeight: 22
  },
  badge: {
    alignSelf: "flex-start",
    color: "#111111",
    backgroundColor: "#f8f8f8",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontWeight: "700"
  }
});
