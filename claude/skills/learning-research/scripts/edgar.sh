#!/usr/bin/env bash
# edgar.sh — SEC EDGAR: full-text search, filing lists, XBRL company facts. Free, no key.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: edgar.sh search      <query> [--forms 10-K,D,S-1] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--limit N]
       edgar.sh filings     <cik|ticker> [--forms 10-K,10-Q,8-K,D] [--limit N]
       edgar.sh facts       <cik|ticker> [--concept Revenues|NetIncomeLoss|...] [--limit N]
       edgar.sh cik         <ticker|company name>

US filings are the strongest evidence tier for any US company. Endpoints:
  full-text search  https://efts.sec.gov/LATEST/search-index  (2001-present)
  filings           https://data.sec.gov/submissions/CIK##########.json
  XBRL facts        https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json
The SEC requires a User-Agent with contact details and <= 10 req/s.
Set EDGAR_USER_AGENT="Your Name you@example.com" (a placeholder is used otherwise).

search   phrase search across all filings; quote exact phrases: '"Notion Labs"'.
         Form D = private fundraising (amount sold, investors); S-1 = IPO; 10-K =
         annual report (risk factors, revenue); 8-K = material events.
filings  the entity's recent filings with document URLs.
facts    XBRL concepts for a reporting company. Without --concept, lists the
         available concept names; with --concept, returns the reported values
         (value, unit, fiscal period, form, filed date) — cite these for revenue etc.
         Tags change over time (e.g. Revenues -> RevenueFromContractWithCustomerExcludingAssessedTax
         after 2018), so list first and pick the tag with recent values.
cik      resolve ticker/name -> CIK via the SEC's company_tickers.json (listed companies only).

Output: JSON. search -> [{form, file_date, period_ending, entity, cik, adsh,
        location, description, url}]; filings -> {name, cik, sic, filings[]};
        facts -> {entity, cik, concepts[]} or {entity, concept, unit, values[]}.
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq

UA_SEC="${EDGAR_USER_AGENT:-learning-agent research-bot@example.com}"
[ -n "${EDGAR_USER_AGENT:-}" ] || warn "EDGAR_USER_AGENT not set; using a placeholder User-Agent (the SEC asks for real contact details)"
sec_get() { LA_UA="$UA_SEC" http_get "$1" --compressed -H "accept: application/json"; }

cmd=$1; shift
arg="" forms="" from="" to="" limit=20 concept=""
while [ $# -gt 0 ]; do
  case "$1" in
    --forms) forms=$2; shift 2 ;;
    --from) from=$2; shift 2 ;;
    --to) to=$2; shift 2 ;;
    --limit) limit=$2; shift 2 ;;
    --concept) concept=$2; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) arg="${arg:+$arg }$1"; shift ;;
  esac
done
[ -n "$arg" ] || die "missing argument (see --help)"

resolve_cik() {  # ticker/name/cik -> 10-digit CIK
  if is_int "$1"; then printf '%010d\n' "$1"; return; fi
  sec_get "https://www.sec.gov/files/company_tickers.json" \
    | jq -r --arg q "$(echo "$1" | tr '[:lower:]' '[:upper:]')" '
        [.[] | select((.ticker == $q) or ((.title | ascii_upcase) | contains($q)))] | sort_by(.ticker != $q)
        | .[0].cik_str // empty' | { read -r c && printf '%010d\n' "$c" || die "no CIK found for '$1' (private companies are not in the ticker list; use: edgar.sh search '\"$1\"')"; }
}

case "$cmd" in
  search)
    url="https://efts.sec.gov/LATEST/search-index?q=$(urlenc "$arg")"
    [ -n "$forms" ] && url="$url&forms=$(urlenc "$forms")"
    if [ -n "$from" ] || [ -n "$to" ]; then
      url="$url&dateRange=custom&startdt=${from:-2001-01-01}&enddt=${to:-$(date +%Y-%m-%d)}"
    fi
    sec_get "$url" | jq --argjson n "$limit" '[.hits.hits[:$n][] | ._source as $s | {
      form: $s.form, file_date: $s.file_date, period_ending: $s.period_ending,
      entity: ($s.display_names[0] // null), cik: ($s.ciks[0] // null), adsh: $s.adsh,
      location: ($s.biz_locations[0] // null), description: $s.file_description,
      url: ("https://www.sec.gov/Archives/edgar/data/" + (($s.ciks[0] // "0") | tonumber | tostring) + "/" + ($s.adsh | gsub("-";"")) + "/" + (._id | split(":")[1]))}]'
    ;;
  filings)
    cik=$(resolve_cik "$arg")
    sec_get "https://data.sec.gov/submissions/CIK$cik.json" | jq --arg forms "$forms" --argjson n "$limit" '
      (.filings.recent) as $r | (.cik | tonumber) as $cik | {name, cik, sic: .sicDescription, tickers, state: .stateOfIncorporation,
        filings: ([range(0; ($r.form | length)) | {form: $r.form[.], filed: $r.filingDate[.], report_date: $r.reportDate[.], cik: $cik,
                   description: $r.primaryDocDescription[.], adsh: $r.accessionNumber[.],
                   url: ("https://www.sec.gov/Archives/edgar/data/" + ($cik | tostring) + "/" + ($r.accessionNumber[.] | gsub("-";"")) + "/" + $r.primaryDocument[.])}]
                  | map(select($forms == "" or (.form as $f | ($forms | split(",")) | index($f)))) | .[:$n])}'
    ;;
  facts)
    cik=$(resolve_cik "$arg")
    sec_get "https://data.sec.gov/api/xbrl/companyfacts/CIK$cik.json" > "$LA_TMP/facts.json"
    if [ -z "$concept" ]; then
      jq '{entity: .entityName, cik, concepts: ([.facts[] | keys[]] | unique)}' "$LA_TMP/facts.json"
    else
      jq --arg c "$concept" --argjson n "$limit" '
        (.facts["us-gaap"][$c] // .facts["ifrs-full"][$c] // .facts["dei"][$c]) as $f
        | if $f == null then error("concept \($c) not reported by this filer; run without --concept to list") else
          ($f.units | to_entries[0]) as $u
          | {entity: .entityName, concept: $c, label: $f.label, unit: $u.key,
             values: ([$u.value[] | select(.form == "10-K" or .form == "20-F" or .form == "10-Q")
                       | {value: .val, fy: .fy, fp: .fp, start, end, form, filed}] | sort_by(.end) | reverse | .[:$n])} end' "$LA_TMP/facts.json"
    fi
    ;;
  cik)
    resolve_cik "$arg" | jq -R '{cik: .}'
    ;;
  *) die "unknown command '$cmd' (see --help)" ;;
esac
