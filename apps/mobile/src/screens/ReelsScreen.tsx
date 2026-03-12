import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewToken
} from "react-native";
import { FlashList } from "@shopify/flash-list";
import { ReelItem } from "../components/ReelItem";
import { AnnouncementFeedCard } from "../components/AnnouncementFeedCard";
import { UploadFlow } from "../components/UploadFlow";
import { NotificationsSheet } from "../components/NotificationsSheet";
import { type FeedEntry, buildFeedEntries, buildStoryRings, useReelsFeed } from "../hooks/useReelsFeed";
import { useVideoPrefetch } from "../hooks/useVideoPrefetch";

const { height } = Dimensions.get("window");

export function ReelsScreen() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [seenAuthors, setSeenAuthors] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const { items, announcements, loading, error, refresh } = useReelsFeed();
  const feedEntries = useMemo(() => buildFeedEntries(items, announcements), [announcements, items]);
  const activeReelIndex = useMemo(() => {
    if (feedEntries.length === 0) {
      return 0;
    }
    const visibleEntries = feedEntries.slice(0, Math.max(activeIndex + 1, 1));
    const index = visibleEntries.filter((entry) => entry.kind === "reel").length - 1;
    return index < 0 ? 0 : Math.min(index, Math.max(items.length - 1, 0));
  }, [activeIndex, feedEntries, items.length]);
  const storyRings = useMemo(() => buildStoryRings(items, seenAuthors), [items, seenAuthors]);

  useVideoPrefetch(items, activeReelIndex);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<ViewToken> }) => {
      const candidate = viewableItems.find((entry) => (entry.index ?? -1) >= 0);
      if (typeof candidate?.index === "number") {
        setActiveIndex(candidate.index);
      }
    }
  );

  const renderItem = useCallback(
    ({ item, index }: { item: FeedEntry; index: number }) => {
      if (item.kind === "announcement") {
        return <AnnouncementFeedCard announcement={item.announcement} itemIndex={index} />;
      }
      return <ReelItem item={item.reel} active={index === activeIndex} itemIndex={index} />;
    },
    [activeIndex, feedEntries]
  );

  useEffect(() => {
    const entry = feedEntries[activeIndex];
    if (!entry || entry.kind !== "reel") {
      return;
    }
    setSeenAuthors((current) => {
      if (current.has(entry.reel.author)) {
        return current;
      }
      const next = new Set(current);
      next.add(entry.reel.author);
      return next;
    });
  }, [activeIndex, feedEntries]);

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
        data={feedEntries}
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
      <View style={styles.storyStripWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storyStrip}>
          {storyRings.map((ring) => (
            <View key={ring.author} style={styles.storyRing} testID={`story-ring-${ring.author}`}>
              <View
                style={[
                  styles.storyRingBorder,
                  ring.isUnseen ? styles.storyRingBorderUnseen : styles.storyRingBorderSeen
                ]}
              >
                <Image source={{ uri: ring.posterUrl }} style={styles.storyImage} />
              </View>
              <Text style={styles.storyText} numberOfLines={1}>
                @{ring.author}
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>
      <View style={styles.topMeta}>
        <Text style={styles.metaText}>{error ? `Offline fallback: ${error}` : "Live feed"}</Text>
      </View>
      <Pressable
        testID="feed-updates-button"
        accessibilityLabel="Feed updates"
        accessibilityHint="Opens recent feed updates and notifications"
        style={styles.notificationsButton}
        onPress={() => setNotificationsOpen(true)}
      >
        <Text style={styles.notificationsButtonText}>Updates</Text>
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
    top: 124,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.35)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999
  },
  metaText: {
    color: "#ececec"
  },
  storyStripWrap: {
    position: "absolute",
    top: 54,
    left: 0,
    right: 0
  },
  storyStrip: {
    paddingHorizontal: 12,
    gap: 10
  },
  storyRing: {
    width: 78,
    alignItems: "center",
    gap: 6
  },
  storyRingBorder: {
    width: 62,
    height: 62,
    borderRadius: 999,
    borderWidth: 2,
    padding: 2
  },
  storyRingBorderUnseen: {
    borderColor: "#f7d6a0"
  },
  storyRingBorderSeen: {
    borderColor: "rgba(255,255,255,0.3)"
  },
  storyImage: {
    width: "100%",
    height: "100%",
    borderRadius: 999
  },
  storyText: {
    color: "#f1f1f1",
    fontSize: 11,
    width: "100%",
    textAlign: "center"
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
