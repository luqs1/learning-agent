#!/usr/bin/env bash
# openalex.sh — OpenAlex works: search, lookup, related works. Free, no key.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: openalex.sh search  <query> [--limit N] [--from-year YYYY] [--oa] [--type article|preprint|book|...]
       openalex.sh work    <id>                       # W123, DOI, or https://doi.org/...
       openalex.sh related <id> [--limit N]           # OpenAlex related_works, resolved
       openalex.sh cited-by <id> [--limit N]          # works citing <id>

OpenAlex (https://docs.openalex.org) — 250M+ works, no key needed.
Set OPENALEX_MAILTO=you@example.com to join the faster "polite pool".

Output: JSON array (search/related/cited-by) or object (work) with:
  id, doi, title, publication_year, type, cited_by_count, is_oa, oa_url,
  pdf_url, landing_page_url, source (journal/repository), authors[]
Use `related` as the adjacent-material step when Semantic Scholar is rate-limited.
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq

BASE=https://api.openalex.org
mail=""; [ -n "${OPENALEX_MAILTO:-}" ] && mail="&mailto=$(urlenc "$OPENALEX_MAILTO")"
SELECT="id,doi,title,publication_year,type,cited_by_count,open_access,primary_location,authorships"
SHAPE='{id, doi, title, publication_year, type, cited_by_count,
        is_oa: .open_access.is_oa, oa_url: .open_access.oa_url,
        pdf_url: .primary_location.pdf_url, landing_page_url: .primary_location.landing_page_url,
        source: .primary_location.source.display_name,
        authors: [.authorships[]?.author.display_name]}'

cmd=$1; shift
arg="" limit=10 fromy="" oa="" type=""
while [ $# -gt 0 ]; do
  case "$1" in
    --limit) limit=$2; shift 2 ;;
    --from-year) fromy=$2; shift 2 ;;
    --oa) oa=1; shift ;;
    --type) type=$2; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) arg="${arg:+$arg }$1"; shift ;;
  esac
done
[ -n "$arg" ] || die "missing argument (see --help)"
is_int "$limit" || die "--limit must be an integer"

norm_id() {  # DOI or URL -> OpenAlex-acceptable id
  case "$1" in
    W*|https://openalex.org/*) echo "$1" ;;
    https://doi.org/*|doi:*|10.*) echo "https://doi.org/${1#https://doi.org/}" | sed 's#https://doi.org/doi:#https://doi.org/#' ;;
    *) echo "$1" ;;
  esac
}

case "$cmd" in
  search)
    filter=""
    [ -n "$fromy" ] && filter="${filter:+$filter,}from_publication_date:${fromy}-01-01"
    [ -n "$oa" ] && filter="${filter:+$filter,}is_oa:true"
    [ -n "$type" ] && filter="${filter:+$filter,}type:$type"
    url="$BASE/works?search=$(urlenc "$arg")&per-page=$limit&select=$SELECT$mail"
    [ -n "$filter" ] && url="$url&filter=$(urlenc "$filter")"
    http_get "$url" | jq "[.results[] | $SHAPE]"
    ;;
  work)
    http_get "$BASE/works/$(norm_id "$arg")?select=$SELECT,related_works,referenced_works$mail" | jq "$SHAPE"
    ;;
  related)
    ids=$(http_get "$BASE/works/$(norm_id "$arg")?select=related_works$mail" \
          | jq -r --argjson n "$limit" '.related_works[:$n] | map(sub("https://openalex.org/";"")) | join("|")')
    [ -n "$ids" ] || { echo "[]"; exit 0; }
    http_get "$BASE/works?filter=ids.openalex:$ids&per-page=$limit&select=$SELECT$mail" | jq "[.results[] | $SHAPE]"
    ;;
  cited-by)
    wid=$(http_get "$BASE/works/$(norm_id "$arg")?select=id$mail" | jq -r '.id | sub("https://openalex.org/";"")')
    http_get "$BASE/works?filter=cites:$wid&sort=cited_by_count:desc&per-page=$limit&select=$SELECT$mail" | jq "[.results[] | $SHAPE]"
    ;;
  *) die "unknown command '$cmd' (see --help)" ;;
esac
