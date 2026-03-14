#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

declare -a RECORDS=()

add_record() {
  local ts="$1"
  local code="$2"
  local source="$3"
  if [[ -n "$code" ]]; then
    RECORDS+=("${ts}|${code}|${source}")
  fi
}

extract_records_from_text() {
  local source="$1"
  local text="$2"

  while IFS='|' read -r ts code; do
    [[ -z "${ts:-}" || -z "${code:-}" ]] && continue
    add_record "$ts" "$code" "$source"
  done < <(
    printf '%s' "$text" | perl -0777 -ne '
      while (/"time":\s*([0-9]{10,13}).{0,500}?"otpCode":"([0-9]{6})".{0,300}?"msg":"OTP issued"/sg) {
        print "$1|$2\n";
      }
    '
  )
}

collect_from_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    return
  fi
  if ! tmux list-sessions >/dev/null 2>&1; then
    return
  fi

  while IFS= read -r row; do
    [[ -z "$row" ]] && continue
    local session="${row%%:*}"
    local rest="${row#*:}"
    local window_index="${rest%%:*}"
    local window_name="${rest#*:}"
    [[ "$window_name" != "api" ]] && continue

    local pane_text
    pane_text="$(tmux capture-pane -p -t "${session}:${window_index}" -S -6000 2>/dev/null || true)"
    [[ -z "$pane_text" ]] && continue
    extract_records_from_text "tmux:${session}:${window_index}:${window_name}" "$pane_text"
  done < <(tmux list-windows -a -F '#S:#I:#W' 2>/dev/null || true)
}

collect_from_logs() {
  local state_dir="$ROOT_DIR/state/runs"
  [[ -d "$state_dir" ]] || return

  while IFS= read -r -d '' file; do
    local file_text
    file_text="$(cat "$file" 2>/dev/null || true)"
    [[ -z "$file_text" ]] && continue
    extract_records_from_text "file:${file#$ROOT_DIR/}" "$file_text"
  done < <(find "$state_dir" -type f -path '*/logs/api.log' -print0 2>/dev/null)
}

print_latest() {
  local best_ts="-1"
  local best_code=""
  local best_source=""

  for record in "${RECORDS[@]}"; do
    IFS='|' read -r ts code source <<< "$record"
    [[ -z "$ts" || -z "$code" ]] && continue
    if (( ts > best_ts )); then
      best_ts="$ts"
      best_code="$code"
      best_source="$source"
    fi
  done

  if [[ -z "$best_code" ]]; then
    cat <<'EOF'
No OTP found yet.
1) Tap "Send code" in the app.
2) Re-run: ./scripts/get-latest-otp.sh
EOF
    exit 1
  fi

  local iso_time="unknown"
  if [[ "$best_ts" =~ ^[0-9]+$ ]] && (( best_ts > 0 )); then
    local sec=$((best_ts / 1000))
    iso_time="$(date -r "$sec" '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null || echo "unknown")"
  fi

  echo "Latest OTP: $best_code"
  echo "Source: $best_source"
  echo "Time: $iso_time"
}

collect_from_tmux
collect_from_logs
print_latest
