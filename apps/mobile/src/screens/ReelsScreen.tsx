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
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { ReelItem } from "../components/ReelItem";
import { AnnouncementFeedCard } from "../components/AnnouncementFeedCard";
import { UploadFlow } from "../components/UploadFlow";
import { NotificationsSheet } from "../components/NotificationsSheet";
import { type FeedEntry, buildFeedEntries, buildStoryRings, useReelsFeed } from "../hooks/useReelsFeed";
import { useVideoPrefetch } from "../hooks/useVideoPrefetch";
import { useAuthSession } from "../auth/session";

const { height } = Dimensions.get("window");

export function ReelsScreen() {
  const { accessToken, user } = useAuthSession();
  const [activeIndex, setActiveIndex] = useState(0);
  const [seenAuthors, setSeenAuthors] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const feedListRef = useRef<FlashListRef<FeedEntry>>(null);
  const { items, announcements, loading, error, refresh } = useReelsFeed(accessToken);
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
  const isAtEnd = feedEntries.length > 0 && activeIndex >= feedEntries.length - 1;
  const marketAvailability = useMemo(() => {
    const latestAnnouncement = announcements[0];
    if (!latestAnnouncement) {
      return { label: "Buying status unknown", tone: "neutral" as const };
    }
    if (
      latestAnnouncement.eventType === "market_session_closed" ||
      /market day closed/i.test(latestAnnouncement.title)
    ) {
      return { label: "Buying paused (market closed)", tone: "paused" as const };
    }
    if (
      latestAnnouncement.eventType === "market_session_opened" ||
      /market day opened|market opened/i.test(latestAnnouncement.title)
    ) {
      return { label: "Buying available now", tone: "open" as const };
    }
    return { label: "Check latest market update", tone: "neutral" as const };
  }, [announcements]);

  useVideoPrefetch(items, activeReelIndex);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<ViewToken> }) => {
      const candidate = viewableItems.find((entry) => (entry.index ?? -1) >= 0);
      if (typeof candidate?.index === "number") {
        setActiveIndex(candidate.index);
      }
    }
  );

  const scrollToTop = useCallback(() => {
    feedListRef.current?.scrollToIndex({ index: 0, animated: true });
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: FeedEntry; index: number }) => {
      if (item.kind === "announcement") {
        return <AnnouncementFeedCard announcement={item.announcement} itemIndex={index} onBackToTop={scrollToTop} />;
      }
      return <ReelItem item={item.reel} active={index === activeIndex} itemIndex={index} />;
    },
    [activeIndex, scrollToTop]
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
        ref={feedListRef}
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
      {error ? (
        <View style={styles.topMeta}>
          <Text style={styles.metaText}>{`Offline fallback: ${error}`}</Text>
        </View>
      ) : null}
      <View
        style={[
          styles.buyabilityPill,
          marketAvailability.tone === "open"
            ? styles.buyabilityOpen
            : marketAvailability.tone === "paused"
              ? styles.buyabilityPaused
              : null
        ]}
      >
        <Text style={styles.buyabilityText}>{marketAvailability.label}</Text>
      </View>
      {isAtEnd ? (
        <Pressable
          style={styles.backToTopButton}
          onPress={scrollToTop}
          testID="feed-back-to-top"
        >
          <Text style={styles.backToTopButtonText}>Back to top</Text>
        </Pressable>
      ) : null}
      <Pressable
        testID="feed-updates-button"
        accessibilityLabel="Feed updates"
        accessibilityHint="Opens recent feed updates and notifications"
        style={styles.notificationsButton}
        onPress={() => setNotificationsOpen(true)}
      >
        <Text style={styles.notificationsButtonText}>Activity</Text>
      </Pressable>
      {user?.activeRole === "seller" ? (
        <Pressable testID="upload-button" style={styles.uploadButton} onPress={() => setUploadOpen(true)}>
          <Text style={styles.uploadButtonText}>Upload</Text>
        </Pressable>
      ) : null}
      <Modal
        animationType="slide"
        transparent
        visible={uploadOpen}
        onRequestClose={() => setUploadOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setUploadOpen(false)}>
          <View testID="upload-sheet" style={styles.sheet}>
            <UploadFlow
              onDone={() => {
                setUploadOpen(false);
                refresh();
              }}
            />
          </View>
        </Pressable>
      </Modal>
      <Modal
        animationType="slide"
        transparent
        visible={notificationsOpen}
        onRequestClose={() => setNotificationsOpen(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setNotificationsOpen(false)}>
          <View testID="notifications-modal" style={styles.sheet}>
            <NotificationsSheet onClose={() => setNotificationsOpen(false)} />
          </View>
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
  buyabilityPill: {
    position: "absolute",
    top: 164,
    alignSelf: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3a3a3a",
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  buyabilityOpen: {
    borderColor: "rgba(126, 205, 123, 0.9)",
    backgroundColor: "rgba(33, 61, 31, 0.72)"
  },
  buyabilityPaused: {
    borderColor: "rgba(255, 164, 127, 0.95)",
    backgroundColor: "rgba(75, 42, 28, 0.72)"
  },
  buyabilityText: {
    color: "#f1f1f1",
    fontSize: 12,
    fontWeight: "700"
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
  backToTopButton: {
    position: "absolute",
    right: 20,
    top: 198,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  backToTopButtonText: {
    color: "#f2f2f2",
    fontSize: 12,
    fontWeight: "700"
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
    paddingBottom: 24,
    maxHeight: "84%"
  }
});
