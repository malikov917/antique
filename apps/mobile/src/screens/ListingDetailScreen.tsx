import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { VideoView, type VideoPlayer } from "expo-video";
import NativeVideoModule from "expo-video/build/NativeVideoModule";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { ReelPlayableItem } from "../hooks/useReelsFeed";
import { useAuthSession } from "../auth/session";
import { useBuyerStatus } from "../hooks/useBuyerStatus";
import { useBasketAdd } from "../hooks/useBasketAdd";
import { OfferFlow } from "../components/OfferFlow";

const { width, height } = Dimensions.get("window");

function formatPrice(cents: number | undefined, currency: string | undefined): string {
  if (typeof cents !== "number" || !currency) {
    return "";
  }
  const amount = (cents / 100).toFixed(2);
  return `${currency} ${amount}`;
}

function useCompatVideoPlayer(streamUrl: string): VideoPlayer {
  const player = useMemo(() => {
    return new NativeVideoModule.VideoPlayer({ uri: streamUrl }, false) as VideoPlayer;
  }, [streamUrl]);

  return player;
}

export function ListingDetailScreen() {
  const router = useRouter();
  const { id, data } = useLocalSearchParams<{ id: string; data?: string }>();
  const { accessToken, user } = useAuthSession();
  const parsedItem: ReelPlayableItem | null = useMemo(() => {
    if (data) {
      try {
        return JSON.parse(data) as ReelPlayableItem;
      } catch {
        return null;
      }
    }
    return null;
  }, [data]);

  const {
    basketListingIds,
    offerListingIds,
    addBasket: markBasket
  } = useBuyerStatus(accessToken);

  const isInBasket = parsedItem?.listingId ? basketListingIds.has(parsedItem.listingId) : false;
  const hasOffer = parsedItem?.listingId ? offerListingIds.has(parsedItem.listingId) : false;

  const [offerOpen, setOfferOpen] = useState(false);
  const [localBasket, setLocalBasket] = useState(false);
  const [localOffer, setLocalOffer] = useState(false);

  const inBasket = isInBasket || localBasket;
  const offerSubmitted = hasOffer || localOffer;

  const basket = useBasketAdd({
    accessToken,
    listingId: parsedItem?.listingId ?? id,
    onSuccess: () => {
      if (parsedItem?.listingId) {
        markBasket(parsedItem.listingId);
      }
      setLocalBasket(true);
    }
  });

  const handleAddToBasket = useCallback(() => {
    void basket.add();
  }, [basket]);

  const handleMakeOffer = useCallback(() => {
    setOfferOpen(true);
  }, []);

  const handleOfferDone = useCallback(() => {
    setOfferOpen(false);
    setLocalOffer(true);
  }, []);

  const canInteract =
    user?.activeRole === "buyer" &&
    parsedItem?.listingStatus === "live" &&
    parsedItem?.availability === "in_stock" &&
    typeof parsedItem?.listedPriceCents === "number";

  const ctaLabel = useMemo(() => {
    if (!canInteract) {
      if (parsedItem?.listingStatus === "sold") return "Sold";
      if (parsedItem?.listingStatus === "day_closed") return "Day closed";
      if (parsedItem?.availability === "out_of_stock") return "Out of stock";
      return "Unavailable";
    }
    if (offerSubmitted) return "Offer Submitted";
    if (inBasket) return "Make Offer";
    return "Add to Basket";
  }, [canInteract, offerSubmitted, inBasket, parsedItem]);

  const ctaDisabled = !canInteract || offerSubmitted || basket.loading || offerOpen;

  const player = useCompatVideoPlayer(parsedItem?.streamUrl ?? "");

  if (!parsedItem) {
    return (
      <View style={styles.root}>
        <Text style={styles.errorText}>Listing not found</Text>
        <Pressable style={styles.backButton} onPress={router.back}>
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.videoFrame}>
          <VideoView style={styles.video} player={player} nativeControls={false} contentFit="cover" />
        </View>
        <View style={styles.infoSection}>
          <Text style={styles.title}>{parsedItem.title || "Untitled listing"}</Text>
          <Text style={styles.price}>{formatPrice(parsedItem.listedPriceCents, parsedItem.currency)}</Text>
          <Text style={styles.author}>@{parsedItem.author}</Text>
          <Text style={styles.description}>{parsedItem.caption}</Text>
        </View>
        {basket.error ? <Text style={styles.errorText}>{basket.error}</Text> : null}
        <Pressable
          style={[styles.ctaButton, ctaDisabled && styles.ctaButtonDisabled]}
          disabled={ctaDisabled}
          onPress={inBasket ? handleMakeOffer : handleAddToBasket}
          testID="listing-detail-cta"
        >
          {basket.loading ? (
            <ActivityIndicator color="#111111" />
          ) : (
            <Text style={styles.ctaButtonText}>{ctaLabel}</Text>
          )}
        </Pressable>
      </ScrollView>
      <Pressable style={styles.backFloating} onPress={router.back} testID="listing-detail-back">
        <Text style={styles.backFloatingText}>← Back</Text>
      </Pressable>
      {offerOpen && parsedItem ? (
        <View style={styles.offerSheet}>
          <OfferFlow
            item={parsedItem}
            accessToken={accessToken}
            onDone={handleOfferDone}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#050505"
  },
  scrollContent: {
    paddingBottom: 40
  },
  videoFrame: {
    width,
    height: height * 0.55,
    backgroundColor: "#000"
  },
  video: {
    width: "100%",
    height: "100%"
  },
  infoSection: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    gap: 10
  },
  title: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "700"
  },
  price: {
    color: "#f7d6a0",
    fontSize: 18,
    fontWeight: "700"
  },
  author: {
    color: "#aaaaaa",
    fontSize: 14,
    fontWeight: "600"
  },
  description: {
    color: "#eeeeee",
    fontSize: 15,
    lineHeight: 22
  },
  errorText: {
    color: "#ff9789",
    fontSize: 14,
    paddingHorizontal: 20,
    marginTop: 8
  },
  ctaButton: {
    marginHorizontal: 20,
    marginTop: 16,
    backgroundColor: "#f8f8f8",
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52
  },
  ctaButtonDisabled: {
    opacity: 0.5
  },
  ctaButtonText: {
    color: "#111111",
    fontWeight: "700",
    fontSize: 16
  },
  backFloating: {
    position: "absolute",
    top: 56,
    left: 16,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8
  },
  backFloatingText: {
    color: "#f1f1f1",
    fontWeight: "700",
    fontSize: 14
  },
  backButton: {
    marginTop: 20,
    alignSelf: "center",
    backgroundColor: "#f8f8f8",
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 10
  },
  backButtonText: {
    color: "#111111",
    fontWeight: "700"
  },
  offerSheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#151515",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 24,
    maxHeight: "84%"
  }
});
