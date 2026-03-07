import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Dimensions, Modal, Pressable, StyleSheet, Text, View, type ViewToken } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { ReelItem } from "../components/ReelItem";
import { UploadFlow } from "../components/UploadFlow";
import { NotificationsSheet } from "../components/NotificationsSheet";
import { useReelsFeed } from "../hooks/useReelsFeed";
import { useVideoPrefetch } from "../hooks/useVideoPrefetch";

const { height } = Dimensions.get("window");

export function ReelsScreen() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { items, loading, error, refresh } = useReelsFeed();
  useVideoPrefetch(items, activeIndex);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<ViewToken> }) => {
      const candidate = viewableItems.find((entry) => (entry.index ?? -1) >= 0);
      if (typeof candidate?.index === "number") {
        setActiveIndex(candidate.index);
      }
    }
  );

  const renderItem = useCallback(
    ({ item, index }: { item: (typeof items)[number]; index: number }) => (
      <ReelItem item={item} active={index === activeIndex} itemIndex={index} />
    ),
    [activeIndex, items]
  );

  if (loading) {
    return (
      <View style={styles.centered} testID="reels-screen-loading">
        <ActivityIndicator color="#ffffff" />
        <Text style={styles.metaText}>Loading reels...</Text>
      </View>
    );
  }

  return (
    <View style={styles.root} testID="reels-screen">
      <FlashList
        data={items}
        renderItem={renderItem}
        pagingEnabled
        snapToInterval={height}
        decelerationRate="fast"
        showsVerticalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged.current}
        viewabilityConfig={{ itemVisiblePercentThreshold: 80 }}
        keyExtractor={(item) => item.id}
        testID="reels-feed"
      />
      <View style={styles.topMeta}>
        <Text style={styles.metaText}>{error ? `Offline fallback: ${error}` : "Live feed"}</Text>
      </View>
      <Pressable
        testID="notifications-button"
        style={styles.notificationsButton}
        onPress={() => setNotificationsOpen(true)}
      >
        <Text style={styles.notificationsButtonText}>Inbox</Text>
      </Pressable>
      <Pressable testID="upload-button" style={styles.uploadButton} onPress={() => setUploadOpen(true)}>
        <Text style={styles.uploadButtonText}>Upload</Text>
      </Pressable>
      <Modal
        animationType="slide"
        transparent
        visible={uploadOpen}
        onRequestClose={() => setUploadOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setUploadOpen(false)}>
          <Pressable testID="upload-sheet" style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <UploadFlow
              onDone={() => {
                setUploadOpen(false);
                refresh();
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        animationType="slide"
        transparent
        visible={notificationsOpen}
        onRequestClose={() => setNotificationsOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setNotificationsOpen(false)}>
          <Pressable testID="notifications-modal" style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <NotificationsSheet />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#050505"
  },
  centered: {
    flex: 1,
    backgroundColor: "#050505",
    alignItems: "center",
    justifyContent: "center",
    gap: 10
  },
  topMeta: {
    position: "absolute",
    top: 60,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999
  },
  metaText: {
    color: "#ececec"
  },
  uploadButton: {
    position: "absolute",
    right: 20,
    bottom: 44,
    backgroundColor: "#f8f8f8",
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 12
  },
  uploadButtonText: {
    color: "#111111",
    fontWeight: "700"
  },
  notificationsButton: {
    position: "absolute",
    left: 20,
    bottom: 44,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    paddingHorizontal: 20,
    paddingVertical: 12
  },
  notificationsButtonText: {
    color: "#f2f2f2",
    fontWeight: "700"
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)"
  },
  sheet: {
    backgroundColor: "#151515",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 24
  }
});
