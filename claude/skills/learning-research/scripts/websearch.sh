#!/usr/bin/env bash
# websearch.sh — keyed web search: Brave (BRAVE_API_KEY) or Tavily (TAVILY_API_KEY).
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: websearch.sh <query> [--limit N] [--freshness pd|pw|pm|py] [--country GB|US] [--provider brave|tavily]

General web search from the shell, for when the built-in WebSearch tool is not
available (e.g. opencode) or you want a second engine.
  BRAVE_API_KEY   -> Brave Search API  https://api.search.brave.com/res/v1/web/search
                     (free plan: 2,000 queries/month; https://brave.com/search/api/)
  TAVILY_API_KEY  -> Tavily            https://api.tavily.com/search
                     (free: 1,000 credits/month; https://tavily.com)
Provider order: --provider, else Brave, else Tavily. With neither key set the
script exits 2 — use the built-in WebSearch tool, which needs no key.

--freshness  Brave only: pd (24h), pw (week), pm (month), py (year)
--country    Brave only: 2-letter code for localised results (GB for UK market research)

Output: JSON array of {title, url, description, published, provider}
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq

query="" limit=10 fresh="" country="" provider=""
while [ $# -gt 0 ]; do
  case "$1" in
    --limit) limit=$2; shift 2 ;;
    --freshness) fresh=$2; shift 2 ;;
    --country) country=$2; shift 2 ;;
    --provider) provider=$2; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) query="${query:+$query }$1"; shift ;;
  esac
done
[ -n "$query" ] || die "a query is required"
if [ -z "$provider" ]; then
  if [ -n "${BRAVE_API_KEY:-}" ]; then provider=brave
  elif [ -n "${TAVILY_API_KEY:-}" ]; then provider=tavily
  else missing_key "BRAVE_API_KEY or TAVILY_API_KEY" "https://brave.com/search/api/ or https://tavily.com (both have free tiers)" \
         "use the built-in WebSearch tool (no key needed)"
  fi
fi

case "$provider" in
  brave)
    [ -n "${BRAVE_API_KEY:-}" ] || missing_key BRAVE_API_KEY "https://brave.com/search/api/" "built-in WebSearch tool"
    url="https://api.search.brave.com/res/v1/web/search?q=$(urlenc "$query")&count=$limit"
    [ -n "$fresh" ] && url="$url&freshness=$fresh"
    [ -n "$country" ] && url="$url&country=$country"
    http_get "$url" -H "X-Subscription-Token: $BRAVE_API_KEY" -H "accept: application/json" \
      | jq '[.web.results[]? | {title, url, description, published: (.page_age // .age // null), provider: "brave"}]'
    ;;
  tavily)
    [ -n "${TAVILY_API_KEY:-}" ] || missing_key TAVILY_API_KEY "https://tavily.com" "built-in WebSearch tool"
    body=$(jq -n --arg q "$query" --argjson n "$limit" '{query: $q, max_results: $n, search_depth: "basic"}')
    http_post https://api.tavily.com/search "$body" -H "authorization: Bearer $TAVILY_API_KEY" \
      | jq '[.results[] | {title, url, description: .content, published: (.published_date // null), provider: "tavily"}]'
    ;;
  *) die "unknown provider '$provider'" ;;
esac
