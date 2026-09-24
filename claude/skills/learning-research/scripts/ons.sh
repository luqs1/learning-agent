#!/usr/bin/env bash
# ons.sh — UK Office for National Statistics search. Free, no key.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: ons.sh <query> [--limit N] [--type dataset|bulletin|article|timeseries]

ONS search API (https://api.beta.ons.gov.uk/v1/search). Finds UK official
statistics: datasets, time series, statistical bulletins. Read the result page
with fetch-readable.sh; datasets have a "Download" CSV/XLSX link on the page.

Other keyless statistical APIs (no script, plain curl):
  Eurostat  https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/<dataset>?geo=UK&time=2023&format=JSON
  OECD      https://sdmx.oecd.org/public/rest/data/<agency>,<dataflow>,<ver>/<key>?format=jsondata
  Wikidata  https://query.wikidata.org/sparql?query=<SPARQL>  (Accept: application/sparql-results+json)

Output: JSON array of {title, type, url, release_date, summary, keywords}
Cite as "ONS, <title>, released <date>, <url>" and store the release date.
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq

query="" limit=10 type=""
while [ $# -gt 0 ]; do
  case "$1" in
    --limit) limit=$2; shift 2 ;;
    --type) type=$2; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) query="${query:+$query }$1"; shift ;;
  esac
done
[ -n "$query" ] || die "a query is required"
url="https://api.beta.ons.gov.uk/v1/search?q=$(urlenc "$query")&limit=$limit"
[ -n "$type" ] && url="$url&content_type=$type"
http_get "$url" | jq '[.items[] | {title: ((.title // .description.title) + (if (.edition // "") != "" then " (" + .edition + ")" else "" end)),
  type, url: ("https://www.ons.gov.uk" + .uri), release_date: (.release_date // .description.release_date),
  summary: ((.summary // .description.summary // "") | .[0:300]), keywords: (.keywords // .description.keywords)}]'
