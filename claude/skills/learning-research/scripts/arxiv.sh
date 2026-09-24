#!/usr/bin/env bash
# arxiv.sh — search arXiv (free, no key) and return JSON.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: arxiv.sh <query> [--max N] [--sort relevance|lastUpdatedDate|submittedDate] [--start N]
       arxiv.sh --id 1706.03762[,2005.14165,...]

Search arXiv via the export API (https://export.arxiv.org/api/query). No key.

<query>   Tried as an exact phrase first (all:"..."), then, if that finds
          nothing, as ANDed words with stopwords dropped ("diffusion models
          survey" -> all:diffusion AND all:models AND all:survey). If the query
          already contains a field prefix (ti:, au:, abs:, cat:, all:) it is
          passed through as-is: 'ti:"attention is all you need"',
          'cat:cs.LG AND abs:diffusion', 'au:karpathy'.
--max N   results to return (default 10, max 200)
--sort    relevance (default) | lastUpdatedDate | submittedDate
--id      fetch specific arXiv ids instead of searching

Output: JSON array of {id, title, authors[], published, updated, summary,
        primary_category, categories[], abs_url, pdf_url, doi, journal_ref, comment}

Read a result properly: curl -L "$pdf_url" -o paper.pdf, then Read it with pages,
or run fetch-readable.sh "$pdf_url".
arXiv asks for <= 1 request every 3 seconds; results are capped at 200 per call.
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq python3

query="" max=10 sort=relevance start=0 ids=""
while [ $# -gt 0 ]; do
  case "$1" in
    --max)   max=$2; shift 2 ;;
    --sort)  sort=$2; shift 2 ;;
    --start) start=$2; shift 2 ;;
    --id)    ids=$2; shift 2 ;;
    -*)      die "unknown option $1 (see --help)" ;;
    *)       query="${query:+$query }$1"; shift ;;
  esac
done
is_int "$max" || die "--max must be an integer"
[ "$max" -le 200 ] || max=200

search_url() { echo "https://export.arxiv.org/api/query?search_query=$(urlenc "$1")&start=$start&max_results=$max&sortBy=$sort&sortOrder=descending"; }

if [ -n "$ids" ]; then
  http_get "https://export.arxiv.org/api/query?id_list=$(urlenc "$ids")&max_results=$max" > "$LA_TMP/feed.xml"
else
  [ -n "$query" ] || die "a query or --id is required (see --help)"
  case "$query" in
    *:*) http_get "$(search_url "$query")" > "$LA_TMP/feed.xml" ;;
    *)
      # Exact phrase first (title lookups are the common case); if nothing
      # matches, AND the content words. Stopwords are dropped because arXiv
      # returns 0 hits when one is ANDed in.
      http_get "$(search_url "all:\"$query\"")" > "$LA_TMP/feed.xml"
      if grep -q '<opensearch:totalResults>0<' "$LA_TMP/feed.xml"; then
        sq=$(printf '%s' "$query" | python3 -c '
import sys
q = sys.stdin.read().split()
stop = set("a an the of in on for to is are was were be by at from with and or as it its this that these those what how do does which into via using".split())
ws = [w for w in q if w.lower() not in stop] or q
print(" AND ".join("all:" + w for w in ws))')
        warn "no exact-phrase hits; retrying as '$sq'"
        sleep 3
        http_get "$(search_url "$sq")" > "$LA_TMP/feed.xml"
      fi ;;
  esac
fi

python3 -c '
import sys, json, re, xml.etree.ElementTree as ET
ns = {"a": "http://www.w3.org/2005/Atom", "x": "http://arxiv.org/schemas/atom"}
root = ET.fromstring(sys.stdin.read())
def txt(e, p):
    n = e.find(p, ns)
    return re.sub(r"\s+", " ", (n.text or "")).strip() if n is not None else None
out = []
for e in root.findall("a:entry", ns):
    absurl = txt(e, "a:id") or ""
    aid = absurl.rsplit("/abs/", 1)[-1]
    pdf = next((l.get("href") for l in e.findall("a:link", ns) if l.get("title") == "pdf"), None)
    out.append({
        "id": aid,
        "title": txt(e, "a:title"),
        "authors": [txt(a, "a:name") for a in e.findall("a:author", ns)],
        "published": txt(e, "a:published"),
        "updated": txt(e, "a:updated"),
        "summary": txt(e, "a:summary"),
        "primary_category": (e.find("x:primary_category", ns).get("term") if e.find("x:primary_category", ns) is not None else None),
        "categories": [c.get("term") for c in e.findall("a:category", ns)],
        "abs_url": absurl.replace("http://", "https://"),
        "pdf_url": (pdf or "").replace("http://", "https://") or None,
        "doi": txt(e, "x:doi"),
        "journal_ref": txt(e, "x:journal_ref"),
        "comment": txt(e, "x:comment"),
    })
json.dump(out, sys.stdout, indent=1, ensure_ascii=False); print()
' < "$LA_TMP/feed.xml"
