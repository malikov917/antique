---
name: antique-reels-mobile-control
description: Build and verify the reels mobile experience with autoplay, swipe performance, and animation quality checks.
---

# Antique Reels Mobile Control

## Core Checks
- Full-screen vertical snapping.
- Only active item plays video.
- Next/previous items are prepared to reduce startup delay.
- Smooth gesture handling under fast repeated swipes.
- Double-tap like animation does not block scrolling.

## Delivery Notes
- Prefer `@shopify/flash-list` for feed performance.
- Use `react-native-reanimated` for visual transitions.
- Use `expo-video` for playback controls.
- Keep overlays lightweight to avoid frame drops.

## Verification
1. Confirm active item autoplays.
2. Confirm off-screen item is paused.
3. Confirm slow network fallback state is visible.
4. Confirm no crash on background/foreground transitions.

