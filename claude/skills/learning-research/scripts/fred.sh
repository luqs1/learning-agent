#!/usr/bin/env bash
# fred.sh — FRED (St. Louis Fed) economic data. API with FRED_API_KEY; CSV download otherwise.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: fred.sh series <SERIES_ID> [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--limit N] [--units lin|chg|pch|pc1] [--frequency a|q|m]
       fred.sh search <text> [--limit N]           # key required
       fred.sh info   <SERIES_ID>                  # key required

FRED: 800k+ US and international series (GDP, CPI, rates, employment, ...).
  With FRED_API_KEY (free; https://fred.stlouisfed.org/docs/api/api_key.html)
    -> https://api.stlouisfed.org/fred/series/observations etc.
  Without a key
    -> `series` still works via the public CSV download
       https://fred.stlouisfed.org/graph/fredgraph.csv?id=<ID> (no units/frequency transforms)
    -> `search`/`info` exit 2; find series IDs with WebSearch "site:fred.stlouisfed.org <text>"
       and read the series page with fetch-readable.sh for its notes and source.

Output: series -> {series_id, source, observations[{date, value}]}; search -> [{id, title, frequency, units, last_updated, popularity}]
Cite as "FRED series <ID> (<source per the series page>), retrieved <date>".
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq

cmd=$1; shift
arg="" start="" end="" limit=0 units="" freq=""
while [ $# -gt 0 ]; do
  case "$1" in
    --start) start=$2; shift 2 ;;
    --end) end=$2; shift 2 ;;
    --limit) limit=$2; shift 2 ;;
    --units) units=$2; shift 2 ;;
    --frequency) freq=$2; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) arg="${arg:+$arg }$1"; shift ;;
  esac
done
[ -n "$arg" ] || die "missing argument (see --help)"
KEY=${FRED_API_KEY:-}
API=https://api.stlouisfed.org/fred

case "$cmd" in
  series)
    if [ -n "$KEY" ]; then
      url="$API/series/observations?series_id=$(urlenc "$arg")&api_key=$KEY&file_type=json&sort_order=desc"
      [ -n "$start" ] && url="$url&observation_start=$start"
      [ -n "$end" ] && url="$url&observation_end=$end"
      [ "$limit" -gt 0 ] && url="$url&limit=$limit"
      [ -n "$units" ] && url="$url&units=$units"
      [ -n "$freq" ] && url="$url&frequency=$freq"
      http_get "$url" | jq --arg id "$arg" '{series_id: $id, source: "api.stlouisfed.org", observations: [.observations[] | {date, value}]}'
    else
      warn "FRED_API_KEY not set; using the public CSV download (no --units/--frequency)"
      [ -n "$units$freq" ] && die "--units/--frequency need FRED_API_KEY"
      url="https://fred.stlouisfed.org/graph/fredgraph.csv?id=$(urlenc "$arg")"
      [ -n "$start" ] && url="$url&cosd=$start"
      [ -n "$end" ] && url="$url&coed=$end"
      http_get "$url" > "$LA_TMP/s.csv"
      head -1 "$LA_TMP/s.csv" | grep -qi '^observation_date' || die "no such series '$arg' (or FRED changed the CSV endpoint)"
      tail -n +2 "$LA_TMP/s.csv" | jq -R --arg id "$arg" --argjson n "$limit" -s '
        {series_id: $id, source: "fred.stlouisfed.org/graph/fredgraph.csv",
         observations: ([split("\n")[] | select(length > 0) | split(",") | {date: .[0], value: .[1]}] | reverse | (if $n > 0 then .[:$n] else . end))}'
    fi
    ;;
  search)
    [ -n "$KEY" ] || missing_key FRED_API_KEY "https://fred.stlouisfed.org/docs/api/api_key.html (free)" \
      "WebSearch 'site:fred.stlouisfed.org <text>' to find the series id, then fred.sh series <ID>"
    http_get "$API/series/search?search_text=$(urlenc "$arg")&api_key=$KEY&file_type=json&limit=${limit:-20}&order_by=popularity&sort_order=desc" \
      | jq '[.seriess[] | {id, title, frequency, units, seasonal_adjustment_short, last_updated, popularity, notes: (.notes // "" | .[0:200])}]'
    ;;
  info)
    [ -n "$KEY" ] || missing_key FRED_API_KEY "https://fred.stlouisfed.org/docs/api/api_key.html (free)" \
      "fetch-readable.sh https://fred.stlouisfed.org/series/$arg"
    http_get "$API/series?series_id=$(urlenc "$arg")&api_key=$KEY&file_type=json" | jq '.seriess[0]'
    ;;
  *) die "unknown command '$cmd' (see --help)" ;;
esac
