import { useEffect, useMemo } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import { VideoView, type VideoPlayer } from "expo-video";
import NativeVideoModule from "expo-video/build/NativeVideoModule";
import type { AuthRole } from "@antique/types";
import type { ReelPlayableItem } from "../hooks/useReelsFeed";
import { useReelPlaybackControls } from "../hooks/useReelPlaybackControls";
import { ReelProgressBar } from "./ReelProgressBar";

const { height, width } = Dimensions.get("window");

function formatPrice(cents: number | undefined, currency: string | undefined): string {
  if (typeof cents !== "number" || !currency) {
    return "";
  }
  const amount = (cents / 100).toFixed(2);
  return `${currency} ${amount}`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

function BuyabilityPill({ item }: { item: ReelPlayableItem }) {
  if (!item.listingStatus) {
    return null;
  }

  const availability = item.availability ?? "in_stock";
  const isAvailable = item.listingStatus === "live" && availability === "in_stock";
  const label = isAvailable ? "In stock" : "Out of stock";

  return (
    <View
      style={[
        styles.buyabilityPill,
        isAvailable ? styles.buyabilityOpen : styles.buyabilityPaused
      ]}
    >
      <Text style={styles.buyabilityText}>{label}</Text>
    </View>
  );
}

export function ReelItem({
  item,
  active,
  itemIndex,
  userRole,
  inBasket,
  hasOffer,
  onNavigate,
  onAddToBasket,
  onMakeOffer
}: {
  item: ReelPlayableItem;
  active: boolean;
  itemIndex: number;
  userRole?: AuthRole | null;
  inBasket?: boolean;
  hasOffer?: boolean;
  onNavigate?: (item: ReelPlayableItem) => void;
  onAddToBasket?: (item: ReelPlayableItem) => void;
  onMakeOffer?: (item: ReelPlayableItem) => void;
}) {
  const player = useCompatVideoPlayer(item.streamUrl);
  const playback = useReelPlaybackControls({ active, player });

  const canInteract =
    userRole === "buyer" &&
    item.listingStatus === "live" &&
    item.availability === "in_stock" &&
    typeof item.listedPriceCents === "number";

  const ctaLabel = useMemo(() => {
    if (!canInteract) {
      if (item.listingStatus === "sold") return "Sold";
      if (item.listingStatus === "day_closed") return "Day closed";
      if (item.availability === "out_of_stock") return "Out of stock";
      return "Unavailable";
    }
    if (hasOffer) return "Offer Submitted";
    if (inBasket) return "Make Offer";
    return "Add to Basket";
  }, [canInteract, hasOffer, inBasket, item]);

  const ctaDisabled = !canInteract || hasOffer;

  const handleCtaPress = () => {
    if (ctaDisabled) return;
    if (inBasket) {
      onMakeOffer?.(item);
    } else {
      onAddToBasket?.(item);
    }
  };

  return (
    <View style={styles.wrapper} testID={`reel-item-${itemIndex}`}>
      <Pressable style={styles.videoContainer} onPress={() => onNavigate?.(item)}>
        <View style={styles.videoFrame}>
          <VideoView
            style={styles.video}
            player={player}
            nativeControls={false}
            contentFit="cover"
            testID={`reel-video-${itemIndex}`}
          />
          <View style={styles.overlay}>
            <ReelProgressBar
              active={active}
              durationSec={playback.durationSec}
              shownTimeSec={playback.shownTimeSec}
              playedProgress={playback.playedProgress}
              bufferedProgress={playback.bufferedProgress}
              onScrubStart={playback.beginScrub}
              onScrubMove={playback.moveScrub}
              onScrubEnd={playback.endScrub}
              testID={`reel-progress-${itemIndex}`}
            />
            <View style={styles.infoBlock}>
              <Text style={styles.title} numberOfLines={1}>
                {item.title || "Untitled listing"}
              </Text>
              {item.listedPriceCents ? (
                <Text style={styles.price}>{formatPrice(item.listedPriceCents, item.currency)}</Text>
              ) : null}
              <Text style={styles.author}>@{item.author}</Text>
              <Text style={styles.description} numberOfLines={2}>
                {truncate(item.caption, 120)}
              </Text>
            </View>
            <BuyabilityPill item={item} />
            {userRole === "buyer" ? (
              <Pressable
                style={[styles.ctaButton, ctaDisabled && styles.ctaButtonDisabled]}
                disabled={ctaDisabled}
                onPress={handleCtaPress}
                testID={`reel-cta-button-${itemIndex}`}
              >
                <Text style={styles.ctaButtonText}>{ctaLabel}</Text>
              </Pressable>
            ) : null}
            <Text style={styles.freshness}>{formatFreshnessLabel(item.freshnessAgeSec, item.freshnessUpdatedAt)}</Text>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

function useCompatVideoPlayer(streamUrl: string): VideoPlayer {
  const player = useMemo(() => {
    return new NativeVideoModule.VideoPlayer({ uri: streamUrl }, false) as VideoPlayer;
  }, [streamUrl]);

  useEffect(() => {
    return () => {
      (player as { release?: () => void }).release?.();
    };
  }, [player]);

  return player;
}

function formatFreshnessLabel(freshnessAgeSec: number | undefined, freshnessUpdatedAt: string | undefined): string {
  if (typeof freshnessAgeSec === "number") {
    if (freshnessAgeSec < 60) {
      return "Fresh now";
    }
    if (freshnessAgeSec < 3600) {
      return `Updated ${Math.floor(freshnessAgeSec / 60)}m ago`;
    }
    return `Updated ${Math.floor(freshnessAgeSec / 3600)}h ago`;
  }

  if (!freshnessUpdatedAt) {
    return "Freshness unknown";
  }

  const ageMs = Date.now() - Date.parse(freshnessUpdatedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0) {
    return "Freshness unknown";
  }

  const ageSec = Math.floor(ageMs / 1000);
  if (ageSec < 60) {
    return "Fresh now";
  }
  if (ageSec < 3600) {
    return `Updated ${Math.floor(ageSec / 60)}m ago`;
  }
  return `Updated ${Math.floor(ageSec / 3600)}h ago`;
}

const styles = StyleSheet.create({
  wrapper: {
    width,
    height,
    backgroundColor: "#050505"
  },
  videoContainer: {
    width: "100%",
    height: "100%"
  },
  videoFrame: {
    width: "100%",
    height: "100%"
  },
  video: {
    width: "100%",
    height: "100%"
  },
  overlay: {
    position: "absolute",
    bottom: 64,
    left: 20,
    right: 20,
    gap: 8
  },
  infoBlock: {
    gap: 4,
    marginBottom: 4
  },
  title: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700"
  },
  price: {
    color: "#f7d6a0",
    fontSize: 16,
    fontWeight: "700"
  },
  author: {
    color: "#aaaaaa",
    fontSize: 13,
    fontWeight: "600"
  },
  description: {
    color: "#eeeeee",
    fontSize: 14,
    lineHeight: 20
  },
  freshness: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(5,5,5,0.55)",
    borderColor: "rgba(255,255,255,0.35)",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    color: "#ececec",
    fontSize: 12,
    fontWeight: "600"
  },
  buyabilityPill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#3a3a3a",
    backgroundColor: "rgba(0,0,0,0.45)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginBottom: 4
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
  ctaButton: {
    alignSelf: "flex-start",
    backgroundColor: "#f8f8f8",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 4
  },
  ctaButtonDisabled: {
    opacity: 0.5
  },
  ctaButtonText: {
    color: "#111111",
    fontWeight: "700",
    fontSize: 13
  }
});
