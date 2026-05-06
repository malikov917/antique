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
import { useRouter } from "expo-router";
import { ReelItem } from "../components/ReelItem";
import { UploadFlow } from "../components/UploadFlow";
import { OfferFlow } from "../components/OfferFlow";
import type { ReelPlayableItem } from "../hooks/useReelsFeed";
import { type FeedEntry, buildFeedEntries, buildStoryRings, useReelsFeed } from "../hooks/useReelsFeed";
import { useVideoPrefetch } from "../hooks/useVideoPrefetch";
import { useAuthSession } from "../auth/session";
import { useBuyerStatus } from "../hooks/useBuyerStatus";
import { useBasketAdd } from "../hooks/useBasketAdd";

const { height } = Dimensions.get("window");

export function ReelsScreen() {
  const router = useRouter();
  const { accessToken, user } = useAuthSession();
  const [activeIndex, setActiveIndex] = useState(0);
  const [seenAuthors, setSeenAuthors] = useState<Set<string>>(new Set());
  const [uploadOpen, setUploadOpen] = useState(false);
  const [offerItem, setOfferItem] = useState<ReelPlayableItem | null>(null);
  const { items, announcements, loading, error, refresh } = useReelsFeed(accessToken);
  const feedEntries = useMemo(() => buildFeedEntries(items, announcements), [announcements, items]);
  const listRef = useRef<FlashListRef<FeedEntry>>(null);
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

  const scrollToTop = useCallback(() => {
    setActiveIndex(0);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  useVideoPrefetch(items, activeReelIndex);

  const {
    basketListingIds,
    offerListingIds,
    addBasket: markBasket,
    addOffer: markOffer
  } = useBuyerStatus(accessToken);

  const handleNavigate = useCallback(
    (item: ReelPlayableItem) => {
      if (item.listingId) {
        router.push({
          pathname: "/listing/[id]",
          params: {
            id: item.listingId,
            data: JSON.stringify(item)
          }
        });
      }
    },
    [router]
  );

  const [basketTarget, setBasketTarget] = useState<string | null>(null);
  const basketAdd = useBasketAdd({
    accessToken,
    listingId: basketTarget ?? "",
    onSuccess: () => {
      if (basketTarget) {
        markBasket(basketTarget);
      }
      setBasketTarget(null);
    }
  });

  useEffect(() => {
    if (basketTarget && basketTarget !== "") {
      void basketAdd.add();
    }
  }, [basketTarget, basketAdd]);

  const handleAddToBasket = useCallback((item: ReelPlayableItem) => {
    if (item.listingId) {
      setBasketTarget(item.listingId);
    }
  }, []);

  const handleMakeOffer = useCallback((item: ReelPlayableItem) => {
    setOfferItem(item);
  }, []);

  const handleOfferDone = useCallback(() => {
    if (offerItem?.listingId) {
      markOffer(offerItem.listingId);
    }
    setOfferItem(null);
    refresh();
  }, [offerItem, markOffer, refresh]);

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
      return item.kind === "reel" ? (
        <ReelItem
          item={item.reel}
          active={index === activeIndex}
          itemIndex={index}
          userRole={user?.activeRole}
          inBasket={item.reel.listingId ? basketListingIds.has(item.reel.listingId) : false}
          hasOffer={item.reel.listingId ? offerListingIds.has(item.reel.listingId) : false}
          onNavigate={handleNavigate}
          onAddToBasket={handleAddToBasket}
          onMakeOffer={handleMakeOffer}
        />
      ) : null;
    },
    [activeIndex, user?.activeRole, basketListingIds, offerListingIds, handleNavigate, handleAddToBasket, handleMakeOffer]
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

  useEffect(() => {
    if (!isAtEnd) {
      return;
    }
    const timeout = setTimeout(() => {
      scrollToTop();
    }, 4500);
    return () => clearTimeout(timeout);
  }, [isAtEnd, scrollToTop]);

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
        ref={listRef}
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
          <Text style={styles.metaText}>Offline fallback: {error}</Text>
        </View>
      ) : null}
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
        visible={Boolean(offerItem)}
        onRequestClose={() => setOfferItem(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setOfferItem(null)}>
          <View testID="offer-sheet" style={styles.sheet}>
            {offerItem ? (
              <OfferFlow
                item={offerItem}
                accessToken={accessToken}
                onDone={handleOfferDone}
              />
            ) : null}
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
