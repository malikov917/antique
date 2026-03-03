#!/usr/bin/env bash
set -euo pipefail

API_PORT="${API_PORT:-4000}"
MOBILE_PORT="${MOBILE_PORT:-8081}"
API_START_TIMEOUT_SECONDS="${API_START_TIMEOUT_SECONDS:-25}"
MOBILE_START_TIMEOUT_SECONDS="${MOBILE_START_TIMEOUT_SECONDS:-45}"
ANDROID_BOOT_TIMEOUT_SECONDS="${ANDROID_BOOT_TIMEOUT_SECONDS:-120}"
EXPO_DEV_URL="${EXPO_DEV_URL:-exp://10.0.2.2:${MOBILE_PORT}}"
MAESTRO_FLOW_PATH="${MAESTRO_FLOW_PATH:-e2e/maestro/android-reels-happy-path.yaml}"
DEMO_PLAYBACK_IDS="${DEMO_PLAYBACK_IDS:-DS00Spx1CV902zP2Yw6xh38GQ01CV5WfBvXMUdr74j4,2B8I3G67hQb5mZy00f1VGfU0202YFWLE9x1xn89J9xk}"
ANDROID_DEVICE_ID="${ANDROID_DEVICE_ID:-}"
ANDROID_AVD_NAME="${ANDROID_AVD_NAME:-}"
ANDROID_SDK_ROOT_DIR="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
ADB_BIN="${ADB_BIN:-}"
EMULATOR_BIN="${EMULATOR_BIN:-}"

API_PID=""
MOBILE_PID=""
EMULATOR_PID=""
EMULATOR_STARTED_BY_SCRIPT=0
API_LOG_FILE="$(mktemp -t antique-api-e2e-android.XXXX.log)"
MOBILE_LOG_FILE="$(mktemp -t antique-mobile-e2e-android.XXXX.log)"
EMULATOR_LOG_FILE="$(mktemp -t antique-emulator-e2e-android.XXXX.log)"

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
  if [[ "$EMULATOR_STARTED_BY_SCRIPT" == "1" ]] && [[ -n "$EMULATOR_PID" ]] && kill -0 "$EMULATOR_PID" 2>/dev/null; then
    kill "$EMULATOR_PID" 2>/dev/null || true
    wait "$EMULATOR_PID" 2>/dev/null || true
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
    echo "[ensure-mobile-happy-path-android] missing command: $command_name"
    return 1
  fi
}

resolve_android_device() {
  "$ADB_BIN" devices | awk 'NR > 1 && $2 == "device" { print $1; exit }'
}

wait_for_android_boot() {
  local timeout_seconds="$1"
  local elapsed=0

  while (( elapsed < timeout_seconds )); do
    if [[ -z "$ANDROID_DEVICE_ID" ]]; then
      ANDROID_DEVICE_ID="$(resolve_android_device)"
    fi
    if [[ -n "$ANDROID_DEVICE_ID" ]]; then
      local boot_completed
      boot_completed="$("$ADB_BIN" -s "$ANDROID_DEVICE_ID" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')"
      if [[ "$boot_completed" == "1" ]]; then
        return 0
      fi
    fi
    sleep 2
    ((elapsed += 2))
  done

  return 1
}

if ! require_command maestro; then
  echo "[ensure-mobile-happy-path-android] install Maestro: https://maestro.mobile.dev/getting-started/installing-maestro"
  exit 1
fi

if [[ -z "$ADB_BIN" ]]; then
  if command -v adb >/dev/null 2>&1; then
    ADB_BIN="$(command -v adb)"
  elif [[ -x "$ANDROID_SDK_ROOT_DIR/platform-tools/adb" ]]; then
    ADB_BIN="$ANDROID_SDK_ROOT_DIR/platform-tools/adb"
  fi
fi

if [[ -z "$ADB_BIN" ]]; then
  echo "[ensure-mobile-happy-path-android] adb is required (set ANDROID_SDK_ROOT/ANDROID_HOME or ADB_BIN)"
  exit 1
fi

if [[ -z "$ANDROID_DEVICE_ID" ]]; then
  ANDROID_DEVICE_ID="$(resolve_android_device)"
fi

if [[ -z "$ANDROID_DEVICE_ID" ]]; then
  if [[ -z "$ANDROID_AVD_NAME" ]]; then
    echo "[ensure-mobile-happy-path-android] no running Android device found"
    echo "[ensure-mobile-happy-path-android] boot an emulator/device first or set ANDROID_AVD_NAME to auto-start one"
    exit 1
  fi
  if [[ -z "$EMULATOR_BIN" ]]; then
    if command -v emulator >/dev/null 2>&1; then
      EMULATOR_BIN="$(command -v emulator)"
    elif [[ -x "$ANDROID_SDK_ROOT_DIR/emulator/emulator" ]]; then
      EMULATOR_BIN="$ANDROID_SDK_ROOT_DIR/emulator/emulator"
    fi
  fi
  if [[ -z "$EMULATOR_BIN" ]]; then
    echo "[ensure-mobile-happy-path-android] emulator binary is required when ANDROID_AVD_NAME is set"
    exit 1
  fi
  echo "[ensure-mobile-happy-path-android] start emulator: ${ANDROID_AVD_NAME}"
  "$EMULATOR_BIN" -avd "$ANDROID_AVD_NAME" >"$EMULATOR_LOG_FILE" 2>&1 &
  EMULATOR_PID=$!
  EMULATOR_STARTED_BY_SCRIPT=1
fi

if ! wait_for_android_boot "$ANDROID_BOOT_TIMEOUT_SECONDS"; then
  echo "[ensure-mobile-happy-path-android] Android device did not reach boot_completed=1"
  print_log_tail "android-emulator" "$EMULATOR_LOG_FILE"
  exit 1
fi

if ! "$ADB_BIN" -s "$ANDROID_DEVICE_ID" shell pm list packages | grep -q "host.exp.exponent"; then
  echo "[ensure-mobile-happy-path-android] Expo Go (host.exp.exponent) is not installed on ${ANDROID_DEVICE_ID}"
  echo "[ensure-mobile-happy-path-android] install Expo Go on device/emulator, then re-run"
  exit 1
fi

if [[ "${SKIP_CHECK:-0}" != "1" ]]; then
  echo "[ensure-mobile-happy-path-android] lint/typecheck/test"
  pnpm check
fi

echo "[ensure-mobile-happy-path-android] build api"
pnpm build

echo "[ensure-mobile-happy-path-android] start api"
API_PORT="$API_PORT" DEMO_PLAYBACK_IDS="$DEMO_PLAYBACK_IDS" pnpm --filter @antique/api start >"$API_LOG_FILE" 2>&1 &
API_PID=$!
if ! wait_for_url "http://127.0.0.1:${API_PORT}/health" "$API_START_TIMEOUT_SECONDS" "$API_PID" "api"; then
  print_log_tail "api" "$API_LOG_FILE"
  exit 1
fi

echo "[ensure-mobile-happy-path-android] start metro"
EXPO_PUBLIC_API_BASE_URL="http://10.0.2.2:${API_PORT}" EXPO_NO_TELEMETRY=1 CI=1 pnpm --filter @antique/mobile exec expo start --offline --port "$MOBILE_PORT" >"$MOBILE_LOG_FILE" 2>&1 &
MOBILE_PID=$!
if ! wait_for_url "http://127.0.0.1:${MOBILE_PORT}/status" "$MOBILE_START_TIMEOUT_SECONDS" "$MOBILE_PID" "mobile"; then
  print_log_tail "mobile" "$MOBILE_LOG_FILE"
  exit 1
fi

echo "[ensure-mobile-happy-path-android] run maestro flow on ${ANDROID_DEVICE_ID}"
maestro test "$MAESTRO_FLOW_PATH" --device "$ANDROID_DEVICE_ID" -e EXPO_DEV_URL="$EXPO_DEV_URL"

echo "[ensure-mobile-happy-path-android] all green"
