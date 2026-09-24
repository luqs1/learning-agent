#!/usr/bin/env bash
# github.sh — GitHub repo search, repo metadata, README. No key needed (GITHUB_TOKEN optional).
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: github.sh repos  <query> [--limit N] [--sort stars|updated]
       github.sh repo   <owner/name>
       github.sh readme <owner/name>          # README as plain markdown on stdout
       github.sh code   <query>               # needs GITHUB_TOKEN

GitHub REST API (https://api.github.com). Unauthenticated: 10 searches/min,
60 requests/hour. Set GITHUB_TOKEN (any personal token) for 30/min + 5000/hour
and for code search.

repos   query supports qualifiers: "language:python stars:>500 topic:llm", "user:karpathy"
readme  the actual README text (first-party evidence for what a project claims)
Clone to read the code itself: git clone --depth 1 https://github.com/<owner>/<name>

Output: repos -> [{full_name, url, description, stars, forks, language, updated, license, archived}];
        repo -> object; code -> [{repo, path, url}]
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq

hdr=(-H "accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")
[ -n "${GITHUB_TOKEN:-}" ] && hdr+=(-H "authorization: Bearer $GITHUB_TOKEN")
API=https://api.github.com
cmd=$1; shift
arg="" limit=10 sort=""
while [ $# -gt 0 ]; do
  case "$1" in
    --limit) limit=$2; shift 2 ;;
    --sort) sort=$2; shift 2 ;;
    -*) die "unknown option $1" ;;
    *) arg="${arg:+$arg }$1"; shift ;;
  esac
done
[ -n "$arg" ] || die "missing argument (see --help)"
REPO='{full_name, url: .html_url, description, stars: .stargazers_count, forks: .forks_count, language,
       updated: .pushed_at, created: .created_at, license: .license.spdx_id, archived, topics, homepage}'

case "$cmd" in
  repos)
    url="$API/search/repositories?q=$(urlenc "$arg")&per_page=$limit"
    [ -n "$sort" ] && url="$url&sort=$sort&order=desc"
    http_get "$url" "${hdr[@]}" | jq "[.items[] | $REPO]"
    ;;
  repo)
    http_get "$API/repos/$arg" "${hdr[@]}" | jq "$REPO"
    ;;
  readme)
    http_get "$API/repos/$arg/readme" "${hdr[@]}" -H "accept: application/vnd.github.raw+json"
    ;;
  code)
    [ -n "${GITHUB_TOKEN:-}" ] || missing_key GITHUB_TOKEN "https://github.com/settings/tokens" "github.sh repos, then clone and grep locally"
    http_get "$API/search/code?q=$(urlenc "$arg")&per_page=$limit" "${hdr[@]}" | jq '[.items[] | {repo: .repository.full_name, path, url: .html_url}]'
    ;;
  *) die "unknown command '$cmd' (see --help)" ;;
esac
