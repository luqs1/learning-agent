#!/usr/bin/env bash
# yt-search.sh — YouTube search. Data API v3 when YOUTUBE_API_KEY is set, else yt-dlp.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: yt-search.sh <query> [--limit N] [--channel "Name"]

Finds lectures, talks and tutorials.
  With YOUTUBE_API_KEY  -> YouTube Data API v3 search.list (10k units/day free;
                           https://console.cloud.google.com/apis/library/youtube.googleapis.com)
  Without a key         -> yt-dlp "ytsearchN:<query>" (keyless; slower; no view
                           counts filter). yt-dlp must be in PATH.
--limit N     results (default 8)
--channel     filter results whose channel name contains this string (post-filter)

Output: JSON array of {id, url, title, channel, published, duration_s, views, description}
Then read the content, not the title: yt-transcript.sh <id>
EOF
}
want_help "$@" && { usage; exit 0; }
need jq

query="" limit=8 channel=""
while [ $# -gt 0 ]; do
  case "$1" in
    --limit) limit=$2; shift 2 ;;
    --channel) channel=$2; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) query="${query:+$query }$1"; shift ;;
  esac
done
[ -n "$query" ] || die "a query is required"
is_int "$limit" || die "--limit must be an integer"

if [ -n "${YOUTUBE_API_KEY:-}" ]; then
  need curl
  url="https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=$limit&q=$(urlenc "$query")&key=$YOUTUBE_API_KEY"
  ids=$(http_get "$url" | jq -r '[.items[].id.videoId] | join(",")')
  [ -n "$ids" ] || { echo "[]"; exit 0; }
  out=$(http_get "https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,statistics&id=$ids&key=$YOUTUBE_API_KEY" | jq '
    def dur: capture("PT(?<h>[0-9]+H)?(?<m>[0-9]+M)?(?<s>[0-9]+S)?") | ((.h//"0H")[:-1]|tonumber)*3600 + ((.m//"0M")[:-1]|tonumber)*60 + ((.s//"0S")[:-1]|tonumber);
    [.items[] | {id, url: ("https://www.youtube.com/watch?v=" + .id), title: .snippet.title,
      channel: .snippet.channelTitle, published: .snippet.publishedAt,
      duration_s: (.contentDetails.duration | dur), views: (.statistics.viewCount | tonumber? // null),
      description: .snippet.description[0:300]}]')
else
  need yt-dlp
  warn "YOUTUBE_API_KEY not set; using yt-dlp ytsearch (keyless)"
  out=$(yt-dlp "ytsearch${limit}:${query}" --flat-playlist --dump-json --no-warnings --quiet 2>"$LA_TMP/err" \
    | jq -s '[.[] | {id, url, title, channel, published: (.upload_date // null),
              duration_s: .duration, views: .view_count, description: ((.description // "")[0:300])}]') \
    || die "yt-dlp failed: $(head -c 300 "$LA_TMP/err")"
fi
if [ -n "$channel" ]; then
  printf '%s' "$out" | jq --arg c "$channel" '[.[] | select((.channel // "") | ascii_downcase | contains($c | ascii_downcase))]'
else
  printf '%s\n' "$out"
fi
