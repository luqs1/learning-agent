#!/usr/bin/env bash
# hn.sh — Hacker News via the Algolia API. Free, no key.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: hn.sh <query> [--comments|--stories|--ask|--show] [--limit N] [--since YYYY-MM-DD] [--by-date] [--min-points N]
       hn.sh item <id> [--max-comments N]

Algolia HN Search API (https://hn.algolia.com/api). Customer/practitioner
sentiment, launch reactions, "Ask HN: alternatives to X".

--stories      only stories (default: stories and comments)
--comments     only comments (what people actually say about a product)
--since        only items created after this date
--by-date      sort newest first instead of by relevance/points
--min-points   stories with at least N points
item <id>      fetch a whole thread (story + flattened comments) for reading

Output: JSON array of {id, type, title, url, author, points, num_comments,
        created_at, hn_url, text}; item -> {id, title, url, points, comments[{id, author, created_at, depth, text}]}
Sentiment evidence is Tier 5 (forum): quote verbatim, note the date and sample size.
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq

BASE=https://hn.algolia.com/api/v1
if [ "$1" = item ]; then
  shift; id=$1; shift; maxc=200
  while [ $# -gt 0 ]; do case "$1" in --max-comments) maxc=$2; shift 2 ;; *) die "unknown option $1" ;; esac; done
  http_get "$BASE/items/$id" | jq --argjson n "$maxc" '
    def walk_c(d): .children[]? | {id, author, created_at, depth: d, text: ((.text // "") | gsub("<[^>]+>"; " ") | gsub("&#x27;"; "'"'"'") | gsub("&quot;"; "\"") | gsub("&gt;"; ">") | gsub("&lt;"; "<") | gsub("&amp;"; "&") | gsub("\\s+"; " "))}, walk_c(d+1);
    {id, title, url, author, points, created_at, hn_url: ("https://news.ycombinator.com/item?id=" + (.id|tostring)),
     text: ((.text // "") | gsub("<[^>]+>"; " ")), comments: ([walk_c(0)] | .[:$n])}'
  exit 0
fi

query="" tags="" limit=20 since="" bydate="" minp=""
while [ $# -gt 0 ]; do
  case "$1" in
    --stories) tags=story; shift ;;
    --comments) tags=comment; shift ;;
    --ask) tags=ask_hn; shift ;;
    --show) tags=show_hn; shift ;;
    --limit) limit=$2; shift 2 ;;
    --since) since=$2; shift 2 ;;
    --by-date) bydate=1; shift ;;
    --min-points) minp=$2; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) query="${query:+$query }$1"; shift ;;
  esac
done
[ -n "$query" ] || die "a query is required"

ep=search; [ -n "$bydate" ] && ep=search_by_date
url="$BASE/$ep?query=$(urlenc "$query")&hitsPerPage=$limit"
[ -n "$tags" ] && url="$url&tags=$tags"
nf=""
[ -n "$since" ] && nf="created_at_i>$(python3 -c "import datetime,sys; print(int(datetime.datetime.strptime('$since','%Y-%m-%d').timestamp()))")"
[ -n "$minp" ] && nf="${nf:+$nf,}points>=$minp"
[ -n "$nf" ] && url="$url&numericFilters=$(urlenc "$nf")"

http_get "$url" | jq '[.hits[] | {
  id: .objectID, type: (if .story_text != null or .title != null then "story" else "comment" end),
  title: (.title // .story_title), url: (.url // .story_url), author, points, num_comments, created_at,
  hn_url: ("https://news.ycombinator.com/item?id=" + .objectID),
  text: ((.comment_text // .story_text // "") | gsub("<[^>]+>"; " ") | gsub("&#x27;"; "'"'"'") | gsub("&quot;"; "\"") | gsub("&gt;"; ">") | gsub("&lt;"; "<") | gsub("&amp;"; "&") | gsub("\\s+"; " ") | .[0:1500])}]'
