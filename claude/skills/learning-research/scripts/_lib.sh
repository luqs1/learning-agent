#!/usr/bin/env bash
# Shared helpers for learning-research scripts. Source this; do not run it.
#
# Conventions every script follows:
#   --help            usage on stdout, exit 0
#   JSON on stdout    (unless the script documents a text mode)
#   errors on stderr  exit 1 = failure, exit 2 = missing API key / not available
#   no shared temp files: everything goes through mktemp, so scripts are safe
#   to run concurrently (a future parallel-research step can fan them out).
#
# Dependencies: bash 3.2+, curl, jq, python3 (stdlib only). Nothing else.

set -euo pipefail

SCRIPT_NAME=$(basename "$0")
LA_UA="${LEARNING_AGENT_UA:-learning-agent/1.1 (+https://github.com/luqs1/learning-agent)}"

die()  { echo "$SCRIPT_NAME: $*" >&2; exit 1; }
warn() { echo "$SCRIPT_NAME: $*" >&2; }

# need <cmd>...  — abort if a dependency is missing
need() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die "requires '$c' but it is not in PATH"
  done
}

# missing_key <ENV_VAR> <where to get it> <keyless fallback>  — exit 2
missing_key() {
  {
    echo "$SCRIPT_NAME: $1 is not set, so this provider is unavailable."
    echo "  Get a key: $2"
    echo "  Keyless fallback: $3"
  } >&2
  exit 2
}

# urlenc <string> — percent-encode for a query string
urlenc() { jq -rn --arg v "$1" '$v|@uri'; }

# is_int <value>
is_int() { [[ "$1" =~ ^[0-9]+$ ]]; }

# Per-process temp dir, removed on exit. Unique per invocation -> concurrency safe.
LA_TMP=$(mktemp -d "${TMPDIR:-/tmp}/la-${SCRIPT_NAME%.sh}.XXXXXX")
trap 'rm -rf "$LA_TMP"' EXIT

# http_get <url> [extra curl args...]
# GET with retries on 429/5xx (backoff 2,4,8s). Prints body on 2xx.
# Non-2xx after retries -> message on stderr, exit 1.
http_get() {
  local url=$1; shift
  _http GET "$url" "$@"
}

# http_post <url> <json-body> [extra curl args...]
http_post() {
  local url=$1 body=$2; shift 2
  _http POST "$url" -H 'content-type: application/json' --data-binary "$body" "$@"
}

_http() {
  local method=$1 url=$2; shift 2
  local out="$LA_TMP/resp.$RANDOM$RANDOM" code attempt=0 delay=2
  while :; do
    attempt=$((attempt + 1))
    code=$(curl -sS -L --max-time "${LA_TIMEOUT:-60}" -X "$method" -A "$LA_UA" \
           -o "$out" -w '%{http_code}' "$@" "$url" 2>"$out.err") || {
      if [ "$attempt" -ge 3 ]; then
        die "network error fetching $url: $(head -c 300 "$out.err")"
      fi
      sleep "$delay"; delay=$((delay * 2)); continue
    }
    case "$code" in
      2*) cat "$out"; return 0 ;;
      429|500|502|503|504)
        if [ "$attempt" -ge 4 ]; then
          die "HTTP $code from $url after $attempt attempts: $(head -c 300 "$out" | tr '\n' ' ')"
        fi
        warn "HTTP $code, retrying in ${delay}s ($attempt/4)"
        sleep "$delay"; delay=$((delay * 2)) ;;
      *)
        die "HTTP $code from $url: $(head -c 300 "$out" | tr '\n' ' ')" ;;
    esac
  done
}

# strip_html — stdin HTML fragment -> plain text (entities decoded, whitespace collapsed)
strip_html() {
  python3 -c '
import sys, re, html
s = sys.stdin.read()
s = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", s)
s = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>", "\n", s)
s = re.sub(r"<[^>]+>", " ", s)
s = html.unescape(s)
s = re.sub(r"[ \t]+", " ", s)
s = re.sub(r"\n\s*\n+", "\n", s)
sys.stdout.write(s.strip())
'
}

# want_help "$@" — true if --help/-h present or no args at all
want_help() {
  [ $# -eq 0 ] && return 0
  local a
  for a in "$@"; do
    case "$a" in --help|-h) return 0 ;; esac
  done
  return 1
}
