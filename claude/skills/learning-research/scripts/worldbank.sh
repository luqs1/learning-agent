#!/usr/bin/env bash
# worldbank.sh — World Bank indicators API. Free, no key.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: worldbank.sh indicator <CODE> [--country GB,US,all] [--date 2015:2024] [--mrv N]
       worldbank.sh search    <text> [--limit N]

World Bank Indicators API v2 (https://api.worldbank.org/v2, no key).
Macro series for market sizing: GDP, population, internet users, SME counts, etc.

indicator  values for a series code, e.g. NY.GDP.MKTP.CD (GDP current US$),
           SP.POP.TOTL (population), IT.NET.USER.ZS (internet users %),
           IC.BUS.NREG (new business registrations).
--country  ISO2/ISO3 codes, comma-separated, or `all` (default GB)
--date     year range YYYY:YYYY;  --mrv N = most recent N values
search     find indicator codes by keyword (downloads the ~25k indicator list once per call)

Output: indicator -> [{indicator, code, country, iso3, date, value, unit}]
        search -> [{code, name, source, note}]
Always store the series code and the date in sources.md; cite as
"World Bank, <code>, <year>" — the statistical body beats any analyst's rounding.
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq

BASE=https://api.worldbank.org/v2
cmd=$1; shift
arg="" country=GB date="" mrv="" limit=20
while [ $# -gt 0 ]; do
  case "$1" in
    --country) country=$2; shift 2 ;;
    --date) date=$2; shift 2 ;;
    --mrv) mrv=$2; shift 2 ;;
    --limit) limit=$2; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) arg="${arg:+$arg }$1"; shift ;;
  esac
done
[ -n "$arg" ] || die "missing argument (see --help)"

case "$cmd" in
  indicator)
    url="$BASE/country/$(urlenc "$(echo "$country" | tr ',' ';')")/indicator/$(urlenc "$arg")?format=json&per_page=1000"
    [ -n "$date" ] && url="$url&date=$date"
    [ -n "$mrv" ] && url="$url&mrv=$mrv"
    http_get "$url" | jq 'if (.[0].message) then error(.[0].message[0].value) else
      [.[1][]? | {indicator: .indicator.value, code: .indicator.id, country: .country.value, iso3: .countryiso3code, date, value, unit}] end'
    ;;
  search)
    http_get "$BASE/indicator?format=json&per_page=30000" | jq --arg q "$arg" --argjson n "$limit" '
      ($q | ascii_downcase | split(" ")) as $ws
      | [.[1][] | select(((.name + " " + .sourceNote) | ascii_downcase) as $t | all($ws[]; . as $w | $t | contains($w)))
         | {code: .id, name, source: .source.value, note: (.sourceNote[0:200])}] | .[:$n]'
    ;;
  *) die "unknown command '$cmd' (see --help)" ;;
esac
