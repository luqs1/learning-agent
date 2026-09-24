#!/usr/bin/env bash
# s2.sh — Semantic Scholar: search, paper details, recommendations, citations.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: s2.sh search    <query> [--limit N] [--year 2018-2024] [--open-access] [--fields a,b]
       s2.sh paper     <id>    [--fields a,b]
       s2.sh recommend <id>    [--limit N] [--from all-cs|recent]
       s2.sh citations <id>    [--limit N]        # papers that cite <id>
       s2.sh references <id>   [--limit N]        # papers <id> cites

Semantic Scholar Academic Graph + Recommendations APIs. Free without a key but
rate-limited (shared pool, 429s are common; this script retries with backoff).
Set S2_API_KEY for a dedicated 1 req/s quota (https://www.semanticscholar.org/product/api).

<id> forms: S2 paperId (40-hex), arXiv:1706.03762, DOI:10.1145/..., CorpusId:12345,
            PMID:..., URL:https://arxiv.org/abs/...
--year        e.g. 2020 | 2018-2024 | 2021-
--open-access only papers with an open-access PDF
--from        recommend pool: all-cs (default; CS-only corpus, works for old
              papers) | recent (all fields, recent papers only)

Output: JSON. search -> {total, papers[]}; paper -> object; recommend -> papers[];
  each paper: paperId, title, year, venue, authors, citationCount,
  influentialCitationCount, externalIds{ArXiv,DOI,...}, openAccessPdf{url}, url,
  (+abstract, tldr on `paper`).
Use `recommend` as the adjacent-material step after storing a primary paper.
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq

BASE=https://api.semanticscholar.org
hdr=(-H "accept: application/json")
[ -n "${S2_API_KEY:-}" ] && hdr+=(-H "x-api-key: $S2_API_KEY")
DEF_FIELDS="paperId,title,year,venue,authors,citationCount,influentialCitationCount,externalIds,openAccessPdf,url"

cmd=$1; shift
arg="" limit=10 year="" oa="" fields="" from=all-cs
while [ $# -gt 0 ]; do
  case "$1" in
    --limit) limit=$2; shift 2 ;;
    --year)  year=$2; shift 2 ;;
    --open-access) oa=1; shift ;;
    --fields) fields=$2; shift 2 ;;
    --from)  from=$2; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) arg="${arg:+$arg }$1"; shift ;;
  esac
done
[ -n "$arg" ] || die "missing argument (see --help)"
is_int "$limit" || die "--limit must be an integer"
[ -z "$fields" ] && fields=$DEF_FIELDS

case "$cmd" in
  search)
    url="$BASE/graph/v1/paper/search?query=$(urlenc "$arg")&limit=$limit&fields=$(urlenc "$fields")"
    [ -n "$year" ] && url="$url&year=$(urlenc "$year")"
    [ -n "$oa" ] && url="$url&openAccessPdf"
    http_get "$url" "${hdr[@]}" | jq '{total: .total, papers: (.data // [])}'
    ;;
  paper)
    [ "$fields" = "$DEF_FIELDS" ] && fields="$DEF_FIELDS,abstract,tldr"
    http_get "$BASE/graph/v1/paper/$(urlenc "$arg")?fields=$(urlenc "$fields")" "${hdr[@]}"
    ;;
  recommend)
    http_get "$BASE/recommendations/v1/papers/forpaper/$(urlenc "$arg")?from=$from&limit=$limit&fields=$(urlenc "$fields")" "${hdr[@]}" \
      | jq '.recommendedPapers // []'
    ;;
  citations)
    http_get "$BASE/graph/v1/paper/$(urlenc "$arg")/citations?limit=$limit&fields=$(urlenc "$fields")" "${hdr[@]}" \
      | jq '[.data[]?.citingPaper]'
    ;;
  references)
    http_get "$BASE/graph/v1/paper/$(urlenc "$arg")/references?limit=$limit&fields=$(urlenc "$fields")" "${hdr[@]}" \
      | jq '[.data[]?.citedPaper]'
    ;;
  *) die "unknown command '$cmd' (see --help)" ;;
esac
