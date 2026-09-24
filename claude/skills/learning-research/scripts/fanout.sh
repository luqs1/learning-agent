#!/usr/bin/env bash
# fanout.sh — run several helper-script calls concurrently, with a per-host cap
# and a per-host minimum gap so rate-limited providers are staggered, not hammered.
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: fanout.sh [--jobs N] [--per-host N] [--timeout S] [--max-chars N] '<cmd 1>' '<cmd 2>' ...
       printf '%s\n' '<cmd 1>' '<cmd 2>' | fanout.sh [options]

Runs every command line concurrently (one bash -c per line) and prints one JSON
object per line, in input order, when all have finished. The scripts directory
is put on PATH, so a line can call a bundled script by bare name:

  fanout.sh 'arxiv.sh "hash table collision" --max 5' \
            'hn.sh "hash table" --stories --limit 10' \
            'fetch-readable.sh https://docs.python.org/3/faq/design.html --out "$LA_OUT/faq.txt"'

Concurrency is capped per host, not just globally, and calls to the same host
are started at least <gap> seconds apart, so a fan-out can include several
calls to a rate-limited provider and they will queue instead of 429-ing:

  host (script)                          gap   why
  export.arxiv.org (arxiv.sh)            3s    arXiv asks for <= 1 request / 3 s
  api.gdeltproject.org (news.sh --gdelt) 5s    GDELT: 1 request / 5 s per IP
  reddit.com (reddit.sh)                 2s    RSS feeds 429 on bursts
  web.archive.org (wayback.sh)           1s    CDX ~1 request / s
  api.semanticscholar.org (s2.sh)        1s    shared keyless pool
  youtube.com (yt-*.sh), patents,        1s    bot-walls on bursts
    brave (websearch.sh), github.sh
  sec.gov (edgar.sh)                     0.1s  SEC allows 10 request / s
  everything else                        0     (pubmed 0.34s, companies house 0.5s, fetch-readable 0.5s per host)

For fetch-readable.sh / yt-transcript.sh / curl the host is the first URL on
the line; other scripts map to their provider's host; unknown commands share
the host "other".

--jobs N        global concurrency (default 8)
--per-host N    concurrent calls per host (default 1: same-host calls serialise)
--timeout S     kill a command after S seconds (default 120; exit is then 124)
--max-chars N   truncate each command's stdout/stderr in the JSON (default 200000;
                use --out FILE on fetch-readable.sh so stdout stays small)

Env: LA_OUT is exported to every command as a per-run scratch directory that
survives the run (under $TMPDIR), so '--out "$LA_OUT/<name>.txt"' gives you a file
to Read afterwards; the path is printed in the trailing summary line on stderr.

Output: one JSON object per command, one per line, in input order:
        {i, cmd, host, exit, ms, stdout, stderr, truncated}
        exit 124 = timed out, 127 = command not found. fanout.sh itself exits 0
        when every command exited 0, else 1 (the per-line exit codes say which).
EOF
}
if [ $# -eq 0 ] && [ -t 0 ]; then usage; exit 0; fi
if [ $# -gt 0 ] && want_help "$@"; then usage; exit 0; fi
need python3

jobs=8 per_host=1 timeout=120 max_chars=200000
cmds=()
while [ $# -gt 0 ]; do
  case "$1" in
    --jobs) jobs=$2; shift 2 ;;
    --per-host) per_host=$2; shift 2 ;;
    --timeout) timeout=$2; shift 2 ;;
    --max-chars) max_chars=$2; shift 2 ;;
    --) shift; while [ $# -gt 0 ]; do cmds+=("$1"); shift; done ;;
    -*) die "unknown option $1" ;;
    *) cmds+=("$1"); shift ;;
  esac
done
is_int "$jobs" && is_int "$per_host" && is_int "$timeout" && is_int "$max_chars" || die "--jobs, --per-host, --timeout and --max-chars take integers"

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
export PATH="$SCRIPT_DIR:$PATH"
# Scratch dir for the commands' own output files; unlike LA_TMP it outlives this run.
LA_OUT=$(mktemp -d "${TMPDIR:-/tmp}/la-fanout-out.XXXXXX")
export LA_OUT
export FANOUT_JOBS=$jobs FANOUT_PER_HOST=$per_host FANOUT_TIMEOUT=$timeout FANOUT_MAX_CHARS=$max_chars

cat >"$LA_TMP/fanout.py" <<'PY'
import json, os, re, subprocess, sys, threading, time

jobs = int(os.environ["FANOUT_JOBS"]); per_host = int(os.environ["FANOUT_PER_HOST"])
timeout = int(os.environ["FANOUT_TIMEOUT"]); max_chars = int(os.environ["FANOUT_MAX_CHARS"])

cmds = [c for c in sys.argv[1:]] if len(sys.argv) > 1 else [l.rstrip("\n") for l in sys.stdin]
cmds = [c for c in cmds if c.strip() and not c.lstrip().startswith("#")]
if not cmds:
    sys.exit("fanout.sh: no commands given (pass them as arguments or one per line on stdin)")

# script -> (host, minimum gap in seconds between starts to that host)
HOSTS = {
    "arxiv.sh": ("export.arxiv.org", 3.0),
    "s2.sh": ("api.semanticscholar.org", 1.0),
    "openalex.sh": ("api.openalex.org", 0.1),
    "pubmed.sh": ("eutils.ncbi.nlm.nih.gov", 0.34),
    "crossref.sh": ("api.crossref.org", 0.1),
    "wikimedia-images.sh": ("commons.wikimedia.org", 0.0),
    "openverse.sh": ("api.openverse.org", 0.0),
    "yt-search.sh": ("youtube.com", 1.0),
    "yt-transcript.sh": ("youtube.com", 1.0),
    "edgar.sh": ("sec.gov", 0.1),
    "companies-house.sh": ("company-information.service.gov.uk", 0.5),
    "hn.sh": ("hn.algolia.com", 0.0),
    "reddit.sh": ("reddit.com", 2.0),
    "worldbank.sh": ("api.worldbank.org", 0.0),
    "fred.sh": ("fred.stlouisfed.org", 0.0),
    "ons.sh": ("api.beta.ons.gov.uk", 0.0),
    "wayback.sh": ("web.archive.org", 1.0),
    "news.sh": ("news.google.com", 0.0),
    "patents.sh": ("patents.google.com", 1.0),
    "github.sh": ("api.github.com", 1.0),
    "exa.sh": ("api.exa.ai", 0.0),
    "websearch.sh": ("api.search.brave.com", 1.0),
}
URL_HOSTED = {"fetch-readable.sh", "curl", "wget"}

def host_of(cmd):
    tokens = cmd.strip().split()
    name = os.path.basename(tokens[0]) if tokens else ""
    if name == "news.sh" and "--gdelt" in tokens:
        return "api.gdeltproject.org", 5.0
    if name in HOSTS:
        return HOSTS[name]
    m = re.search(r"https?://([^/\s'\"]+)", cmd)
    if m:
        h = m.group(1).lower()
        h = h[4:] if h.startswith("www.") else h
        return h, (0.5 if name in URL_HOSTED else 0.0)
    return "other", 0.0

lock = threading.Lock()
host_sem = {}; host_last = {}; host_gap = {}
for c in cmds:
    h, g = host_of(c)
    host_sem.setdefault(h, threading.Semaphore(per_host)); host_gap[h] = g; host_last.setdefault(h, 0.0)
global_sem = threading.Semaphore(jobs)
results = [None] * len(cmds)

def clip(s):
    if len(s) <= max_chars:
        return s, False
    return s[:max_chars] + "\n...[truncated]", True

def run(i, cmd):
    host, gap = host_of(cmd)
    with global_sem, host_sem[host]:
        with lock:
            wait = host_last[host] + gap - time.time()
            host_last[host] = max(time.time(), host_last[host] + gap) if wait > 0 else time.time()
        if wait > 0:
            time.sleep(wait)
        t0 = time.time()
        try:
            p = subprocess.run(["bash", "-c", cmd], capture_output=True, text=True, errors="replace", timeout=timeout)
            code, out, err = p.returncode, p.stdout, p.stderr
        except subprocess.TimeoutExpired as e:
            code = 124
            out = (e.stdout or b"").decode("utf-8", "replace") if isinstance(e.stdout, bytes) else (e.stdout or "")
            err = ((e.stderr or b"").decode("utf-8", "replace") if isinstance(e.stderr, bytes) else (e.stderr or "")) + f"\nfanout.sh: timed out after {timeout}s"
        ms = int((time.time() - t0) * 1000)
    out, t1 = clip(out); err, t2 = clip(err)
    results[i] = {"i": i, "cmd": cmd, "host": host, "exit": code, "ms": ms, "stdout": out, "stderr": err.strip(), "truncated": t1 or t2}

threads = [threading.Thread(target=run, args=(i, c), daemon=True) for i, c in enumerate(cmds)]
t_all = time.time()
for t in threads: t.start()
for t in threads: t.join()
for r in results:
    sys.stdout.write(json.dumps(r, ensure_ascii=False) + "\n")
failed = sum(1 for r in results if r["exit"] != 0)
sys.stderr.write(f"fanout.sh: {len(results)} commands, {failed} failed, {int((time.time() - t_all) * 1000)} ms wall; output files (if any) under {os.environ.get('LA_OUT', '')}\n")
sys.exit(1 if failed else 0)
PY

if [ "${#cmds[@]}" -gt 0 ]; then
  python3 "$LA_TMP/fanout.py" "${cmds[@]}"
else
  python3 "$LA_TMP/fanout.py"
fi
