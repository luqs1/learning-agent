#!/usr/bin/env bash
# companies-house.sh — UK Companies House. API with COMPANIES_HOUSE_API_KEY; public pages otherwise.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: companies-house.sh search   <company name> [--limit N]
       companies-house.sh company  <company number>
       companies-house.sh officers <company number>      # key required
       companies-house.sh filings  <company number> [--limit N] [--category accounts|capital|incorporation|...]
       companies-house.sh psc      <company number>      # key required (persons with significant control)

UK incorporation, officers, accounts and share allotments (SH01 = a funding
round's share issue) — the primary source for any UK company.

  With COMPANIES_HOUSE_API_KEY (free; https://developer.company-information.service.gov.uk/)
    -> REST API, https://api.company-information.service.gov.uk (600 req / 5 min)
  Without a key
    -> `search` and `company` are scraped from the public site
       https://find-and-update.company-information.service.gov.uk (best effort; fields may be missing).
       `filings` returns the public filing-history page URL for fetch-readable.sh.
       `officers`/`psc` exit 2 with the public URL to read instead.

Output: JSON. search -> [{company_number, title, status, type, incorporated,
        address, url}]; company -> profile object; filings -> [{date, type,
        category, description, document_url}].
Cite the company number and the filing date; the filing PDF is the source.
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq python3

API=https://api.company-information.service.gov.uk
WEB=https://find-and-update.company-information.service.gov.uk

cmd=$1; shift
arg="" limit=10 cat=""
while [ $# -gt 0 ]; do
  case "$1" in
    --limit) limit=$2; shift 2 ;;
    --category) cat=$2; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) arg="${arg:+$arg }$1"; shift ;;
  esac
done
[ -n "$arg" ] || die "missing argument (see --help)"

if [ -n "${COMPANIES_HOUSE_API_KEY:-}" ]; then
  ch_get() { http_get "$API$1" -u "$COMPANIES_HOUSE_API_KEY:" -H "accept: application/json"; }
  case "$cmd" in
    search)  ch_get "/search/companies?q=$(urlenc "$arg")&items_per_page=$limit" | jq '[.items[] | {
               company_number, title, status: .company_status, type: .company_type,
               incorporated: .date_of_creation, address: .address_snippet,
               url: ("https://find-and-update.company-information.service.gov.uk/company/" + .company_number)}]' ;;
    company) ch_get "/company/$arg" ;;
    officers) ch_get "/company/$arg/officers" | jq '[.items[] | {name, role: .officer_role, appointed: .appointed_on, resigned: .resigned_on, nationality, occupation}]' ;;
    filings) url="/company/$arg/filing-history?items_per_page=$limit"; [ -n "$cat" ] && url="$url&category=$cat"
             ch_get "$url" | jq --arg n "$arg" '[.items[] | {date, type, category, description,
               document_url: (if .links.document_metadata then (.links.document_metadata + "/content") else null end)}]' ;;
    psc)     ch_get "/company/$arg/persons-with-significant-control" | jq '[.items[] | {name, kind, notified_on: .notified_on, ceased_on, natures_of_control}]' ;;
    *) die "unknown command '$cmd'" ;;
  esac
  exit 0
fi

warn "COMPANIES_HOUSE_API_KEY not set; using the public website (best effort HTML parsing)"
web_get() { LA_UA="Mozilla/5.0 (compatible; learning-agent/1.1)" http_get "$1"; }
case "$cmd" in
  search)
    web_get "$WEB/search/companies?q=$(urlenc "$arg")" | python3 -c '
import sys, re, json, html
h = sys.stdin.read()
out = []
for m in re.finditer(r"<li class=\"type-company\">(.*?)</li>", h, re.S):
    b = m.group(1)
    num = re.search(r"href=\"/company/([0-9A-Z]+)\"", b)
    title = re.search(r"<a[^>]*>(.*?)</a>", b, re.S)
    ps = [html.unescape(re.sub(r"<[^>]+>", "", p)).strip() for p in re.findall(r"<p[^>]*>(.*?)</p>", b, re.S)]
    if not num: continue
    meta = ps[0] if ps else ""
    out.append({"company_number": num.group(1), "title": html.unescape(re.sub(r"\s+", " ", title.group(1))).strip() if title else None,
                "meta": meta, "address": ps[1] if len(ps) > 1 else None,
                "url": "https://find-and-update.company-information.service.gov.uk/company/" + num.group(1)})
json.dump(out[:'"$limit"'], sys.stdout, indent=1); print()'
    ;;
  company)
    web_get "$WEB/company/$arg" | python3 -c '
import sys, re, json, html
h = sys.stdin.read()
def clean(s): return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()
name = re.search(r"<h1 class=\"heading-xlarge\"[^>]*>(.*?)</h1>", h, re.S)
out = {"company_number": "'"$arg"'", "name": clean(name.group(1)) if name else None,
       "url": "https://find-and-update.company-information.service.gov.uk/company/'"$arg"'"}
for dt, dd in re.findall(r"<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>", h, re.S):
    k = clean(dt).lower().replace(" ", "_")
    if k: out[k] = clean(dd)
sic = re.findall(r"<span id=\"sic\d+\">(.*?)</span>", h, re.S)
if sic: out["sic_codes"] = [clean(s) for s in sic]
json.dump(out, sys.stdout, indent=1); print()'
    ;;
  filings)
    jq -n --arg u "$WEB/company/$arg/filing-history" '{note: "no API key: read this page with fetch-readable.sh", url: $u}'
    ;;
  officers|psc)
    sub=officers; [ "$cmd" = psc ] && sub=persons-with-significant-control
    missing_key COMPANIES_HOUSE_API_KEY "https://developer.company-information.service.gov.uk/ (free)" \
      "fetch-readable.sh $WEB/company/$arg/$sub"
    ;;
  *) die "unknown command '$cmd'" ;;
esac
