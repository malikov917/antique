import { useEffect, useMemo } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import { VideoView, type VideoPlayer } from "expo-video";
import NativeVideoModule from "expo-video/build/NativeVideoModule";
import type { ReelPlayableItem } from "../hooks/useReelsFeed";
import { useReelPlaybackControls } from "../hooks/useReelPlaybackControls";
import { ReelProgressBar } from "./ReelProgressBar";

const { height, width } = Dimensions.get("window");

export function ReelItem({
  item,
  active,
  itemIndex
}: {
  item: ReelPlayableItem;
  active: boolean;
  itemIndex: number;
}) {
  const player = useCompatVideoPlayer(item.streamUrl);
  const playback = useReelPlaybackControls({ active, player });

  return (
    <View style={styles.wrapper} testID={`reel-item-${itemIndex}`}>
      <Pressable style={styles.videoContainer} onPress={playback.togglePlayback}>
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
            <Text style={styles.freshness}>{formatFreshnessLabel(item.freshnessAgeSec, item.freshnessUpdatedAt)}</Text>
            <Text style={styles.author}>@{item.author}</Text>
            <Text style={styles.caption}>{item.caption}</Text>
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
  author: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700"
  },
  caption: {
    color: "#eeeeee",
    fontSize: 15
  }
});
