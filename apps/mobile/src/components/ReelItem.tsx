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
