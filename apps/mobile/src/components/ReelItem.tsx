import { useEffect, useMemo } from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import { VideoView, type VideoPlayer } from "expo-video";
import NativeVideoModule from "expo-video/build/NativeVideoModule";
import type { ReelPlayableItem } from "../hooks/useReelsFeed";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming
} from "react-native-reanimated";

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
  const heartScale = useSharedValue(0);
  const heartOpacity = useSharedValue(0);

  useEffect(() => {
    player.loop = true;
    if (active) {
      player.play();
    } else {
      player.pause();
    }
  }, [active, player]);

  const animateLike = () => {
    heartScale.value = 0.65;
    heartOpacity.value = 1;
    heartScale.value = withSequence(withSpring(1.2), withTiming(0, { duration: 220 }));
    heartOpacity.value = withSequence(
      withTiming(1, { duration: 80 }),
      withDelay(220, withTiming(0, { duration: 180 }))
    );
  };

  const tap = Gesture.Tap()
    .numberOfTaps(2)
    .onStart(() => {
      runOnJS(animateLike)();
    });

  const animatedHeartStyle = useAnimatedStyle(() => ({
    opacity: heartOpacity.value,
    transform: [{ scale: heartScale.value }]
  }));

  return (
    <View style={styles.wrapper} testID={`reel-item-${itemIndex}`}>
      <GestureDetector gesture={tap}>
        <View style={styles.videoContainer}>
          <VideoView
            style={styles.video}
            player={player}
            contentFit="cover"
            testID={`reel-video-${itemIndex}`}
          />
          <Animated.View style={[styles.heart, animatedHeartStyle]}>
            <Text style={styles.heartText}>❤</Text>
          </Animated.View>
          <View style={styles.overlay}>
            <Text style={styles.author}>@{item.author}</Text>
            <Text style={styles.caption}>{item.caption}</Text>
          </View>
        </View>
      </GestureDetector>
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
  },
  heart: {
    position: "absolute",
    alignSelf: "center",
    top: "43%"
  },
  heartText: {
    fontSize: 80,
    color: "#ffffff"
  }
});
