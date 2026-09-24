#!/usr/bin/env bash
# yt-transcript.sh — video URL/id -> transcript as plain text (via yt-dlp subtitles).
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: yt-transcript.sh <url|video-id> [--lang en] [--out FILE] [--json] [--timestamps]

Downloads the video's subtitles with yt-dlp (manual subs preferred, auto-generated
as fallback), strips cue formatting and the rolling duplicates YouTube auto-subs
contain, and prints plain text. Works for any site yt-dlp supports (YouTube,
Vimeo, ...). No key. Nothing is downloaded except the subtitle file.

--lang LL       subtitle language (default en; matches en, en-orig, en-GB, ...)
--out FILE      write the text to FILE and print JSON metadata to stdout
--json          print {id, title, channel, upload_date, duration_s, lang, chars, text} to stdout
--timestamps    keep a [mm:ss] marker at the start of each cue (for citing a moment)

Default output: the transcript text on stdout. Read ALL of it before citing;
cite as the video URL plus the timestamp of the passage.
Limits: videos with no subtitles at all fail (exit 1). The output does not say
whether subs were manual or auto-generated (run `yt-dlp --list-subs <url>` to
see); treat them as auto (~90-95% accurate), and double-check names and numbers.
EOF
}
want_help "$@" && { usage; exit 0; }
need yt-dlp python3 jq

target="" lang=en out="" asjson="" ts=""
while [ $# -gt 0 ]; do
  case "$1" in
    --lang) lang=$2; shift 2 ;;
    --out) out=$2; shift 2 ;;
    --json) asjson=1; shift ;;
    --timestamps) ts=1; shift ;;
    -*) die "unknown option $1" ;;
    *) target=$1; shift ;;
  esac
done
[ -n "$target" ] || die "a url or video id is required"
case "$target" in http*|/*) ;; *) target="https://www.youtube.com/watch?v=$target" ;; esac

yt-dlp --skip-download --write-subs --write-auto-subs --sub-langs "${lang},${lang}-orig,${lang}.*" \
  --sub-format "vtt/srt/best" --no-warnings --quiet \
  --print-to-file '%(id)s|||%(title)s|||%(channel)s|||%(upload_date)s|||%(duration)s' "$LA_TMP/meta.tsv" \
  -o "$LA_TMP/%(id)s" "$target" 2>"$LA_TMP/err" || die "yt-dlp failed: $(tail -c 400 "$LA_TMP/err")"

sub=$(ls "$LA_TMP"/*.vtt "$LA_TMP"/*.srt 2>/dev/null | head -1 || true)
[ -n "$sub" ] || die "no subtitles available for $target in language '$lang' (try --lang, or another video)"

python3 - "$sub" "$LA_TMP/meta.tsv" "${ts:-0}" "${asjson:-0}" "$out" "$lang" <<'PY'
import sys, re, json, html
sub, meta, ts, asjson, out, lang = sys.argv[1:7]
raw = open(sub, encoding="utf-8", errors="replace").read()
lines = []
last = ""
cue_t = None
for ln in raw.splitlines():
    ln = ln.strip()
    m = re.match(r"(\d+:)?(\d\d):(\d\d)[.,]\d+\s*-->", ln)
    if m:
        h = int((m.group(1) or "0:")[:-1]); cue_t = h*3600 + int(m.group(2))*60 + int(m.group(3))
        continue
    if not ln or ln.isdigit() or ln.startswith(("WEBVTT", "Kind:", "Language:", "NOTE")):
        continue
    ln = re.sub(r"<[^>]+>", "", ln)
    ln = html.unescape(ln).strip()
    if not ln or ln == last:
        continue
    last = ln
    if ts == "1" and cue_t is not None:
        ln = "[%02d:%02d] %s" % (cue_t // 60, cue_t % 60, ln); cue_t = None
    lines.append(ln)
text = "\n".join(lines)
vid, title, channel, upload_date, duration = (open(meta).read().strip().split("|||") + [""]*5)[:5]
info = {"id": vid, "title": title, "channel": channel, "upload_date": upload_date,
        "duration_s": int(duration) if duration.isdigit() else None,
        "lang": lang, "chars": len(text),
        "url": "https://www.youtube.com/watch?v=" + vid if len(vid) == 11 else vid}
if out:
    open(out, "w", encoding="utf-8").write(text + "\n")
    info["out"] = out
    print(json.dumps(info, ensure_ascii=False))
elif asjson == "1":
    info["text"] = text
    print(json.dumps(info, ensure_ascii=False))
else:
    sys.stdout.write(text + "\n")
PY
