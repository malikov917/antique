#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

API_PORT="${API_PORT:-4000}"
MOBILE_PORT="${MOBILE_PORT:-8081}"
API_START_TIMEOUT_SECONDS="${API_START_TIMEOUT_SECONDS:-30}"
MOBILE_START_TIMEOUT_SECONDS="${MOBILE_START_TIMEOUT_SECONDS:-60}"
IOS_DEVICE_ID="${IOS_DEVICE_ID:-}"
HOST_IP="${HOST_IP:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)}"
RUN_DIR="${RUN_DIR:-$ROOT_DIR/state/runs/ios-role-screen-audit/$(date +%Y%m%d-%H%M%S)}"
DB_PATH="${API_DB_PATH:-$ROOT_DIR/apps/api/data/antique.sqlite}"
RESET_DB="${RESET_DB:-0}"
DEMO_PLAYBACK_IDS="${DEMO_PLAYBACK_IDS:-kF01v9aKFlY63i2GkQKQGDv5Y9PbMGdtQD92j5qJCYWU,OfjbQ3esQifgboENTs4oDXslCP5sSnst,sp9WNcgcktsmlvFLKgNm3jjSGRD00RPlq}"

# Deterministic demo users for re-use across runs.
BUYER_PHONE="${BUYER_PHONE:-+4915123400011}"
BUYER2_PHONE="${BUYER2_PHONE:-+4915123400014}"
SELLER_PHONE="${SELLER_PHONE:-+4915123400012}"
ADMIN_PHONE="${ADMIN_PHONE:-+4915123400013}"

API_LOG="$RUN_DIR/logs/api.log"
MOBILE_LOG_DIR="$RUN_DIR/logs/mobile"
ARTIFACTS_DIR="$RUN_DIR/artifacts"
TOKENS_FILE="$RUN_DIR/tokens.env"
LATEST_TOKENS_FILE="$ROOT_DIR/state/seed-users-latest.env"
SEED_SUMMARY_FILE="$RUN_DIR/seed-summary.md"

mkdir -p "$RUN_DIR/logs" "$MOBILE_LOG_DIR" "$ARTIFACTS_DIR"
mkdir -p "$(dirname "$DB_PATH")"

if [[ "$RESET_DB" == "1" ]] && [[ -f "$DB_PATH" ]]; then
  rm -f "$DB_PATH"
fi

API_PID=""
MOBILE_PID=""

cleanup() {
  if [[ -n "$MOBILE_PID" ]] && kill -0 "$MOBILE_PID" 2>/dev/null; then
    kill "$MOBILE_PID" 2>/dev/null || true
    wait "$MOBILE_PID" 2>/dev/null || true
  fi
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
    wait "$API_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "[run-ios-role-screen-audit] missing command: $command_name"
    exit 1
  fi
}

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

json_field() {
  local field="$1"
  node -e "let s=''; process.stdin.on('data', d => s += d).on('end', () => { const j = JSON.parse(s); console.log(${field}); });"
}

extract_last_otp_code() {
  local phone="$1"
  local line
  line="$(rg -F "\"phoneE164\":\"${phone}\"" "$API_LOG" | tail -n 1 || true)"
  if [[ -z "$line" ]]; then
    echo ""
    return
  fi
  sed -n 's/.*"otpCode":"\([0-9]\{6\}\)".*/\1/p' <<<"$line"
}

request_access_token() {
  local phone="$1"
  local device_id="$2"
  local request_response verify_response otp_code token user_id

  request_response="$(curl --silent --show-error -X POST "http://127.0.0.1:${API_PORT}/v1/auth/otp/request" \
    -H 'content-type: application/json' \
    -d "{\"phone\":\"${phone}\"}" )"

  if grep -q 'otp_request_cooldown\|rate_limited' <<<"$request_response"; then
    sleep 2
    request_response="$(curl --silent --show-error -X POST "http://127.0.0.1:${API_PORT}/v1/auth/otp/request" \
      -H 'content-type: application/json' \
      -d "{\"phone\":\"${phone}\"}" )"
  fi

  echo "[auth] otp request for ${phone}: ${request_response}" >&2

  otp_code=""
  for _ in $(seq 1 25); do
    otp_code="$(extract_last_otp_code "$phone")"
    if [[ -n "$otp_code" ]]; then
      break
    fi
    sleep 1
  done

  if [[ -z "$otp_code" ]]; then
    echo "[auth] failed to extract OTP code for ${phone} from ${API_LOG}" >&2
    exit 1
  fi

  verify_response="$(curl --silent --show-error --fail -X POST "http://127.0.0.1:${API_PORT}/v1/auth/otp/verify" \
    -H 'content-type: application/json' \
    -d "{\"phone\":\"${phone}\",\"code\":\"${otp_code}\",\"deviceId\":\"${device_id}\",\"platform\":\"ios\"}")"

  token="$(json_field 'j.tokens.accessToken' <<<"$verify_response")"
  user_id="$(json_field 'j.user.id' <<<"$verify_response")"

  printf '%s|%s\n' "$token" "$user_id"
}

api_post_json() {
  local token="$1"
  local path="$2"
  local json_body="$3"
  curl --silent --show-error --fail -X POST "http://127.0.0.1:${API_PORT}${path}" \
    -H "authorization: Bearer ${token}" \
    -H 'content-type: application/json' \
    -d "$json_body"
}

api_patch_json() {
  local token="$1"
  local path="$2"
  local json_body="$3"
  curl --silent --show-error --fail -X PATCH "http://127.0.0.1:${API_PORT}${path}" \
    -H "authorization: Bearer ${token}" \
    -H 'content-type: application/json' \
    -d "$json_body"
}

api_get() {
  local token="$1"
  local path="$2"
  curl --silent --show-error --fail "http://127.0.0.1:${API_PORT}${path}" \
    -H "authorization: Bearer ${token}"
}

seed_marketplace_data() {
  local buyer_token="$1"
  local buyer_user_id="$2"
  local buyer2_token="$3"
  local seller_token="$4"
  local seller_user_id="$5"
  local admin_token="$6"
  local admin_user_id="$7"
  local refreshed_admin_token_and_id

  sqlite3 "$DB_PATH" "UPDATE users SET allowed_roles='[\"buyer\",\"seller\",\"admin\"]', active_role='admin' WHERE id='${admin_user_id}';"
  refreshed_admin_token_and_id="$(request_access_token "$ADMIN_PHONE" "audit-admin-ios-elevated")"
  admin_token="${refreshed_admin_token_and_id%%|*}"

  curl --silent --show-error -X POST "http://127.0.0.1:${API_PORT}/v1/seller/apply" \
    -H "authorization: Bearer ${seller_token}" \
    -H 'content-type: application/json' \
    -d '{"fullName":"Seller Demo","shopName":"Antique Seller Demo","note":"e2e-seed"}' >/dev/null
  curl --silent --show-error -X POST "http://127.0.0.1:${API_PORT}/v1/admin/seller-applications/${seller_user_id}/approve" \
    -H "authorization: Bearer ${admin_token}" >/dev/null
  api_post_json "$seller_token" "/v1/me/role-switch" '{"role":"seller"}' >/dev/null

  local open_session_response session_id
  open_session_response="$(api_post_json "$seller_token" "/v1/seller/sessions/open" '{}')"
  session_id="$(json_field 'j.session.id' <<<"$open_session_response")"

  local listing1_response listing2_response listing3_response
  local listing1_id listing2_id listing3_id

  listing1_response="$(api_post_json "$seller_token" "/v1/listings" '{"title":"Vintage Bronze Lamp","description":"Restored market-find lamp with patina","listedPriceCents":11000,"currency":"USD"}')"
  listing2_response="$(api_post_json "$seller_token" "/v1/listings" '{"title":"Art Deco Vase","description":"Blue glazed vase in strong condition","listedPriceCents":8500,"currency":"USD"}')"
  listing3_response="$(api_post_json "$seller_token" "/v1/listings" '{"title":"Carved Wooden Box","description":"Hand-carved trinket box","listedPriceCents":6400,"currency":"USD"}')"

  listing1_id="$(json_field 'j.listing.id' <<<"$listing1_response")"
  listing2_id="$(json_field 'j.listing.id' <<<"$listing2_response")"
  listing3_id="$(json_field 'j.listing.id' <<<"$listing3_response")"

  api_post_json "$buyer_token" "/v1/listings/${listing1_id}/basket" '{}' >/dev/null
  api_post_json "$buyer2_token" "/v1/listings/${listing1_id}/basket" '{}' >/dev/null
  api_post_json "$buyer_token" "/v1/listings/${listing2_id}/basket" '{}' >/dev/null

  local offer1_response offer2_response offer3_response
  local offer1_id offer2_id offer3_id

  offer1_response="$(api_post_json "$buyer_token" "/v1/listings/${listing1_id}/offers" '{"amountCents":12900,"shippingAddress":"Berlin Buyer One, Hauptstrasse 1"}')"
  offer2_response="$(api_post_json "$buyer2_token" "/v1/listings/${listing1_id}/offers" '{"amountCents":12100,"shippingAddress":"Berlin Buyer Two, Nebenstrasse 5"}')"
  offer3_response="$(api_post_json "$buyer_token" "/v1/listings/${listing2_id}/offers" '{"amountCents":9000,"shippingAddress":"Berlin Buyer One, Hauptstrasse 1"}')"

  offer1_id="$(json_field 'j.offer.id' <<<"$offer1_response")"
  offer2_id="$(json_field 'j.offer.id' <<<"$offer2_response")"
  offer3_id="$(json_field 'j.offer.id' <<<"$offer3_response")"

  local accept_response deal_id
  accept_response="$(api_post_json "$seller_token" "/v1/offers/${offer1_id}/accept" '{}')"
  deal_id="$(json_field 'j.deal.id' <<<"$accept_response")"

  api_post_json "$seller_token" "/v1/offers/${offer3_id}/decline" '{}' >/dev/null

  local chats_response chat_id
  chats_response="$(api_get "$buyer_token" "/v1/chats")"
  chat_id="$(json_field 'j.chats[0].id' <<<"$chats_response")"

  if [[ -n "$chat_id" && "$chat_id" != "undefined" ]]; then
    api_post_json "$buyer_token" "/v1/chats/${chat_id}/messages" '{"text":"Hi, I can pay today by bank transfer."}' >/dev/null
    api_post_json "$seller_token" "/v1/chats/${chat_id}/messages" '{"text":"Great, I sent bank details and shipping ETA."}' >/dev/null
  fi

  local correction_response correction_id
  correction_response="$(api_post_json "$buyer_token" "/v1/deals/${deal_id}/address-corrections" '{"shippingAddress":"Berlin Buyer One, Updated Address 10","reason":"Apartment number correction"}')"
  correction_id="$(json_field 'j.correction.id' <<<"$correction_response")"

  api_post_json "$seller_token" "/v1/deals/${deal_id}/address-corrections/${correction_id}/approve" '{}' >/dev/null
  api_patch_json "$buyer_token" "/v1/deals/${deal_id}/status" '{"status":"paid","reasonCode":"bank_transfer_received"}' >/dev/null
  api_patch_json "$seller_token" "/v1/deals/${deal_id}/status" '{"status":"completed","reasonCode":"fulfilled_and_delivered"}' >/dev/null

  api_post_json "$seller_token" "/v1/announcements" '{"title":"Fresh arrivals this evening","body":"Three new collectible items just listed."}' >/dev/null
  curl --silent --show-error --fail -X POST "http://127.0.0.1:${API_PORT}/v1/seller/sessions/${session_id}/close" \
    -H "authorization: Bearer ${seller_token}" >/dev/null

cat > "$SEED_SUMMARY_FILE" <<SUMMARY
# Seed Summary

- Phones (credentials):
  - Buyer: ${BUYER_PHONE}
  - Buyer2: ${BUYER2_PHONE}
  - Seller: ${SELLER_PHONE}
  - Admin: ${ADMIN_PHONE}
- Buyer user: ${buyer_user_id}
- Buyer2 user: ${BUYER2_USER_ID}
- Seller user: ${seller_user_id}
- Admin user: ${admin_user_id}
- Session: ${session_id}
- Listings: ${listing1_id}, ${listing2_id}, ${listing3_id}
- Offers: ${offer1_id} (accepted), ${offer2_id} (auto-declined), ${offer3_id} (declined)
- Deal: ${deal_id}
- Chat: ${chat_id}
- Address correction: ${correction_id}
SUMMARY
}

start_mobile() {
  local role="$1"
  local token="$2"
  local mobile_log="$MOBILE_LOG_DIR/${role}.log"

  if [[ -n "$MOBILE_PID" ]] && kill -0 "$MOBILE_PID" 2>/dev/null; then
    kill "$MOBILE_PID" 2>/dev/null || true
    wait "$MOBILE_PID" 2>/dev/null || true
  fi

  if [[ -n "$token" ]]; then
    EXPO_PUBLIC_API_BASE_URL="http://${HOST_IP}:${API_PORT}" \
      EXPO_PUBLIC_ACCESS_TOKEN="$token" \
      EXPO_NO_TELEMETRY=1 CI=1 \
      pnpm --filter @antique/mobile exec expo start --offline --port "$MOBILE_PORT" >"$mobile_log" 2>&1 &
  else
    EXPO_PUBLIC_API_BASE_URL="http://${HOST_IP}:${API_PORT}" \
      EXPO_NO_TELEMETRY=1 CI=1 \
      pnpm --filter @antique/mobile exec expo start --offline --port "$MOBILE_PORT" >"$mobile_log" 2>&1 &
  fi

  MOBILE_PID=$!
  if ! wait_for_url "http://127.0.0.1:${MOBILE_PORT}/status" "$MOBILE_START_TIMEOUT_SECONDS" "$MOBILE_PID" "mobile-${role}"; then
    echo "[mobile-${role}] failed to start"
    tail -n 120 "$mobile_log" || true
    exit 1
  fi
}

run_flow() {
  local role="$1"
  local flow_file="$2"
  local output_dir="$ARTIFACTS_DIR/${role}"

  mkdir -p "$output_dir"

  maestro test "$flow_file" \
    --device "$IOS_DEVICE_ID" \
    --test-output-dir "$output_dir" \
    --debug-output "$output_dir/debug" \
    -e EXPO_DEV_URL="exp://${HOST_IP}:${MOBILE_PORT}"
}

require_command pnpm
require_command maestro
require_command sqlite3
require_command rg
require_command xcrun
require_command node

if [[ -z "$IOS_DEVICE_ID" ]]; then
  IOS_DEVICE_ID="$(xcrun simctl list devices booted | awk -F '[()]' '/iPhone/ && /\(Booted\)/ { print $2; exit }')"
fi

if [[ -z "$IOS_DEVICE_ID" ]]; then
  echo "[run-ios-role-screen-audit] no booted iPhone simulator detected"
  exit 1
fi

if [[ "${SKIP_CHECK:-0}" != "1" ]]; then
  pnpm --filter @antique/types build
  pnpm --filter @antique/api build
fi

API_PORT="$API_PORT" API_DB_PATH="$DB_PATH" DEMO_PLAYBACK_IDS="$DEMO_PLAYBACK_IDS" pnpm --filter @antique/api start >"$API_LOG" 2>&1 &
API_PID=$!

if ! wait_for_url "http://127.0.0.1:${API_PORT}/health" "$API_START_TIMEOUT_SECONDS" "$API_PID" "api"; then
  tail -n 200 "$API_LOG" || true
  exit 1
fi

BUYER_TOKEN_AND_ID="$(request_access_token "$BUYER_PHONE" "audit-buyer-ios")"
BUYER_TOKEN="${BUYER_TOKEN_AND_ID%%|*}"
BUYER_USER_ID="${BUYER_TOKEN_AND_ID##*|}"

BUYER2_TOKEN_AND_ID="$(request_access_token "$BUYER2_PHONE" "audit-buyer2-ios")"
BUYER2_TOKEN="${BUYER2_TOKEN_AND_ID%%|*}"
BUYER2_USER_ID="${BUYER2_TOKEN_AND_ID##*|}"

SELLER_TOKEN_AND_ID="$(request_access_token "$SELLER_PHONE" "audit-seller-ios")"
SELLER_TOKEN="${SELLER_TOKEN_AND_ID%%|*}"
SELLER_USER_ID="${SELLER_TOKEN_AND_ID##*|}"

ADMIN_TOKEN_AND_ID="$(request_access_token "$ADMIN_PHONE" "audit-admin-ios")"
ADMIN_TOKEN="${ADMIN_TOKEN_AND_ID%%|*}"
ADMIN_USER_ID="${ADMIN_TOKEN_AND_ID##*|}"

seed_marketplace_data \
  "$BUYER_TOKEN" "$BUYER_USER_ID" \
  "$BUYER2_TOKEN" \
  "$SELLER_TOKEN" "$SELLER_USER_ID" \
  "$ADMIN_TOKEN" "$ADMIN_USER_ID"

cat > "$TOKENS_FILE" <<TOKENS
BUYER_PHONE=${BUYER_PHONE}
BUYER_USER_ID=${BUYER_USER_ID}
BUYER_ACCESS_TOKEN=${BUYER_TOKEN}
BUYER2_PHONE=${BUYER2_PHONE}
BUYER2_USER_ID=${BUYER2_USER_ID}
BUYER2_ACCESS_TOKEN=${BUYER2_TOKEN}
SELLER_PHONE=${SELLER_PHONE}
SELLER_USER_ID=${SELLER_USER_ID}
SELLER_ACCESS_TOKEN=${SELLER_TOKEN}
ADMIN_PHONE=${ADMIN_PHONE}
ADMIN_USER_ID=${ADMIN_USER_ID}
ADMIN_ACCESS_TOKEN=${ADMIN_TOKEN}
TOKENS

cp "$TOKENS_FILE" "$LATEST_TOKENS_FILE"

start_mobile "guest" ""
run_flow "guest" "e2e/maestro/ios-screen-audit-guest.yaml"

start_mobile "buyer" "$BUYER_TOKEN"
run_flow "buyer" "e2e/maestro/ios-screen-audit-buyer.yaml"

start_mobile "seller" "$SELLER_TOKEN"
run_flow "seller" "e2e/maestro/ios-screen-audit-seller.yaml"

echo "[run-ios-role-screen-audit] complete"
echo "Run directory: $RUN_DIR"
echo "Artifacts: $ARTIFACTS_DIR"
echo "Seed summary: $SEED_SUMMARY_FILE"
