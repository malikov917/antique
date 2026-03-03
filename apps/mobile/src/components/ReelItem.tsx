import { useEffect } from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import { VideoView, useVideoPlayer } from "expo-video";
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

export function ReelItem({ item, active }: { item: ReelPlayableItem; active: boolean }) {
  const player = useVideoPlayer(item.streamUrl, (createdPlayer) => {
    createdPlayer.loop = true;
    if (active) {
      createdPlayer.play();
    }
  });
  const heartScale = useSharedValue(0);
  const heartOpacity = useSharedValue(0);

  useEffect(() => {
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
    <View style={styles.wrapper}>
      <GestureDetector gesture={tap}>
        <View style={styles.videoContainer}>
          <VideoView style={styles.video} player={player} contentFit="cover" />
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
