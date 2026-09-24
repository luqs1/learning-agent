#!/usr/bin/env bash
# pubmed.sh — PubMed via NCBI E-utilities. Free, no key (NCBI_API_KEY optional).
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: pubmed.sh search   <query> [--max N] [--sort relevance|pub_date] [--mindate YYYY] [--maxdate YYYY]
       pubmed.sh abstract <pmid>

E-utilities (https://www.ncbi.nlm.nih.gov/books/NBK25499/). 3 req/s without a
key, 10 req/s with NCBI_API_KEY.

<query> uses PubMed syntax, so you can filter by study type — do this, it is how
the evidence hierarchy is enforced:
  'metformin ageing AND (randomized controlled trial[pt] OR meta-analysis[pt] OR systematic review[pt])'
  'statins primary prevention AND cochrane[journal]'
  'GLP-1 obesity AND humans[mesh] AND 2022:2026[dp]'

Output: search -> JSON array of {pmid, title, journal, pubdate, authors[],
        pubtypes[], doi, pmc, url, pmc_url}; pubtypes tells you the study type.
        abstract -> {pmid, text} (the abstract as plain text; not the full paper).
Full text: if pmc is set, the free PDF is at https://pmc.ncbi.nlm.nih.gov/articles/<pmc>/pdf/
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq

BASE=https://eutils.ncbi.nlm.nih.gov/entrez/eutils
key=""; [ -n "${NCBI_API_KEY:-}" ] && key="&api_key=$NCBI_API_KEY"

cmd=$1; shift
arg="" max=10 sort=relevance mind="" maxd=""
while [ $# -gt 0 ]; do
  case "$1" in
    --max) max=$2; shift 2 ;;
    --sort) sort=$2; shift 2 ;;
    --mindate) mind=$2; shift 2 ;;
    --maxdate) maxd=$2; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) arg="${arg:+$arg }$1"; shift ;;
  esac
done
[ -n "$arg" ] || die "missing argument (see --help)"

case "$cmd" in
  search)
    url="$BASE/esearch.fcgi?db=pubmed&term=$(urlenc "$arg")&retmax=$max&retmode=json&sort=$sort$key"
    [ -n "$mind" ] && url="$url&datetype=pdat&mindate=$mind&maxdate=${maxd:-3000}"
    ids=$(http_get "$url" | jq -r '.esearchresult.idlist | join(",")')
    [ -n "$ids" ] || { echo "[]"; exit 0; }
    http_get "$BASE/esummary.fcgi?db=pubmed&id=$ids&retmode=json$key" | jq '
      [.result.uids[] as $u | .result[$u] | {
        pmid: .uid, title, journal: .fulljournalname, pubdate,
        authors: [.authors[]?.name], pubtypes: .pubtype,
        doi: ([.articleids[]? | select(.idtype=="doi") | .value][0]),
        pmc: ([.articleids[]? | select(.idtype=="pmc") | .value][0]),
        url: ("https://pubmed.ncbi.nlm.nih.gov/" + .uid + "/")
      } | .pmc_url = (if .pmc then "https://pmc.ncbi.nlm.nih.gov/articles/" + .pmc + "/" else null end)]'
    ;;
  abstract)
    http_get "$BASE/efetch.fcgi?db=pubmed&id=$(urlenc "$arg")&rettype=abstract&retmode=text$key" \
      | jq -Rs --arg pmid "$arg" '{pmid: $pmid, text: .}'
    ;;
  *) die "unknown command '$cmd' (see --help)" ;;
esac
