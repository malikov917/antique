#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_PHONE="${1:-${OTP_PHONE:-}}"

declare -a RECORDS=()

add_record() {
  local ts="$1"
  local phone="$2"
  local code="$3"
  local source="$4"
  if [[ -n "$code" ]]; then
    RECORDS+=("${ts}|${phone}|${code}|${source}")
  fi
}

extract_records_from_text() {
  local source="$1"
  local text="$2"

  while IFS='|' read -r ts phone code; do
    [[ -z "${ts:-}" || -z "${code:-}" ]] && continue
    add_record "$ts" "$phone" "$code" "$source"
  done < <(
    printf '%s' "$text" | perl -0777 -ne '
      while (/"time":\s*([0-9]{10,13})(?:(?!\n\n).){0,1500}/sg) {
        my $ts = $1;
        my $chunk = $&;
        next unless $chunk =~ /"msg":"OTP issued"/;
        next unless $chunk =~ /"otpCode":"([0-9]{6})"/;
        my $code = $1;
        my $phone = "";
        $phone = $1 if $chunk =~ /"phoneE164":"(\+[0-9]{8,20})"/;
        $phone = $1 if !$phone && $chunk =~ /"phone":"(\+[0-9]{8,20})"/;
        print "$ts|$phone|$code\n";
      }
    '
  )
}

collect_from_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    return 0
  fi
  if ! tmux list-sessions >/dev/null 2>&1; then
    return 0
  fi

  while IFS= read -r row; do
    [[ -z "$row" ]] && continue
    local session="${row%%:*}"
    local rest="${row#*:}"
    local window_index="${rest%%:*}"
    local window_name="${rest#*:}"
    [[ "$window_name" != "api" ]] && continue

    local pane_text
    pane_text="$(tmux capture-pane -J -p -t "${session}:${window_index}" -S -6000 2>/dev/null || true)"
    [[ -z "$pane_text" ]] && continue
    extract_records_from_text "tmux:${session}:${window_index}:${window_name}" "$pane_text"
  done < <(tmux list-windows -a -F '#S:#I:#W' 2>/dev/null || true)
}

collect_from_logs() {
  local state_dir="$ROOT_DIR/state/runs"
  [[ -d "$state_dir" ]] || return 0

  while IFS= read -r -d '' file; do
    local file_text
    file_text="$(cat "$file" 2>/dev/null || true)"
    [[ -z "$file_text" ]] && continue
    extract_records_from_text "file:${file#$ROOT_DIR/}" "$file_text"
  done < <(find "$state_dir" -type f -path '*/logs/api.log' -print0 2>/dev/null)
}

print_latest() {
  local best_ts="-1"
  local best_phone=""
  local best_code=""
  local best_source=""

  for record in "${RECORDS[@]}"; do
    IFS='|' read -r ts phone code source <<< "$record"
    [[ -z "$ts" || -z "$code" ]] && continue
    if [[ -n "$TARGET_PHONE" && "$phone" != "$TARGET_PHONE" ]]; then
      continue
    fi
    if (( ts > best_ts )); then
      best_ts="$ts"
      best_phone="$phone"
      best_code="$code"
      best_source="$source"
    fi
  done

  if [[ -z "$best_code" ]]; then
    local phone_hint="$TARGET_PHONE"
    if [[ -z "$phone_hint" ]]; then
      phone_hint="<any phone>"
    fi
    cat <<'EOF'
No OTP found yet.
1) Tap "Send code" in the app.
2) Re-run: ./scripts/get-latest-otp.sh +4915...
EOF
    echo "Phone filter: $phone_hint"
    exit 1
  fi

  local iso_time="unknown"
  if [[ "$best_ts" =~ ^[0-9]+$ ]] && (( best_ts > 0 )); then
    local sec=$((best_ts / 1000))
    iso_time="$(date -r "$sec" '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null || echo "unknown")"
  fi

  echo "Latest OTP: $best_code"
  if [[ -n "$best_phone" ]]; then
    echo "Phone: $best_phone"
  fi
  echo "Source: $best_source"
  echo "Time: $iso_time"
}

collect_from_tmux
collect_from_logs
print_latest
