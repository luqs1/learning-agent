#!/usr/bin/env bash
# patents.sh — patent search: Google Patents (keyless, unofficial) or Lens.org (LENS_API_KEY).
. "$(dirname "$0")/_lib.sh"

usage() {
  cat <<'EOF'
usage: patents.sh <query> [--limit N] [--assignee NAME] [--after YYYY-MM-DD] [--lens]

  Default   Google Patents' own JSON endpoint (https://patents.google.com/xhr/query).
            Keyless but UNOFFICIAL — it may change without notice. Returns the
            same results as the website; read a patent with
            fetch-readable.sh https://patents.google.com/patent/<id>/en
  --lens    Lens.org Patent API (https://api.lens.org/patent/search) — official,
            needs LENS_API_KEY (free for non-commercial use, https://www.lens.org/lens/user/subscriptions).

--assignee  filter by assignee/company name
--after     priority date on or after

Output: JSON array of {id, title, url, assignee, inventor, priority_date, filing_date,
        publication_date, grant_date, snippet}
Patents are first-party evidence of what a company is building; cite the
publication number and date.
EOF
}
want_help "$@" && { usage; exit 0; }
need curl jq

query="" limit=10 assignee="" after="" lens=""
while [ $# -gt 0 ]; do
  case "$1" in
    --limit) limit=$2; shift 2 ;;
    --assignee) assignee=$2; shift 2 ;;
    --after) after=$2; shift 2 ;;
    --lens) lens=1; shift ;;
    -*) die "unknown option $1" ;;
    *) query="${query:+$query }$1"; shift ;;
  esac
done
[ -n "$query" ] || die "a query is required"

if [ -n "$lens" ]; then
  [ -n "${LENS_API_KEY:-}" ] || missing_key LENS_API_KEY "https://www.lens.org/lens/user/subscriptions (free non-commercial tier)" "patents.sh without --lens (Google Patents)"
  q="$query"; [ -n "$assignee" ] && q="$q AND applicant.name:($assignee)"
  body=$(jq -n --arg q "$q" --argjson n "$limit" '{query: $q, size: $n, include: ["lens_id","biblio","abstract"]}')
  http_post https://api.lens.org/patent/search "$body" -H "authorization: Bearer $LENS_API_KEY" | jq '[.data[] | {
    id: .lens_id, title: (.biblio.invention_title[0].text // null), url: ("https://www.lens.org/lens/patent/" + .lens_id),
    assignee: ([.biblio.parties.applicants[]?.extracted_name.value] | join("; ")),
    inventor: ([.biblio.parties.inventors[]?.extracted_name.value] | join("; ")),
    priority_date: (.biblio.priority_claims.earliest_claim.date // null), filing_date: (.biblio.application_reference.date // null),
    publication_date: (.biblio.publication_reference.date // null), grant_date: null, snippet: (.abstract[0].text // null)}]'
  exit 0
fi

inner="q=$(urlenc "$query")&num=$limit"
[ -n "$assignee" ] && inner="$inner&assignee=$(urlenc "$assignee")"
[ -n "$after" ] && inner="$inner&after=priority:$(echo "$after" | tr -d -)"
LA_UA="Mozilla/5.0 (compatible; learning-agent/1.1)" http_get "https://patents.google.com/xhr/query?url=$(urlenc "$inner")&exp=" -H "accept: application/json" \
  | jq --argjson n "$limit" '
      def clean: if . == null then null else gsub("<[^>]+>"; "") | gsub("&hellip;"; "…") | gsub("&amp;"; "&") | gsub("\\s+"; " ") | ltrimstr(" ") | rtrimstr(" ") end;
      [.results.cluster[0].result[]? | .patent as $p | {
        id: (.id | sub("^patent/"; "") | sub("/en$"; "")), title: ($p.title | clean),
        url: ("https://patents.google.com/" + .id), assignee: ($p.assignee | clean), inventor: ($p.inventor | clean),
        priority_date: $p.priority_date, filing_date: $p.filing_date, publication_date: $p.publication_date, grant_date: $p.grant_date,
        snippet: ($p.snippet | clean)}] | .[:$n]'
