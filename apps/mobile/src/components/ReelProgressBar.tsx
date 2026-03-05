import { useCallback, useMemo, useState } from "react";
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent
} from "react-native";

const PROGRESS_THUMB_SIZE = 14;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatTimestamp(seconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

interface ReelProgressBarProps {
  active: boolean;
  bufferedProgress: number;
  durationSec: number;
  playedProgress: number;
  shownTimeSec: number;
  testID?: string;
  onScrubStart: (progress: number) => void;
  onScrubMove: (progress: number) => void;
  onScrubEnd: (progress: number) => void;
}

export function ReelProgressBar(props: ReelProgressBarProps) {
  const {
    active,
    bufferedProgress,
    durationSec,
    playedProgress,
    shownTimeSec,
    testID,
    onScrubStart,
    onScrubMove,
    onScrubEnd
  } = props;
  const [trackWidth, setTrackWidth] = useState(0);

  const toProgress = useCallback(
    (event: GestureResponderEvent): number => {
      if (trackWidth <= 0) {
        return 0;
      }
      return clamp(event.nativeEvent.locationX / trackWidth, 0, 1);
    },
    [trackWidth]
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => active,
        onMoveShouldSetPanResponder: () => active,
        onPanResponderGrant: (event) => {
          onScrubStart(toProgress(event));
        },
        onPanResponderMove: (event) => {
          onScrubMove(toProgress(event));
        },
        onPanResponderRelease: (event) => {
          onScrubEnd(toProgress(event));
        },
        onPanResponderTerminate: (event) => {
          onScrubEnd(toProgress(event));
        },
        onPanResponderTerminationRequest: () => true
      }),
    [active, onScrubEnd, onScrubMove, onScrubStart, toProgress]
  );

  const onTrackLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  const thumbLeft =
    trackWidth > 0
      ? clamp(
          trackWidth * playedProgress - PROGRESS_THUMB_SIZE / 2,
          0,
          trackWidth - PROGRESS_THUMB_SIZE
        )
      : 0;

  return (
    <View style={styles.section}>
      <View style={styles.timeRow}>
        <Text style={styles.timeLabel}>{formatTimestamp(shownTimeSec)}</Text>
        <Text style={styles.timeLabel}>{formatTimestamp(durationSec)}</Text>
      </View>
      <View
        style={styles.touchArea}
        onLayout={onTrackLayout}
        testID={testID}
        {...panResponder.panHandlers}
      >
        <View style={styles.track} />
        <View style={[styles.buffered, { width: `${bufferedProgress * 100}%` }]} />
        <View style={[styles.played, { width: `${playedProgress * 100}%` }]} />
        <View style={[styles.thumb, { left: thumbLeft }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 8,
    gap: 8
  },
  timeRow: {
    flexDirection: "row",
    justifyContent: "space-between"
  },
  timeLabel: {
    color: "#f0f0f0",
    fontSize: 12,
    fontWeight: "600"
  },
  touchArea: {
    width: "100%",
    height: 28,
    justifyContent: "center"
  },
  track: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.3)"
  },
  buffered: {
    position: "absolute",
    left: 0,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.45)"
  },
  played: {
    position: "absolute",
    left: 0,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#ffffff"
  },
  thumb: {
    position: "absolute",
    width: PROGRESS_THUMB_SIZE,
    height: PROGRESS_THUMB_SIZE,
    borderRadius: 999,
    backgroundColor: "#ffffff"
  }
});
