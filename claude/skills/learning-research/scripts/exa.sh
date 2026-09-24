#!/usr/bin/env bash
# exa.sh — Exa neural search, findSimilar and contents via the REST API. Requires EXA_API_KEY.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: exa.sh search   <query> [--limit N] [--category company|research paper|news|pdf|github|personal site|people|financial report] [--since YYYY-MM-DD] [--domain a.com,b.org] [--text]
       exa.sh similar  <url>   [--limit N] [--text]      # findSimilar: the adjacent-material query
       exa.sh contents <url> [<url>...]                  # full page text as markdown

Exa (https://docs.exa.ai) — semantic search that understands "a blog post by a
practitioner arguing X". Needs EXA_API_KEY (https://dashboard.exa.ai, free tier).
In Claude Code the Exa MCP server exposes the same search as
`mcp__exa__web_search_exa` / `web_search_advanced_exa` / `web_fetch_exa`, but not
findSimilar — that is what this script adds.

Keyless fallbacks: search -> the built-in WebSearch tool;
                   similar -> s2.sh recommend / openalex.sh related (papers) or
                              WebSearch "related:<url>" / "<title> alternative" (web);
                   contents -> fetch-readable.sh <url>

Output: search/similar -> [{title, url, published, author, score, text?}]; contents -> [{url, title, text}]
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq
[ -n "${EXA_API_KEY:-}" ] || missing_key EXA_API_KEY "https://dashboard.exa.ai (free tier)" \
  "search: built-in WebSearch; similar: s2.sh recommend | openalex.sh related | WebSearch; contents: fetch-readable.sh"

cmd=$1; shift
args=() limit=10 category="" since="" domains="" text=false
while [ $# -gt 0 ]; do
  case "$1" in
    --limit) limit=$2; shift 2 ;;
    --category) category=$2; shift 2 ;;
    --since) since=$2; shift 2 ;;
    --domain) domains=$2; shift 2 ;;
    --text) text=true; shift ;;
    -*) die "unknown option $1" ;;
    *) args+=("$1"); shift ;;
  esac
done
[ ${#args[@]} -gt 0 ] || die "missing argument (see --help)"
SHAPE='[.results[] | {title, url, published: .publishedDate, author, score, text: (.text // null)}]'
hdr=(-H "x-api-key: $EXA_API_KEY" -H "accept: application/json")

case "$cmd" in
  search)
    body=$(jq -n --arg q "${args[*]}" --argjson n "$limit" --arg c "$category" --arg s "$since" --arg d "$domains" --argjson t "$text" '
      {query: $q, numResults: $n, type: "auto"}
      + (if $c != "" then {category: $c} else {} end)
      + (if $s != "" then {startPublishedDate: $s} else {} end)
      + (if $d != "" then {includeDomains: ($d | split(","))} else {} end)
      + (if $t then {contents: {text: {maxCharacters: 4000}}} else {} end)')
    http_post https://api.exa.ai/search "$body" "${hdr[@]}" | jq "$SHAPE"
    ;;
  similar)
    body=$(jq -n --arg u "${args[0]}" --argjson n "$limit" --argjson t "$text" '
      {url: $u, numResults: $n, excludeSourceDomain: true} + (if $t then {contents: {text: {maxCharacters: 4000}}} else {} end)')
    http_post https://api.exa.ai/findSimilar "$body" "${hdr[@]}" | jq "$SHAPE"
    ;;
  contents)
    body=$(jq -n --args '{urls: $ARGS.positional, text: true}' -- "${args[@]}")
    http_post https://api.exa.ai/contents "$body" "${hdr[@]}" | jq '[.results[] | {url, title, published: .publishedDate, text}]'
    ;;
  *) die "unknown command '$cmd' (see --help)" ;;
esac
