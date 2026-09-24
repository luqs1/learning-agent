#!/usr/bin/env bash
# openverse.sh — Openverse (openly licensed images/audio). Free, no key.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: openverse.sh <query> [--limit N] [--license by,by-sa,cc0,pdm] [--source flickr,wikimedia,...] [--audio]

Openverse API (https://api.openverse.org/v1/) — 800M+ CC-licensed images
(Flickr, Wikimedia, museums, ...) and audio. Anonymous use is allowed but
rate-limited (~100 requests/day); set OPENVERSE_TOKEN (OAuth bearer) for more.

--limit N    results (default 8, max 20 anonymous)
--license    comma list: by, by-sa, by-nd, by-nc, cc0, pdm, ...
--source     comma list of providers
--audio      search audio (lectures, podcasts, field recordings) instead of images

Output: JSON array of {id, title, url, thumbnail, page_url, creator, license,
        license_url, provider, width, height, attribution}
View the image (Read the url) before citing; cite page_url.
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq

query="" limit=8 lic="" src="" kind=images
while [ $# -gt 0 ]; do
  case "$1" in
    --limit) limit=$2; shift 2 ;;
    --license) lic=$2; shift 2 ;;
    --source) src=$2; shift 2 ;;
    --audio) kind=audio; shift ;;
    -*) die "unknown option $1" ;;
    *) query="${query:+$query }$1"; shift ;;
  esac
done
[ -n "$query" ] || die "a query is required"
[ "$limit" -le 20 ] || limit=20
hdr=(-H "accept: application/json")
[ -n "${OPENVERSE_TOKEN:-}" ] && hdr+=(-H "authorization: Bearer $OPENVERSE_TOKEN")

url="https://api.openverse.org/v1/$kind/?q=$(urlenc "$query")&page_size=$limit"
[ -n "$lic" ] && url="$url&license=$(urlenc "$lic")"
[ -n "$src" ] && url="$url&source=$(urlenc "$src")"
http_get "$url" "${hdr[@]}" | jq '[.results[] | {id, title, url, thumbnail,
  page_url: .foreign_landing_url, creator, license: (.license + " " + (.license_version // "")),
  license_url, provider, width, height, attribution}]'
