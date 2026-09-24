#!/usr/bin/env bash
# wikimedia-images.sh — search Wikimedia Commons for images/diagrams. Free, no key.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: wikimedia-images.sh <query> [--limit N] [--width PX]

Searches the File: namespace of Wikimedia Commons (MediaWiki API,
https://commons.wikimedia.org/w/api.php) and returns direct image URLs with
licence and attribution. Good for diagrams, schematics, historical figures,
anatomy, maps.

--limit N   results (default 8, max 50)
--width PX  thumbnail width (default 1024) — view the thumb with the Read tool

Output: JSON array of {title, page_url, url, thumb_url, width, height, mime,
        description, license, artist, credit}
Always view the image before citing it, and cite page_url (the file page).
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq

query="" limit=8 width=1024
while [ $# -gt 0 ]; do
  case "$1" in
    --limit) limit=$2; shift 2 ;;
    --width) width=$2; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) query="${query:+$query }$1"; shift ;;
  esac
done
[ -n "$query" ] || die "a query is required"

url="https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&generator=search&gsrsearch=$(urlenc "$query")&gsrnamespace=6&gsrlimit=$limit&prop=imageinfo&iiprop=url%7Cextmetadata%7Csize%7Cmime&iiurlwidth=$width&iiextmetadatafilter=ImageDescription%7CLicenseShortName%7CArtist%7CCredit"
http_get "$url" | jq '
  def clean: if . == null then null else (gsub("<[^>]+>"; "") | gsub("\\s+"; " ") | .[0:400]) end;
  [(.query.pages // []) | sort_by(.index)[] | .imageinfo[0] as $i | {
    title, page_url: ("https://commons.wikimedia.org/wiki/" + (.title | @uri)),
    url: ($i.url | split("?")[0]), thumb_url: ($i.thumburl | split("?")[0]),
    width: $i.width, height: $i.height, mime: $i.mime,
    description: ($i.extmetadata.ImageDescription.value | clean),
    license: $i.extmetadata.LicenseShortName.value,
    artist: ($i.extmetadata.Artist.value | clean),
    credit: ($i.extmetadata.Credit.value | clean)}]'
