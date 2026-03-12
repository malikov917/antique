#!/usr/bin/env bash
set -euo pipefail

API_PORT="${API_PORT:-4000}"
MOBILE_PORT="${MOBILE_PORT:-8081}"
API_START_TIMEOUT_SECONDS="${API_START_TIMEOUT_SECONDS:-25}"
MOBILE_START_TIMEOUT_SECONDS="${MOBILE_START_TIMEOUT_SECONDS:-45}"
ANDROID_BOOT_TIMEOUT_SECONDS="${ANDROID_BOOT_TIMEOUT_SECONDS:-120}"
EXPO_DEV_URL="${EXPO_DEV_URL:-exp://10.0.2.2:${MOBILE_PORT}}"
DEMO_PLAYBACK_IDS="${DEMO_PLAYBACK_IDS:-DS00Spx1CV902zP2Yw6xh38GQ01CV5WfBvXMUdr74j4,2B8I3G67hQb5mZy00f1VGfU0202YFWLE9x1xn89J9xk}"
ANDROID_DEVICE_ID="${ANDROID_DEVICE_ID:-}"
ANDROID_AVD_NAME="${ANDROID_AVD_NAME:-}"
ANDROID_SDK_ROOT_DIR="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Library/Android/sdk}}"
ADB_BIN="${ADB_BIN:-}"
EMULATOR_BIN="${EMULATOR_BIN:-}"
ARTIFACT_ROOT="${E2E_ARTIFACT_ROOT:-reports/e2e-artifacts}"
RUN_STAMP="$(date +%Y%m%d-%H%M%S)"
ARTIFACT_DIR="${ARTIFACT_ROOT}/android-workflows-${RUN_STAMP}"

API_PID=""
MOBILE_PID=""
EMULATOR_PID=""
EMULATOR_STARTED_BY_SCRIPT=0
API_LOG_FILE="${ARTIFACT_DIR}/api.log"
MOBILE_LOG_FILE="${ARTIFACT_DIR}/mobile.log"
EMULATOR_LOG_FILE="${ARTIFACT_DIR}/emulator.log"
MAESTRO_LOG_FILE="${ARTIFACT_DIR}/maestro.log"
SETUP_JSON_FILE="${ARTIFACT_DIR}/workflow-setup.json"
SUMMARY_JSON_FILE="${ARTIFACT_DIR}/summary.json"
FLOW_RESULT_FILE="${ARTIFACT_DIR}/flow-results.txt"
FAILURE_SCREENSHOT_FILE="${ARTIFACT_DIR}/failure-screenshot.png"
OBSERVED_UI_ERROR=""

mkdir -p "${ARTIFACT_DIR}"

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
    echo "[ensure-mobile-workflows-android] missing command: $command_name"
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

capture_ui_error() {
  local excerpt=""
  if [[ -f "$MAESTRO_LOG_FILE" ]]; then
    excerpt="$(rg -n "(Assertion|assert|Element|failed|error|not found)" "$MAESTRO_LOG_FILE" | tail -n 3 | tr '\n' '; ' || true)"
  fi
  OBSERVED_UI_ERROR="${excerpt:-No explicit UI assertion line found in maestro log.}"
}

capture_failure_artifacts() {
  if [[ -n "$ANDROID_DEVICE_ID" ]]; then
    "$ADB_BIN" -s "$ANDROID_DEVICE_ID" exec-out screencap -p > "$FAILURE_SCREENSHOT_FILE" 2>/dev/null || true
  fi
  capture_ui_error
}

write_summary() {
  local status="$1"
  SUMMARY_STATUS="$status" \
  SUMMARY_ARTIFACT_DIR="$ARTIFACT_DIR" \
  SUMMARY_SETUP_JSON="$SETUP_JSON_FILE" \
  SUMMARY_FLOW_RESULT="$FLOW_RESULT_FILE" \
  SUMMARY_FAILURE_SCREENSHOT="$FAILURE_SCREENSHOT_FILE" \
  SUMMARY_API_LOG="$API_LOG_FILE" \
  SUMMARY_MOBILE_LOG="$MOBILE_LOG_FILE" \
  SUMMARY_EMULATOR_LOG="$EMULATOR_LOG_FILE" \
  SUMMARY_MAESTRO_LOG="$MAESTRO_LOG_FILE" \
  SUMMARY_UI_ERROR="$OBSERVED_UI_ERROR" \
  node <<'NODE' > "$SUMMARY_JSON_FILE"
const fs = require("node:fs");
const setupPath = process.env.SUMMARY_SETUP_JSON;
let setup = null;
try {
  setup = JSON.parse(fs.readFileSync(setupPath, "utf8"));
} catch {
  setup = null;
}
const flowResultsRaw = fs.existsSync(process.env.SUMMARY_FLOW_RESULT)
  ? fs.readFileSync(process.env.SUMMARY_FLOW_RESULT, "utf8").trim()
  : "";
const flows = flowResultsRaw
  ? flowResultsRaw.split(/\r?\n/).filter(Boolean).map((line) => {
      const [name, result] = line.split("=");
      return { name, result };
    })
  : [];
const summary = {
  status: process.env.SUMMARY_STATUS,
  generatedAt: new Date().toISOString(),
  artifactDir: process.env.SUMMARY_ARTIFACT_DIR,
  workflowSetup: setup,
  maestroFlows: flows,
  observedUiError: process.env.SUMMARY_UI_ERROR || null,
  logs: {
    api: process.env.SUMMARY_API_LOG,
    mobile: process.env.SUMMARY_MOBILE_LOG,
    emulator: process.env.SUMMARY_EMULATOR_LOG,
    maestro: process.env.SUMMARY_MAESTRO_LOG
  },
  failureScreenshot: fs.existsSync(process.env.SUMMARY_FAILURE_SCREENSHOT)
    ? process.env.SUMMARY_FAILURE_SCREENSHOT
    : null
};
process.stdout.write(JSON.stringify(summary, null, 2));
NODE
}

run_flow() {
  local flow_name="$1"
  local flow_path="$2"

  echo "[ensure-mobile-workflows-android] run flow: ${flow_name} (${flow_path})" | tee -a "$MAESTRO_LOG_FILE"
  if maestro test "$flow_path" --device "$ANDROID_DEVICE_ID" -e EXPO_DEV_URL="$EXPO_DEV_URL" 2>&1 | tee -a "$MAESTRO_LOG_FILE"; then
    echo "${flow_name}=passed" >> "$FLOW_RESULT_FILE"
    return 0
  fi

  echo "${flow_name}=failed" >> "$FLOW_RESULT_FILE"
  return 1
}

if ! require_command maestro; then
  echo "[ensure-mobile-workflows-android] install Maestro: https://maestro.mobile.dev/getting-started/installing-maestro"
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
  echo "[ensure-mobile-workflows-android] adb is required (set ANDROID_SDK_ROOT/ANDROID_HOME or ADB_BIN)"
  exit 1
fi

if [[ -z "$ANDROID_DEVICE_ID" ]]; then
  ANDROID_DEVICE_ID="$(resolve_android_device)"
fi

if [[ -z "$ANDROID_DEVICE_ID" ]]; then
  if [[ -z "$ANDROID_AVD_NAME" ]]; then
    echo "[ensure-mobile-workflows-android] no running Android device found"
    echo "[ensure-mobile-workflows-android] boot an emulator/device first or set ANDROID_AVD_NAME to auto-start one"
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
    echo "[ensure-mobile-workflows-android] emulator binary is required when ANDROID_AVD_NAME is set"
    exit 1
  fi
  echo "[ensure-mobile-workflows-android] start emulator: ${ANDROID_AVD_NAME}"
  "$EMULATOR_BIN" -avd "$ANDROID_AVD_NAME" >"$EMULATOR_LOG_FILE" 2>&1 &
  EMULATOR_PID=$!
  EMULATOR_STARTED_BY_SCRIPT=1
fi

if ! wait_for_android_boot "$ANDROID_BOOT_TIMEOUT_SECONDS"; then
  echo "[ensure-mobile-workflows-android] Android device did not reach boot_completed=1"
  print_log_tail "android-emulator" "$EMULATOR_LOG_FILE"
  exit 1
fi

if ! "$ADB_BIN" -s "$ANDROID_DEVICE_ID" shell pm list packages | grep -q "host.exp.exponent"; then
  echo "[ensure-mobile-workflows-android] Expo Go (host.exp.exponent) is not installed on ${ANDROID_DEVICE_ID}"
  exit 1
fi

if [[ "${SKIP_CHECK:-0}" != "1" ]]; then
  echo "[ensure-mobile-workflows-android] lint/typecheck/test"
  pnpm check
fi

echo "[ensure-mobile-workflows-android] build api"
pnpm build

echo "[ensure-mobile-workflows-android] start api"
API_PORT="$API_PORT" DEMO_PLAYBACK_IDS="$DEMO_PLAYBACK_IDS" pnpm --filter @antique/api start >"$API_LOG_FILE" 2>&1 &
API_PID=$!
if ! wait_for_url "http://127.0.0.1:${API_PORT}/health" "$API_START_TIMEOUT_SECONDS" "$API_PID" "api"; then
  print_log_tail "api" "$API_LOG_FILE"
  exit 1
fi

echo "[ensure-mobile-workflows-android] setup API workflow fixtures"
if ! pnpm --filter @antique/api exec node scripts/workflow-e2e-setup.mjs \
  --api-base-url "http://127.0.0.1:${API_PORT}" \
  --api-log-file "$API_LOG_FILE" \
  --db-path "$(pwd)/apps/api/data/antique.sqlite" \
  --platform android > "$SETUP_JSON_FILE"; then
  capture_failure_artifacts
  write_summary "failed"
  echo "[ensure-mobile-workflows-android] failed during workflow setup"
  echo "[ensure-mobile-workflows-android] artifacts: $ARTIFACT_DIR"
  exit 1
fi

APP_ACCESS_TOKEN="$(node -e 'const fs=require("fs"); const payload=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(payload.appAccessToken || "");' "$SETUP_JSON_FILE")"
if [[ -z "$APP_ACCESS_TOKEN" ]]; then
  OBSERVED_UI_ERROR="workflow setup did not produce appAccessToken"
  write_summary "failed"
  echo "[ensure-mobile-workflows-android] setup output missing appAccessToken"
  echo "[ensure-mobile-workflows-android] artifacts: $ARTIFACT_DIR"
  exit 1
fi

echo "[ensure-mobile-workflows-android] start metro"
EXPO_PUBLIC_API_BASE_URL="http://10.0.2.2:${API_PORT}" \
EXPO_PUBLIC_ACCESS_TOKEN="$APP_ACCESS_TOKEN" \
EXPO_NO_TELEMETRY=1 CI=1 \
pnpm --filter @antique/mobile exec expo start --offline --port "$MOBILE_PORT" >"$MOBILE_LOG_FILE" 2>&1 &
MOBILE_PID=$!
if ! wait_for_url "http://127.0.0.1:${MOBILE_PORT}/status" "$MOBILE_START_TIMEOUT_SECONDS" "$MOBILE_PID" "mobile"; then
  print_log_tail "mobile" "$MOBILE_LOG_FILE"
  capture_failure_artifacts
  write_summary "failed"
  echo "[ensure-mobile-workflows-android] artifacts: $ARTIFACT_DIR"
  exit 1
fi

: > "$FLOW_RESULT_FILE"

run_flow "wf1-new-user-buyer-offer" "e2e/maestro/android-workflow-buyer-offer.yaml" || {
  capture_failure_artifacts
  write_summary "failed"
  echo "[ensure-mobile-workflows-android] artifacts: $ARTIFACT_DIR"
  exit 1
}

run_flow "wf2-seller-application-approval-listing" "e2e/maestro/android-workflow-seller-application.yaml" || {
  capture_failure_artifacts
  write_summary "failed"
  echo "[ensure-mobile-workflows-android] artifacts: $ARTIFACT_DIR"
  exit 1
}

run_flow "wf3-day-close-behavior-notifications" "e2e/maestro/android-workflow-day-close.yaml" || {
  capture_failure_artifacts
  write_summary "failed"
  echo "[ensure-mobile-workflows-android] artifacts: $ARTIFACT_DIR"
  exit 1
}

write_summary "passed"

echo "[ensure-mobile-workflows-android] all green"
echo "[ensure-mobile-workflows-android] artifacts: $ARTIFACT_DIR"
echo "[ensure-mobile-workflows-android] summary: $SUMMARY_JSON_FILE"
