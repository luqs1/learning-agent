#!/usr/bin/env bash
# news.sh — news search: Google News RSS (default, keyless) or GDELT (--gdelt, keyless, rate-limited).
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: news.sh <query> [--limit N] [--when 7d|1m|1y] [--after YYYY-MM-DD] [--before YYYY-MM-DD] [--lang en-GB|en-US] [--gdelt]

Default: Google News RSS (https://news.google.com/rss/search?q=...). Returns
headline, outlet, publish date and a Google redirect link. The redirect link
often does not resolve for curl, so to read the article: WebSearch the outlet +
headline, or fetch the outlet's page directly, then fetch-readable.sh it.
--gdelt: GDELT 2.0 DOC API (https://api.gdeltproject.org/api/v2/doc/doc) — direct
article URLs, global coverage, 15-minute lag, but limited to 1 request / 5 s per
IP and blocked on busy networks.

--when     Google operator: 1h, 7d, 1m, 1y (recent window); --after/--before use dates
--lang     hl code (default en-GB, also sets gl/ceid)

Output: JSON array of {title, url, source, published, description}
News is Tier 3 evidence: store the publish date, and chase every number in an
article back to the filing or announcement it came from.
EOF
}
want_help "$@" && { usage; exit 0; }
need curl python3 jq

query="" limit=15 when="" after="" before="" lang=en-GB gdelt=""
while [ $# -gt 0 ]; do
  case "$1" in
    --limit) limit=$2; shift 2 ;;
    --when) when=$2; shift 2 ;;
    --after) after=$2; shift 2 ;;
    --before) before=$2; shift 2 ;;
    --lang) lang=$2; shift 2 ;;
    --gdelt) gdelt=1; shift ;;
    -*) die "unknown option $1" ;;
    *) query="${query:+$query }$1"; shift ;;
  esac
done
[ -n "$query" ] || die "a query is required"

if [ -n "$gdelt" ]; then
  url="https://api.gdeltproject.org/api/v2/doc/doc?query=$(urlenc "$query")&mode=artlist&format=json&maxrecords=$limit&sort=datedesc"
  [ -n "$after" ] && url="$url&startdatetime=$(echo "$after" | tr -d -)000000"
  [ -n "$before" ] && url="$url&enddatetime=$(echo "$before" | tr -d -)235959"
  http_get "$url" > "$LA_TMP/g.json"
  jq -e . "$LA_TMP/g.json" >/dev/null 2>&1 || die "GDELT refused: $(head -c 200 "$LA_TMP/g.json") — retry in 5s or drop --gdelt"
  jq '[.articles[]? | {title, url, source: .domain, published: .seendate, description: null, language, country: .sourcecountry}]' "$LA_TMP/g.json"
  exit 0
fi

q=$query
[ -n "$when" ] && q="$q when:$when"
[ -n "$after" ] && q="$q after:$after"
[ -n "$before" ] && q="$q before:$before"
cc=${lang#*-}
http_get "https://news.google.com/rss/search?q=$(urlenc "$q")&hl=$lang&gl=$cc&ceid=$cc:${lang%-*}" | python3 -c '
import sys, re, json, html, xml.etree.ElementTree as ET
root = ET.fromstring(sys.stdin.read())
out = []
for it in root.iter("item"):
    d = html.unescape(re.sub(r"<[^>]+>", " ", it.findtext("description") or ""))
    src = it.find("source")
    out.append({"title": it.findtext("title"), "url": it.findtext("link"),
                "source": src.text if src is not None else None, "source_url": src.get("url") if src is not None else None,
                "published": it.findtext("pubDate"), "description": re.sub(r"\s+", " ", d).strip()[:300]})
json.dump(out[:'"$limit"'], sys.stdout, indent=1, ensure_ascii=False); print()'
