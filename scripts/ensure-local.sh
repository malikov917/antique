#!/usr/bin/env bash
set -euo pipefail

API_PORT="${API_PORT:-4000}"
MOBILE_PORT="${MOBILE_PORT:-8081}"
API_START_TIMEOUT_SECONDS="${API_START_TIMEOUT_SECONDS:-25}"
MOBILE_START_TIMEOUT_SECONDS="${MOBILE_START_TIMEOUT_SECONDS:-45}"

API_PID=""
MOBILE_PID=""
API_LOG_FILE="$(mktemp -t antique-api-smoke.XXXX.log)"
MOBILE_LOG_FILE="$(mktemp -t antique-mobile-smoke.XXXX.log)"

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

echo "[ensure-local] lint/typecheck/test"
pnpm check

echo "[ensure-local] build"
pnpm build

echo "[ensure-local] api runtime smoke"
API_PORT="$API_PORT" pnpm --filter @antique/api start >"$API_LOG_FILE" 2>&1 &
API_PID=$!
if ! wait_for_url "http://127.0.0.1:${API_PORT}/health" "$API_START_TIMEOUT_SECONDS" "$API_PID" "api"; then
  print_log_tail "api" "$API_LOG_FILE"
  exit 1
fi

if ! curl --silent --show-error --fail "http://127.0.0.1:${API_PORT}/v1/feed" | grep -q '"items"'; then
  echo "[api] /v1/feed response did not contain expected payload shape"
  print_log_tail "api" "$API_LOG_FILE"
  exit 1
fi
echo "[ensure-local] api smoke passed"

echo "[ensure-local] mobile runtime smoke"
EXPO_NO_TELEMETRY=1 CI=1 pnpm --filter @antique/mobile exec expo start --offline --port "$MOBILE_PORT" >"$MOBILE_LOG_FILE" 2>&1 &
MOBILE_PID=$!
if ! wait_for_url "http://127.0.0.1:${MOBILE_PORT}/status" "$MOBILE_START_TIMEOUT_SECONDS" "$MOBILE_PID" "mobile"; then
  print_log_tail "mobile" "$MOBILE_LOG_FILE"
  exit 1
fi

MOBILE_STATUS="$(curl --silent --show-error --fail "http://127.0.0.1:${MOBILE_PORT}/status")"
if [[ "$MOBILE_STATUS" != *"packager-status:running"* ]]; then
  echo "[mobile] unexpected /status response: $MOBILE_STATUS"
  print_log_tail "mobile" "$MOBILE_LOG_FILE"
  exit 1
fi
echo "[ensure-local] mobile smoke passed"

echo "[ensure-local] all green"
