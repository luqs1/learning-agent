#!/usr/bin/env bash
# fetch-readable.sh — URL (or local file) -> readable plain text. HTML and PDF.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: fetch-readable.sh <url|file> [--out FILE] [--json] [--max-chars N] [--keep-pdf FILE]

Fetches a page and prints its main text so you can read the WHOLE thing, not a
search snippet. No key, stdlib only.

  HTML  -> boilerplate stripped (scripts, nav, header, footer, aside); if the
           page has <article>/<main>, only that is kept. Title, canonical URL
           and published date are extracted when present.
  PDF   -> text via `pdftotext` (poppler) if installed, else python `pypdf` or
           `pdfminer` if importable. If none is available the PDF is saved and
           the script exits 3 telling you the path: open it with the Read tool
           (which renders PDFs) instead.
  text/json/markdown -> passed through.

--out FILE     write the text to FILE; stdout then gets JSON metadata
--json         JSON on stdout instead of text (see Output)
--max-chars N  truncate the text (default: no limit; the point is to read it all)
--keep-pdf F   also save a fetched PDF to F (so you can Read specific pages)

Output: the readable text on stdout (default);
        with --out: {url, final_url, content_type, title, published, chars, out};
        with --json: {url, final_url, content_type, title, published, chars, text}

Limits (honest): no JavaScript, so SPA pages, Google News redirect links, some
paywalls and bot-walled sites (reddit.com, x.com, linkedin.com) return little or
nothing — for those use the WebFetch tool, an Exa fetch, or wayback.sh. Tables
in PDFs lose their layout. Scanned PDFs (images) yield no text.
Exit codes: 1 fetch/parse failure, 3 PDF with no extractor available.
EOF
}
want_help "$@" && { usage; exit 0; }
need curl python3

target="" out="" asjson="" maxc=0 keeppdf=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out=$2; shift 2 ;;
    --json) asjson=1; shift ;;
    --max-chars) maxc=$2; shift 2 ;;
    --keep-pdf) keeppdf=$2; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) target=$1; shift ;;
  esac
done
[ -n "$target" ] || die "a url or file is required"

body="$LA_TMP/body"; ctype=""; final="$target"
if [ -f "$target" ]; then
  cp "$target" "$body"
else
  hdrs="$LA_TMP/hdrs"
  ua="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 learning-agent/1.1"
  case "$target" in *sec.gov/*) ua="${EDGAR_USER_AGENT:-learning-agent research-bot@example.com}" ;; esac  # SEC rejects browser UAs from tools
  code=$(curl -sS -L --max-time "${LA_TIMEOUT:-60}" -A "$ua" \
    -H "accept: text/html,application/xhtml+xml,application/pdf,text/plain,*/*" --compressed \
    -o "$body" -D "$hdrs" -w '%{http_code}\n%{url_effective}\n%{content_type}' "$target") \
    || die "fetch failed for $target"
  status=$(printf '%s' "$code" | sed -n 1p); final=$(printf '%s' "$code" | sed -n 2p); ctype=$(printf '%s' "$code" | sed -n 3p)
  case "$status" in 2*) ;; *) die "HTTP $status for $target" ;; esac
fi

is_pdf=""
if head -c 5 "$body" | grep -q '%PDF' || [[ "$ctype" == application/pdf* ]]; then is_pdf=1; fi

text="$LA_TMP/text"; title=""; published=""
if [ -n "$is_pdf" ]; then
  [ -n "$keeppdf" ] && cp "$body" "$keeppdf"
  if command -v pdftotext >/dev/null 2>&1; then
    pdftotext -layout -enc UTF-8 "$body" "$text" 2>/dev/null || pdftotext "$body" "$text"
  elif python3 -c 'import pypdf' 2>/dev/null; then
    python3 -c 'import sys,pypdf; r=pypdf.PdfReader(sys.argv[1]); print("\n\f".join((p.extract_text() or "") for p in r.pages))' "$body" > "$text"
  elif python3 -c 'import pdfminer.high_level' 2>/dev/null; then
    python3 -c 'import sys,pdfminer.high_level as h; print(h.extract_text(sys.argv[1]))' "$body" > "$text"
  else
    keep="${keeppdf:-${out:-$PWD/fetched-$(date +%s).pdf}}"; cp "$body" "$keep"
    echo "$SCRIPT_NAME: PDF saved to $keep but no text extractor is installed (brew install poppler | pip install pypdf). Use the Read tool on that file with pages=..." >&2
    exit 3
  fi
  title=$(head -c 2000 "$text" | grep -m1 -E '[A-Za-z]{3,}' | sed 's/^ *//' | cut -c1-150)
else
  python3 - "$body" "$text" "$LA_TMP/meta" <<'PY'
import sys, re, html, json
from html.parser import HTMLParser
raw = open(sys.argv[1], "rb").read()
try: src = raw.decode("utf-8")
except UnicodeDecodeError: src = raw.decode("latin-1", errors="replace")
looks_html = re.search(r"(?i)<(html|body|div|p|article)\b", src[:20000]) is not None
if not looks_html:
    open(sys.argv[2], "w", encoding="utf-8").write(src)
    json.dump({"title": "", "published": "", "kind": "text"}, open(sys.argv[3], "w")); sys.exit(0)
DROP = {"script", "style", "noscript", "svg", "nav", "header", "footer", "aside", "form", "iframe", "template", "button"}
BLOCK = {"p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "table", "section", "article", "blockquote", "pre", "dd", "dt", "figcaption", "hr", "main"}
class P(HTMLParser):
    def __init__(s):
        super().__init__(convert_charrefs=True); s.out=[]; s.main=[]; s.skip=0; s.in_main=0; s.title=""; s.in_title=False; s.meta={}; s.tag=None
    def handle_starttag(s, t, a):
        a = dict(a)
        if t in DROP: s.skip += 1; return
        if t == "title": s.in_title = True
        if t == "meta":
            k = a.get("property") or a.get("name") or ""
            if k in ("article:published_time", "datePublished", "date", "pubdate", "og:title", "description", "og:description") and a.get("content"):
                s.meta.setdefault(k, a["content"])
        if t == "link" and a.get("rel") == "canonical": s.meta["canonical"] = a.get("href")
        if t == "time" and a.get("datetime"): s.meta.setdefault("time", a["datetime"])
        if t in ("article", "main"): s.in_main += 1
        if t in ("h1","h2","h3","h4"): (s.main if s.in_main else s.out).append("\n\n" + "#" * int(t[1]) + " ")
        elif t in BLOCK: (s.main if s.in_main else s.out).append("\n")
        s.tag = t
    def handle_endtag(s, t):
        if t in DROP: s.skip = max(0, s.skip - 1); return
        if t == "title": s.in_title = False
        if t in ("article", "main"): s.in_main = max(0, s.in_main - 1)
        if t in BLOCK or t in ("h1","h2","h3","h4"): (s.main if s.in_main else s.out).append("\n")
    def handle_data(s, d):
        if s.in_title: s.title += d; return
        if s.skip: return
        (s.main if s.in_main else s.out).append(d)
p = P(); p.feed(src)
chunks = p.main if len("".join(p.main).strip()) > 500 else p.out + p.main
text = "".join(chunks)
text = re.sub(r"[ \t\r\f\v]+", " ", text)
text = re.sub(r" *\n *", "\n", text)
text = re.sub(r"\n{3,}", "\n\n", text).strip()
open(sys.argv[2], "w", encoding="utf-8").write(text + "\n")
pub = p.meta.get("article:published_time") or p.meta.get("datePublished") or p.meta.get("date") or p.meta.get("pubdate") or p.meta.get("time") or ""
json.dump({"title": re.sub(r"\s+", " ", p.title).strip() or p.meta.get("og:title", ""), "published": pub, "canonical": p.meta.get("canonical", ""), "kind": "html"}, open(sys.argv[3], "w"))
PY
  title=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["title"])' "$LA_TMP/meta")
  published=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["published"])' "$LA_TMP/meta")
fi

if [ "$maxc" -gt 0 ]; then head -c "$maxc" "$text" > "$text.t" && mv "$text.t" "$text"; fi
chars=$(wc -c < "$text" | tr -d ' ')
[ "$chars" -gt 20 ] || warn "very little text extracted ($chars chars) — the page is probably JS-rendered or bot-walled; try WebFetch or wayback.sh"

if [ -n "$out" ]; then
  cp "$text" "$out"
  jq -n --arg url "$target" --arg final "$final" --arg ct "$ctype" --arg title "$title" --arg pub "$published" --argjson chars "$chars" --arg out "$out" \
    '{url: $url, final_url: $final, content_type: $ct, title: $title, published: $pub, chars: $chars, out: $out}'
elif [ -n "$asjson" ]; then
  jq -n --arg url "$target" --arg final "$final" --arg ct "$ctype" --arg title "$title" --arg pub "$published" --argjson chars "$chars" --rawfile text "$text" \
    '{url: $url, final_url: $final, content_type: $ct, title: $title, published: $pub, chars: $chars, text: $text}'
else
  cat "$text"
fi
