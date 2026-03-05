import { useCallback, useEffect, useMemo, useState } from "react";
import type { VideoPlayer } from "expo-video";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampProgress(value: number): number {
  return clamp(value, 0, 1);
}

function safePositiveNumber(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function toTimeFromProgress(progress: number, durationSec: number): number {
  if (durationSec <= 0) {
    return 0;
  }
  return clampProgress(progress) * durationSec;
}

export interface ReelPlaybackControls {
  bufferedProgress: number;
  bufferedTimeSec: number;
  durationSec: number;
  isScrubbing: boolean;
  playedProgress: number;
  shownTimeSec: number;
  togglePlayback: () => void;
  beginScrub: (progress: number) => void;
  moveScrub: (progress: number) => void;
  endScrub: (progress: number) => void;
}

export function useReelPlaybackControls(params: {
  active: boolean;
  player: VideoPlayer;
}): ReelPlaybackControls {
  const { active, player } = params;
  const [pausedByTap, setPausedByTap] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [bufferedTimeSec, setBufferedTimeSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [scrubTimeSec, setScrubTimeSec] = useState<number | null>(null);

  useEffect(() => {
    player.loop = true;
    if (!active) {
      player.pause();
      setPausedByTap(false);
      setIsScrubbing(false);
      setScrubTimeSec(null);
      return;
    }
    if (!pausedByTap && !isScrubbing) {
      player.play();
      return;
    }
    player.pause();
  }, [active, isScrubbing, pausedByTap, player]);

  useEffect(() => {
    const syncPlayback = () => {
      setDurationSec(safePositiveNumber(player.duration));
      setBufferedTimeSec(safePositiveNumber(player.bufferedPosition));
      if (!isScrubbing) {
        setCurrentTimeSec(safePositiveNumber(player.currentTime));
      }
    };

    syncPlayback();
    const timer = setInterval(syncPlayback, 200);
    return () => {
      clearInterval(timer);
    };
  }, [isScrubbing, player]);

  const scrubToProgress = useCallback(
    (progress: number): number => {
      const nextTime = toTimeFromProgress(progress, durationSec);
      setScrubTimeSec(nextTime);
      return nextTime;
    },
    [durationSec]
  );

  const togglePlayback = useCallback(() => {
    if (!active || isScrubbing) {
      return;
    }
    if (player.playing) {
      player.pause();
      setPausedByTap(true);
      return;
    }
    player.play();
    setPausedByTap(false);
  }, [active, isScrubbing, player]);

  const beginScrub = useCallback(
    (progress: number) => {
      if (!active) {
        return;
      }
      player.pause();
      setPausedByTap(true);
      setIsScrubbing(true);
      scrubToProgress(progress);
    },
    [active, player, scrubToProgress]
  );

  const moveScrub = useCallback(
    (progress: number) => {
      if (!isScrubbing) {
        return;
      }
      scrubToProgress(progress);
    },
    [isScrubbing, scrubToProgress]
  );

  const endScrub = useCallback(
    (progress: number) => {
      if (!active) {
        return;
      }
      const finalTime = scrubToProgress(progress);
      if (durationSec > 0) {
        player.currentTime = finalTime;
        setCurrentTimeSec(finalTime);
      }
      setScrubTimeSec(null);
      setIsScrubbing(false);
      player.pause();
      setPausedByTap(true);
    },
    [active, durationSec, player, scrubToProgress]
  );

  const shownTimeSec = scrubTimeSec ?? currentTimeSec;
  const playedProgress = durationSec > 0 ? clampProgress(shownTimeSec / durationSec) : 0;
  const bufferedProgress = durationSec > 0 ? clampProgress(bufferedTimeSec / durationSec) : 0;

  return useMemo(
    () => ({
      bufferedProgress,
      bufferedTimeSec,
      durationSec,
      isScrubbing,
      playedProgress,
      shownTimeSec,
      togglePlayback,
      beginScrub,
      moveScrub,
      endScrub
    }),
    [
      beginScrub,
      bufferedProgress,
      bufferedTimeSec,
      durationSec,
      endScrub,
      isScrubbing,
      moveScrub,
      playedProgress,
      shownTimeSec,
      togglePlayback
    ]
  );
}
