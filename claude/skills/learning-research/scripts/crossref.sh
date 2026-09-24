#!/usr/bin/env bash
# crossref.sh — Crossref works search + DOI lookup. Free, no key.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: crossref.sh search <query> [--rows N] [--type journal-article|book-chapter|...] [--from-year YYYY]
       crossref.sh doi    <doi>

Crossref REST API (https://api.crossref.org). Best for resolving a DOI to full
metadata, checking a citation's venue/date, or finding non-arXiv literature.
Set CROSSREF_MAILTO=you@example.com for the polite pool.

Output: JSON array (search) / object (doi):
  doi, title, type, container (journal/book), publisher, issued (year), authors[],
  cited_by (is-referenced-by-count), url, pdf_url (when the publisher exposes one)
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq

BASE=https://api.crossref.org
mail=""; [ -n "${CROSSREF_MAILTO:-}" ] && mail="&mailto=$(urlenc "$CROSSREF_MAILTO")"
SHAPE='{doi: .DOI, title: (.title[0]? // null), type, container: (.["container-title"][0]? // null),
        publisher, issued: (.issued["date-parts"][0][0]? // null),
        authors: [.author[]? | ((.given // "") + " " + (.family // "")) | ltrimstr(" ")],
        cited_by: .["is-referenced-by-count"], url: .URL,
        pdf_url: ([.link[]? | select(.["content-type"]=="application/pdf") | .URL][0])}'

cmd=$1; shift
arg="" rows=10 type="" fromy=""
while [ $# -gt 0 ]; do
  case "$1" in
    --rows) rows=$2; shift 2 ;;
    --type) type=$2; shift 2 ;;
    --from-year) fromy=$2; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) arg="${arg:+$arg }$1"; shift ;;
  esac
done
[ -n "$arg" ] || die "missing argument (see --help)"

case "$cmd" in
  search)
    filter=""
    [ -n "$type" ] && filter="type:$type"
    [ -n "$fromy" ] && filter="${filter:+$filter,}from-pub-date:$fromy"
    url="$BASE/works?query=$(urlenc "$arg")&rows=$rows$mail"
    [ -n "$filter" ] && url="$url&filter=$(urlenc "$filter")"
    http_get "$url" | jq "[.message.items[] | $SHAPE]"
    ;;
  doi)
    http_get "$BASE/works/$(urlenc "${arg#https://doi.org/}")${mail:+?${mail#&}}" | jq ".message | $SHAPE"
    ;;
  *) die "unknown command '$cmd' (see --help)" ;;
esac
