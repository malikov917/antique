#!/usr/bin/env bash
set -euo pipefail

API_PORT="${API_PORT:-4000}"
MOBILE_PORT="${MOBILE_PORT:-8081}"
API_START_TIMEOUT_SECONDS="${API_START_TIMEOUT_SECONDS:-25}"
MOBILE_START_TIMEOUT_SECONDS="${MOBILE_START_TIMEOUT_SECONDS:-45}"
EXPO_DEV_URL="${EXPO_DEV_URL:-exp://127.0.0.1:${MOBILE_PORT}}"
MAESTRO_FLOW_PATH="${MAESTRO_FLOW_PATH:-e2e/maestro/ios-reels-happy-path.yaml}"
DEMO_PLAYBACK_IDS="${DEMO_PLAYBACK_IDS:-DS00Spx1CV902zP2Yw6xh38GQ01CV5WfBvXMUdr74j4,2B8I3G67hQb5mZy00f1VGfU0202YFWLE9x1xn89J9xk}"
IOS_DEVICE_ID="${IOS_DEVICE_ID:-}"

API_PID=""
MOBILE_PID=""
API_LOG_FILE="$(mktemp -t antique-api-e2e.XXXX.log)"
MOBILE_LOG_FILE="$(mktemp -t antique-mobile-e2e.XXXX.log)"

print_log_tail() {
  local title="$1"
  local file="$2"
  if [[ -f "$file" ]]; then
    echo "[$title] tail"
    tail -n 40 "$file" || true
  fi
}

cleanup() {
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "$MOBILE_PID" ]] && kill -0 "$MOBILE_PID" 2>/dev/null; then
    kill "$MOBILE_PID" 2>/dev/null || true
    wait "$MOBILE_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

wait_for_url() {
  local url="$1"
  local timeout_seconds="$2"
  local process_pid="$3"
  local description="$4"
  local elapsed=0

  while (( elapsed < timeout_seconds )); do
    if ! kill -0 "$process_pid" 2>/dev/null; then
      echo "[$description] process exited before endpoint became ready"
      return 1
    fi
    if curl --silent --show-error --fail "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    ((elapsed += 1))
  done

  echo "[$description] timed out after ${timeout_seconds}s waiting for $url"
  return 1
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "[ensure-mobile-happy-path] missing command: $command_name"
    return 1
  fi
}

if ! require_command maestro; then
  echo "[ensure-mobile-happy-path] install Maestro: https://maestro.mobile.dev/getting-started/installing-maestro"
  exit 1
fi

if ! require_command xcrun; then
  echo "[ensure-mobile-happy-path] xcrun is required for iOS simulator checks"
  exit 1
fi

if ! xcrun --find simctl >/dev/null 2>&1; then
  echo "[ensure-mobile-happy-path] xcrun simctl is unavailable"
  echo "[ensure-mobile-happy-path] install Xcode command line tools or full Xcode to run iOS simulator smoke tests"
  exit 1
fi

if ! xcrun simctl list devices booted | grep -q "(Booted)"; then
  echo "[ensure-mobile-happy-path] no booted iOS simulator found"
  echo "[ensure-mobile-happy-path] boot simulator first, then run this command again"
  exit 1
fi

if [[ -z "$IOS_DEVICE_ID" ]]; then
  IOS_DEVICE_ID="$(xcrun simctl list devices booted | awk -F '[()]' '/iPhone/ && /\(Booted\)/ { print $2; exit }')"
fi

if [[ -z "$IOS_DEVICE_ID" ]]; then
  echo "[ensure-mobile-happy-path] could not resolve a booted iPhone simulator UDID"
  exit 1
fi

if [[ "${SKIP_CHECK:-0}" != "1" ]]; then
  echo "[ensure-mobile-happy-path] lint/typecheck/test"
  pnpm check
fi

echo "[ensure-mobile-happy-path] build api"
pnpm build

echo "[ensure-mobile-happy-path] start api"
API_PORT="$API_PORT" DEMO_PLAYBACK_IDS="$DEMO_PLAYBACK_IDS" pnpm --filter @antique/api start >"$API_LOG_FILE" 2>&1 &
API_PID=$!
if ! wait_for_url "http://127.0.0.1:${API_PORT}/health" "$API_START_TIMEOUT_SECONDS" "$API_PID" "api"; then
  print_log_tail "api" "$API_LOG_FILE"
  exit 1
fi

echo "[ensure-mobile-happy-path] start metro"
EXPO_PUBLIC_API_BASE_URL="http://127.0.0.1:${API_PORT}" EXPO_NO_TELEMETRY=1 CI=1 pnpm --filter @antique/mobile exec expo start --offline --port "$MOBILE_PORT" >"$MOBILE_LOG_FILE" 2>&1 &
MOBILE_PID=$!
if ! wait_for_url "http://127.0.0.1:${MOBILE_PORT}/status" "$MOBILE_START_TIMEOUT_SECONDS" "$MOBILE_PID" "mobile"; then
  print_log_tail "mobile" "$MOBILE_LOG_FILE"
  exit 1
fi

echo "[ensure-mobile-happy-path] run maestro flow"
maestro test "$MAESTRO_FLOW_PATH" --device "$IOS_DEVICE_ID" -e EXPO_DEV_URL="$EXPO_DEV_URL"

echo "[ensure-mobile-happy-path] all green"
