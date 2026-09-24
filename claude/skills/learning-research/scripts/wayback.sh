#!/usr/bin/env bash
# wayback.sh — Internet Archive Wayback Machine: snapshot history (CDX) and nearest snapshot.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: wayback.sh list    <url> [--from YYYY[MM]] [--to YYYY[MM]] [--limit N] [--all]
       wayback.sh nearest <url> [--at YYYYMMDD]

CDX API (https://web.archive.org/cdx/search/cdx). No key; ~1 req/s or it 429s.
Use it to see how a competitor's pricing/product page changed over time, or to
read a page that has since been deleted.

list     one row per *distinct* version (collapsed on content digest) with
         HTTP 200 only, oldest first. --all keeps every capture.
nearest  the last snapshot at or before --at (default: today), else the first after it.

Output: list -> [{timestamp, date, original, status, snapshot_url, raw_url}]
        nearest -> {available, timestamp, date, original, snapshot_url, raw_url}
raw_url (the `id_` flag) serves the archived HTML without the Wayback toolbar —
read it with fetch-readable.sh. Cite as "<original>, archived <date> (Wayback)".
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq

cmd=$1; shift
arg="" from="" to="" limit=50 all="" at=""
while [ $# -gt 0 ]; do
  case "$1" in
    --from) from=$2; shift 2 ;;
    --to) to=$2; shift 2 ;;
    --limit) limit=$2; shift 2 ;;
    --all) all=1; shift ;;
    --at) at=$2; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) arg=$1; shift ;;
  esac
done
[ -n "$arg" ] || die "a url is required"

case "$cmd" in
  list)
    url="https://web.archive.org/cdx/search/cdx?url=$(urlenc "$arg")&output=json&fl=timestamp,original,statuscode,digest&filter=statuscode:200&limit=$limit"
    [ -z "$all" ] && url="$url&collapse=digest"
    [ -n "$from" ] && url="$url&from=$from"
    [ -n "$to" ] && url="$url&to=$to"
    http_get "$url" | jq 'if length == 0 then [] else .[1:] | map({timestamp: .[0],
      date: (.[0][0:4] + "-" + .[0][4:6] + "-" + .[0][6:8]), original: .[1], status: .[2],
      snapshot_url: ("https://web.archive.org/web/" + .[0] + "/" + .[1]),
      raw_url: ("https://web.archive.org/web/" + .[0] + "id_/" + .[1])}) end'
    ;;
  nearest)
    # CDX: last 200 capture at/before --at (limit=-1 = last row), else the first one after it.
    base="https://web.archive.org/cdx/search/cdx?url=$(urlenc "$arg")&output=json&fl=timestamp,original,statuscode&filter=statuscode:200"
    row=$(http_get "$base&to=${at:-$(date +%Y%m%d)}&limit=-1" | jq -c '.[1] // empty')
    [ -z "$row" ] && [ -n "$at" ] && row=$(http_get "$base&from=$at&limit=1" | jq -c '.[1] // empty')
    if [ -z "$row" ]; then echo '{"available": false}'; else
      printf '%s' "$row" | jq '{available: true, timestamp: .[0], date: (.[0][0:4] + "-" + .[0][4:6] + "-" + .[0][6:8]), original: .[1],
        snapshot_url: ("https://web.archive.org/web/" + .[0] + "/" + .[1]), raw_url: ("https://web.archive.org/web/" + .[0] + "id_/" + .[1])}'
    fi
    ;;
  *) die "unknown command '$cmd' (see --help)" ;;
esac
