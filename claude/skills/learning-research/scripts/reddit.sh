#!/usr/bin/env bash
# reddit.sh — Reddit search via the public RSS feeds. No key.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: reddit.sh <query> [--subreddit NAME] [--limit N] [--sort relevance|new|top] [--time all|year|month|week]
       reddit.sh thread <post-url>

Reddit's JSON endpoints now block unauthenticated clients, but the Atom feeds
(https://www.reddit.com/search.rss, /r/<sub>/search.rss, <post>.rss) still work
without a key. Feeds are rate-limited (~1 request / 2 s; 429 on bursts — the
script retries with backoff). Post bodies are included; comments come via `thread`.

--subreddit   restrict to one subreddit (e.g. startups, SaaS, smallbusiness)
--limit       max posts (default 15, feed cap ~25)
thread <url>  the post plus top-level comments as text

Output: JSON array of {title, url, subreddit, author, updated, text};
        thread -> [{author, updated, url, text}] (first entry is the post).
Forum evidence is Tier 5: quote verbatim with the date; never aggregate into a number.
EOF
}
want_help "$@" && { usage; exit 0; }
need curl python3

parse_atom() {
  python3 -c '
import sys, re, json, html, xml.etree.ElementTree as ET
ns = {"a": "http://www.w3.org/2005/Atom"}
data = sys.stdin.read()
try: root = ET.fromstring(data)
except ET.ParseError: sys.exit("reddit.sh: feed was not XML (blocked or rate-limited); retry in a minute")
def clean(s):
    s = html.unescape(s or "")
    s = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", s)
    s = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>", "\n", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    return re.sub(r"\n\s*\n+", "\n", re.sub(r"[ \t]+", " ", s)).strip()
out = []
for e in root.findall("a:entry", ns):
    link = e.find("a:link", ns).get("href")
    m = re.search(r"/r/([^/]+)/", link)
    a = e.find("a:author/a:name", ns)
    out.append({"title": (e.findtext("a:title", default="", namespaces=ns) or "").strip(),
                "url": link, "subreddit": m.group(1) if m else None,
                "author": a.text if a is not None else None,
                "updated": e.findtext("a:updated", default=None, namespaces=ns),
                "text": clean(e.findtext("a:content", default="", namespaces=ns))[:3000]})
json.dump(out, sys.stdout, indent=1, ensure_ascii=False); print()'
}
rget() { LA_UA="learning-agent/1.1 research feed reader" http_get "$1" -H "accept: application/atom+xml, application/xml"; }

if [ "$1" = thread ]; then
  [ -n "${2:-}" ] || die "thread needs a post url"
  u=${2%%\?*}; u=${u%/}
  rget "$u.rss?limit=100" | parse_atom
  exit 0
fi

query="" sub="" limit=15 sort=relevance t=all
while [ $# -gt 0 ]; do
  case "$1" in
    --subreddit) sub=$2; shift 2 ;;
    --limit) limit=$2; shift 2 ;;
    --sort) sort=$2; shift 2 ;;
    --time) t=$2; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) query="${query:+$query }$1"; shift ;;
  esac
done
[ -n "$query" ] || die "a query is required"
if [ -n "$sub" ]; then
  url="https://www.reddit.com/r/$sub/search.rss?q=$(urlenc "$query")&restrict_sr=1&sort=$sort&t=$t&limit=$limit"
else
  url="https://www.reddit.com/search.rss?q=$(urlenc "$query")&sort=$sort&t=$t&limit=$limit"
fi
rget "$url" | parse_atom
