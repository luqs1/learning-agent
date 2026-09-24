---
name: learning-research
description: Use when the Learning agent needs to gather verified knowledge on a topic before teaching it
user-invocable: false
allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/*)
---

# Learning Research

## Overview

Before teaching, gather. Before claiming, verify. Before citing, store.

This skill is a **retrieval playbook**: it tells you which provider to call for
each kind of material, how to read what comes back (all of it, not the snippet),
how to find the material adjacent to it, and how to store it so the Learning
agent can cite it for the rest of this session and in future sessions.

It serves two jobs with the same discipline:

- **Learning** — papers, docs, practitioner writing, lectures, diagrams, courses.
- **Market research** — company filings, funding, competitor products, customer
  sentiment, market-size data, news, patents, trends. Primary source or nothing.

## Knowledge Base Location

All research is stored at: `~/.claude/learning/<topic-slug>/`

**Deriving the topic slug:**
- Use the conversation topic, lowercased, spaces replaced with hyphens
- Keep it stable across sessions (don't invent a new slug each time)
- Examples: `makemore-neural-networks`, `linux-networking`, `rust-ownership-model`, `uk-open-banking-market`

## Tracing

This skill appends events to the session trace file the Learning agent created at session start (`~/.claude/learning/.traces/<topic-slug>/<session-timestamp>.jsonl`, or under `$LEARNING_KB_ROOT` when that variable is set). Each event is one Bash command of the form `echo '{"ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","event":"<name>","data":{...}}' >> <trace-file>`, using the literal trace-file path. Emit:

- `research.query` after every search: `{"provider":"<provider>","query":"<query>","material_type":"<docs|paper|blog|talk|dataset|news|other>"}`. `provider` is the real thing you called: the script name (`arxiv.sh`, `s2.sh`, `hn.sh`, `edgar.sh`, ...) or the tool name (`WebSearch`, `mcp__exa__web_search_exa`, `mcp__exa__web_search_advanced_exa`, `mcp__plugin_context7_context7__query-docs`) — never a generic label. Map the `Type` column to `material_type`: paper→`paper`, docs→`docs`, article/first-party→`blog`, video/course→`talk`, dataset/filing→`dataset`, news→`news`, anything else→`other`.
- `research.fetch` after every fetch: `{"url":"<url>","ok":true}` (or `false` if the fetch failed or returned nothing useful). A fetch is any read of a source: `fetch-readable.sh`, `yt-transcript.sh`, `WebFetch`, `mcp__exa__web_fetch_exa`, a `curl` of a PDF/image you then `Read`, a clone.
- `kb.write` after every file you create or update in the topic folder: `{"file":"<concept-slug>.md"}` (also for `sources.md`, and for entity files as `companies/<slug>.md`)

Keep values under 200 characters, use only double quotes inside the JSON, never put a single quote in a value. Several events may be chained in one command with `&&`. Do not mention tracing to the user.

## Helper scripts

The provider table below calls scripts bundled with this skill. Paths are
written as `${CLAUDE_SKILL_DIR}/scripts/<name>.sh`: in Claude Code the
`${CLAUDE_SKILL_DIR}` prefix is substituted with the skill's absolute
directory; in opencode the `skill` tool prints `Base directory for this skill:
<path>` when it loads the skill, and the relative `scripts/` path resolves
against that. They are bash + curl + jq + python3 (stdlib), nothing else.
Every script:

- prints usage with `--help` — **read it before the first call**; it names the
  endpoint, the filters, the output fields and the honest limits
- prints JSON on stdout (except `fetch-readable.sh` and `yt-transcript.sh`,
  which print the text you are meant to read)
- exits `1` with a message on stderr on failure, and `2` when a provider needs
  an API key that is not set — the stderr message names the keyless fallback
- is safe to run several at once (no shared temp files)

Free, keyless providers are the **default path**. Keyed providers are used
only when their environment variable is set; nothing in this skill requires a
key. Which keys unlock what:

| Env var | Unlocks | Without it |
|---|---|---|
| `EXA_API_KEY` | `exa.sh` search / **findSimilar** / contents | built-in `WebSearch`; `s2.sh recommend` / `openalex.sh related` for similar |
| `BRAVE_API_KEY`, `TAVILY_API_KEY` | `websearch.sh` (shell web search) | built-in `WebSearch` tool |
| `S2_API_KEY` | dedicated Semantic Scholar quota | shared pool; script retries on 429 |
| `YOUTUBE_API_KEY` | YouTube Data API in `yt-search.sh` | yt-dlp `ytsearch` (keyless) |
| `COMPANIES_HOUSE_API_KEY` | officers, PSC, filing JSON | public pages scraped for search/profile; filing page via `fetch-readable.sh` |
| `FRED_API_KEY` | `fred.sh search`/`info`, unit transforms | `fred.sh series` via public CSV |
| `LENS_API_KEY` | `patents.sh --lens` | Google Patents (keyless) |
| `GITHUB_TOKEN` | code search, higher rate limit | repo search + README keyless |
| `NCBI_API_KEY`, `OPENALEX_MAILTO`, `CROSSREF_MAILTO`, `EDGAR_USER_AGENT` | higher rate limits / polite pools | works, slower; SEC gets a placeholder UA |

Tools that may also be in your tool list (use them when present; none is required):
built-in `WebSearch` and `WebFetch` (always present in Claude Code);
`mcp__exa__web_search_exa`, `mcp__exa__web_search_advanced_exa` (filters:
`category`, `includeDomains`, `startPublishedDate`), `mcp__exa__web_fetch_exa`
(Exa MCP server — note it does **not** expose findSimilar; `exa.sh similar`
does); `mcp__plugin_context7_context7__resolve-library-id` + `query-docs`
(official library docs).

## Phase 1: Setup

1. Derive the topic slug from the current conversation
2. Check if `~/.claude/learning/<topic-slug>/` exists
3. If not, create it: `mkdir -p ~/.claude/learning/<topic-slug>/`
4. Check if `sources.md` exists — if so, read it to understand what has already been researched
5. If not, create it with the header:
   ```markdown
   # Sources: <Topic Name>

   | URL | Title | Type | Domain | Tier | Published | Accessed | Related-to | Summary |
   |-----|-------|------|--------|------|-----------|----------|------------|---------|
   ```

Column values:
- **Type**: `paper` | `article` | `docs` | `first-party` | `video` | `image` | `course` | `repo` | `filing` | `dataset` | `news` | `forum` | `patent` | `report`
- **Domain**: the field the source belongs to, lowercase: `cs`, `ml`, `medicine`, `economics`, `law`, `history`, ... or for market research the market: `uk-fintech`, `dev-tools`, ...
- **Tier**: evidence tier 1–5 (see [Evidence tiers](#evidence-tiers)). Tier 1–2 is what the old "High" credibility meant; 3 = Medium; 4–5 = Low.
- **Published**: the source's own date (filing date, upload date, article date); `unknown` if there is none — undated content is at most Tier 4
- **Related-to**: empty for a primary source; for a neighbour found in Phase 5, the URL (or filename) of the primary source it was found from

## Phase 2: Choose the provider — routing table

Pick the row for the **material** you need, then the column for the domain.
Call the first provider; if it returns nothing useful, move right. `S` is
`${CLAUDE_SKILL_DIR}/scripts`. Every `*.sh` call has a `--help`.

### Learning material

| Material | Domain | First call | Then | Read it with |
|---|---|---|---|---|
| Papers | CS / ML | `${CLAUDE_SKILL_DIR}/scripts/arxiv.sh "<title or topic>" --max 5` (use `ti:"..."`, `au:`, `cat:cs.LG` for precision) | `${CLAUDE_SKILL_DIR}/scripts/s2.sh search "<topic>" --limit 5 --open-access` (citation counts, PDF links); `${CLAUDE_SKILL_DIR}/scripts/openalex.sh search "<topic>" --oa` | download `pdf_url`, then `Read` with `pages`; or `fetch-readable.sh <pdf_url>` |
| Papers | Medicine / biology | `${CLAUDE_SKILL_DIR}/scripts/pubmed.sh search '<topic> AND (systematic review[pt] OR meta-analysis[pt] OR randomized controlled trial[pt])' --max 8` | `openalex.sh search --type article`; `crossref.sh search` | `pubmed.sh abstract <pmid>` for the abstract; full text at the `pmc_url` PDF, then `Read` with `pages` |
| Papers | Any other field | `${CLAUDE_SKILL_DIR}/scripts/openalex.sh search "<topic>" --limit 8` | `${CLAUDE_SKILL_DIR}/scripts/crossref.sh search "<topic>" --type journal-article`; `s2.sh search` | `oa_url` / `pdf_url` → `Read` with `pages` |
| Paper by identifier | any | `s2.sh paper arXiv:<id>` / `s2.sh paper DOI:<doi>` (abstract, TL;DR, citation count) | `crossref.sh doi <doi>`; `openalex.sh work <doi>` | as above |
| Articles / blogs / talks write-ups | any | built-in `WebSearch` (`"<concept>" site:<expert's domain>`, `"<concept>" "what actually matters"`) | `mcp__exa__web_search_exa` if present (describe the ideal page: "a practitioner's blog post explaining X from experience"); `${CLAUDE_SKILL_DIR}/scripts/websearch.sh` if Brave/Tavily keys are set | `${CLAUDE_SKILL_DIR}/scripts/fetch-readable.sh <url> --out <file>` then `Read` the file; `WebFetch` or `mcp__exa__web_fetch_exa` for JS-rendered pages |
| Official docs | software | context7 (`mcp__plugin_context7_context7__resolve-library-id` → `query-docs`) if present | `WebSearch "<library> docs <feature>"` restricted to the project's domain | `fetch-readable.sh`; for a repo's docs folder, clone it (see Phase 4) |
| First-party evidence (the author's own words) | any | `WebSearch "<name>" site:<their domain>`; `${CLAUDE_SKILL_DIR}/scripts/github.sh repos "user:<handle>"` / `github.sh readme <owner/repo>` | `${CLAUDE_SKILL_DIR}/scripts/yt-search.sh "<name> <topic>" --channel "<name>"` (their own talks) | article → `fetch-readable.sh`; repo → clone; talk → `yt-transcript.sh` |
| Images / diagrams | any | `${CLAUDE_SKILL_DIR}/scripts/wikimedia-images.sh "<thing> diagram" --limit 8` | `${CLAUDE_SKILL_DIR}/scripts/openverse.sh "<thing>" --license by,by-sa,cc0` | `curl -sL <thumb_url> -o /tmp/<name>.png` then `Read` the file (you see the image); the paper's own figure via the PDF page |
| Videos / lectures | any | `${CLAUDE_SKILL_DIR}/scripts/yt-search.sh "<topic> lecture" --limit 8` | `yt-search.sh --channel "<university or expert>"`; `WebSearch "<topic>" site:youtube.com/playlist` | `${CLAUDE_SKILL_DIR}/scripts/yt-transcript.sh <id> --out <file>` then `Read` the whole file; `--timestamps` when you need to cite a moment |
| Courses | any | `WebSearch "<topic>" (site:ocw.mit.edu OR site:coursera.org OR site:edx.org OR site:fast.ai OR site:cs.stanford.edu)` | `mcp__exa__web_search_advanced_exa` with `query: "<topic> university course syllabus"`; `yt-search.sh "<topic> full course"` | `fetch-readable.sh` the syllabus page; store in `courses.md` (title, provider, level, url, what it covers, prerequisites) |
| Code / repos | software | `${CLAUDE_SKILL_DIR}/scripts/github.sh repos "<topic> stars:>200" --sort stars` | `github.sh readme <owner/repo>`; `WebSearch "<topic>" site:github.com` | `git clone --depth 1 <url> /tmp/<name>` then `Read` the files that matter |

Medicine: capture the **study type** (`pubtypes` in `pubmed.sh` output) and the
guideline body when one applies — NICE (`WebSearch site:nice.org.uk`), WHO,
Cochrane (`pubmed.sh search '<topic> AND cochrane[journal]'`), DailyMed for
drug labels (`fetch-readable.sh https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=<drug>`).

CS/ML: link the paper to its code (`github.sh repos "<paper title>"`) and
store both; cite the paper for the claim and the repo for the implementation.

### Market research material

| Material | Region | First call | Then | Read it with |
|---|---|---|---|---|
| Company facts (incorporation, officers, accounts) | UK | `${CLAUDE_SKILL_DIR}/scripts/companies-house.sh search "<name>"` → `companies-house.sh company <number>` → `companies-house.sh filings <number> --category accounts` | — | the filing PDF (`document_url`) via `Read`; keyless: the filing-history page via `fetch-readable.sh` |
| Company facts | US | `${CLAUDE_SKILL_DIR}/scripts/edgar.sh search '"<name>"' --limit 10` (any filer, incl. private companies via Form D) → `edgar.sh filings <ticker> --forms 10-K` → `edgar.sh facts <ticker> --concept <Tag>` | — | `fetch-readable.sh <url>` on the filing document (SEC needs `EDGAR_USER_AGENT`) |
| Company facts | elsewhere | `WebSearch "<name>" site:opencorporates.com` then `fetch-readable.sh` the company page | national register (`WebSearch "<country> company register <name>"`) | page text |
| Funding / investors | US | `edgar.sh search '"<name>"' --forms D` (Form D: amount sold, date, investor count) | company press release: `WebSearch "<name>" raised site:<their domain>`; `${CLAUDE_SKILL_DIR}/scripts/news.sh "<name> raises" --when 1y` | the Form D XML / the press release page |
| Funding / investors | UK | `companies-house.sh filings <number> --category capital` (SH01 share allotments = a round; confirmation statements list shareholders) | press release on the company's site; `news.sh`; YC directory `fetch-readable.sh "https://www.ycombinator.com/companies/<slug>"` | the SH01 PDF |
| Competitor product / pricing | any | `fetch-readable.sh https://<competitor>/pricing --out <file>` (also `/docs`, `/changelog`, `/customers`) | `${CLAUDE_SKILL_DIR}/scripts/wayback.sh list <competitor>/pricing --from 2022` → `fetch-readable.sh <raw_url>` for how it changed; `github.sh repo <owner/name>` for OSS competitors; app-store page via `fetch-readable.sh` | the page text; **record the date you fetched it next to every price** |
| Customer sentiment | any | `${CLAUDE_SKILL_DIR}/scripts/hn.sh "<product>" --comments --limit 30 --since <date>`; `hn.sh item <story id>` for a whole launch thread | `${CLAUDE_SKILL_DIR}/scripts/reddit.sh "<product> alternative" --subreddit <sub>` → `reddit.sh thread <url>`; G2/Capterra via `WebFetch` (bot-walled for curl) | quote verbatim with date and thread URL; note how many comments you read |
| Market size / macro data | UK | `${CLAUDE_SKILL_DIR}/scripts/ons.sh "<series>" --type dataset` → `fetch-readable.sh <url>` and download the CSV | `worldbank.sh indicator <CODE> --country GB` | the dataset page; store the **series id / dataset name and release date** |
| Market size / macro data | US / global | `${CLAUDE_SKILL_DIR}/scripts/worldbank.sh search "<keyword>"` → `worldbank.sh indicator <CODE> --country GB,US --mrv 5`; `${CLAUDE_SKILL_DIR}/scripts/fred.sh series <ID>` | Eurostat / OECD (`ons.sh --help` shows the URL patterns); Wikidata SPARQL for entity facts | JSON values; cite body + series id + year |
| Industry / analyst reports | any | `WebSearch "<market> market size" -site:statista.com` looking for the **underlying primary** (a regulator, statistical body, trade association's own data) | if only a press summary of a paid report exists, store it at Tier 4 and say so | `fetch-readable.sh`; never copy a number from a report's marketing page as fact |
| News / events | any | `${CLAUDE_SKILL_DIR}/scripts/news.sh "<company or market>" --when 1m` | `news.sh --gdelt` (direct URLs, rate-limited); `mcp__exa__web_search_advanced_exa` with `category: "news"` and `startPublishedDate` | `fetch-readable.sh` the outlet's own URL (Google News links are redirectors); store the publish date |
| Patents / IP | any | `${CLAUDE_SKILL_DIR}/scripts/patents.sh "<technology>" --assignee "<company>" --after 2020-01-01` | `patents.sh --lens` with `LENS_API_KEY` | `fetch-readable.sh https://patents.google.com/patent/<id>/en` |
| Trends | any | `hn.sh "<term>" --by-date --limit 50` and `reddit.sh "<term>" --sort new` and count by month | `mcp__exa__web_search_advanced_exa` with `startPublishedDate`/`endPublishedDate` windows | mark **directional only** in the summary; never turn forum counts into a market number |

Rules that apply to every market-research row:

- **Never cite a funding amount, revenue, user count or valuation without the
  filing or the company's own announcement.** Press coverage is a pointer to
  the primary, not the primary.
- **Store the date with every number.** Prices, headcounts and valuations are
  facts about a date.
- Crunchbase, PitchBook, Gartner and Statista numbers are Tier 4 at best (a
  press summary of a paid source). Find what they were computed from.

## Phase 3: Multi-Angle Research

For each concept that needs grounding, run **three angles**, each through the
routing table above:

### Angle 1: Technical Accuracy

Search for: the precise technical definition, mechanism, or process. Goal:
establish what is factually correct. Use the *Papers* / *Official docs* rows,
and the original paper or primary source if one exists.

### Angle 2: Expert Mindset and Prioritization

Search for: how practitioners in the field actually think about this topic.
Goal: understand what experts emphasize, what they deprioritize, what they
consider the key insight vs. a detail, and what debates exist.

This angle is NOT optional. Technical facts without practitioner perspective
produce textbook knowledge, not real understanding.

Use the *Articles*, *First-party evidence* and *Videos* rows:
- `WebSearch "<concept> what actually matters practitioners"`, `"<concept> common misconceptions"`
- `"<concept>" "<known expert name>"` (e.g. Andrej Karpathy, Yann LeCun, or whoever is authoritative in the domain) — then their own blog post or talk transcript, NOT a summary of it
- Look specifically for: "most people get X wrong about Y", "the key insight is", "don't waste time on", "I wish I'd known"

What to capture:
- What do experts spend their time on vs. what do beginners fixate on?
- What do experts consider the real bottleneck or core insight?
- What do they explicitly say is overrated or a distraction?
- What is their mental model — how do they think about the problem differently from a textbook?

### Angle 3: Contested and Uncertain Areas

Search for: where the field disagrees, where knowledge is evolving, or where
sources conflict. Goal: know what NOT to teach as settled fact.

- `WebSearch "<concept> debate" OR "<concept> controversy" OR "<concept> limitations"`
- `s2.sh citations <id>` — the papers citing a result often contain the rebuttals
- Compare multiple sources for disagreements

For market research the three angles are: **(1) what the primary documents
say** (filings, statistical series, the company's own pages), **(2) what
customers and practitioners say** (sentiment rows), **(3) where sources
disagree** (press number vs. filing number; analyst estimate vs. statistical
body). Record every disagreement.

## Phase 4: Reading, not skimming

A search result is a pointer. **You have not read a source until its content
is in your context.** How to consume each material type:

| Type | How to read it |
|---|---|
| PDF (paper, filing, report) | `curl -sL <pdf_url> -o /tmp/<slug>.pdf`, then `Read` the file with `pages` (e.g. `"1-8"`, then the sections you need, max 20 pages per call). For a text dump: `fetch-readable.sh <pdf_url> --out <file>` (needs `pdftotext` or `pypdf`; the script tells you if neither is installed). Read the abstract, the method, the results table and the limitations — not just the abstract. |
| Long article / docs page | `fetch-readable.sh <url> --out /tmp/<slug>.txt`, then `Read` the **whole** file. If it says "very little text extracted", the page is JS-rendered: use `WebFetch`, `mcp__exa__web_fetch_exa`, or `wayback.sh nearest <url>` → `fetch-readable.sh <raw_url>`. |
| Video / lecture | `yt-transcript.sh <id> --out /tmp/<slug>.txt`, then `Read` it in full. Use `--timestamps` to cite a moment as `<url>&t=<seconds>`. Auto-transcripts mis-hear names and numbers — verify those against a written source. |
| Image / diagram | `curl -sL <url> -o /tmp/<slug>.png` then `Read` the file: you see the image. Describe what it shows in the concept file; cite the file page (`page_url`) not the raw URL. Never describe a diagram you have not viewed. |
| Repository | `git clone --depth 1 <url> /tmp/<name>`; `Read` the README, then the files the claim depends on. Cite the file path and, when it matters, the commit (`git -C /tmp/<name> rev-parse --short HEAD`). |
| Dataset / statistical series | Read the JSON the script printed; open the dataset page for definitions, units and revisions. Store series id, unit, period and release date. |
| Forum thread | `hn.sh item <id>` / `reddit.sh thread <url>` and read the comments, not just the post. Note the count you read and the date range. |
| Filing | The document at `url` / `document_url`, in full for the sections you cite (Form D: items 7, 13, 15; 10-K: Item 1, 1A, 7; SH01: the allotment table). |

Rules:
- **Never cite a search snippet, an abstract-only view, a title, or a summary of
  a source.** If the fetch fails, say so and find another source.
- Extract exact quotes where they support key claims; keep them short and
  attributed.
- For every number you will teach, note where in the document it appears
  (page, section, table, timestamp).

## Phase 5: Adjacent material

After **each** primary source you store, run **one** similarity query and store
2–3 neighbours in `sources.md` with `Related-to` set to the primary's URL.
This is how the knowledge base grows edges, not just nodes: the follow-up
paper, the rebuttal, the competitor you had not heard of.

| Primary source type | Similarity query |
|---|---|
| Paper | `${CLAUDE_SKILL_DIR}/scripts/s2.sh recommend arXiv:<id> --limit 3` (or `DOI:<doi>`); if rate-limited, `${CLAUDE_SKILL_DIR}/scripts/openalex.sh related <doi or W-id> --limit 3`; for the follow-on literature `s2.sh citations <id> --limit 5` |
| Web page (article, product, company) | `${CLAUDE_SKILL_DIR}/scripts/exa.sh similar <url> --limit 3` when `EXA_API_KEY` is set; otherwise `mcp__exa__web_search_exa` with the page's title as the query, or `WebSearch "<title>"` / `"<product> alternatives"` |
| Video | `yt-search.sh "<title>"` (same channel and the responses to it) |
| Repo | `github.sh repos "<topic>" --sort stars` — the top 3 that are not the primary |
| Company | `edgar.sh search "<SIC or product term>" --forms D`; `companies-house.sh search "<product term>"`; `hn.sh "<product> alternative" --stories` |

Do not read neighbours in full unless the session needs them; store them with
the tier their metadata implies (a peer-reviewed paper `1`, a company page `2`,
a blog `3`, unknown `4`), `not yet read` at the start of the Summary cell, and
revise the tier when they are actually read. Never cite an unread neighbour.

## Phase 6: Store Research

For each concept researched, create or update `~/.claude/learning/<topic-slug>/<concept-slug>.md`:

```markdown
# [Concept Name]

**Last updated:** YYYY-MM-DD
**Sources used:** [list titles with links]

## Technical Facts

[Numbered facts. Each must be traceable to a specific source.]

1. [Fact]. [source: URL or title] (page, section or timestamp where it appears)
2. [Fact]. [source: URL or title] (page, section or timestamp where it appears)

## Expert Perspective

[How do practitioners in this field think about this concept?
What do they emphasize? What do they consider a common mistake?
What is the key insight that separates surface understanding from deep understanding?
Quote or paraphrase practitioners directly, with source.]

## Contested / Uncertain

[What do sources disagree on? What is still an open question?
What should NOT be taught as settled fact?]

## What NOT to Over-Emphasize

[What do experts say is commonly over-emphasized or a distraction?]

## Figures / media

[Diagrams viewed, videos read — file page URL, what each shows, timestamp if relevant]
```

Add each fetched source to `sources.md`:

```
| [URL] | [Title] | [Type] | [Domain] | [Tier] | [Published] | [Accessed] | [Related-to or empty] | [One-line summary] |
```

Cells must be parseable: `Tier` is exactly one digit `1`–`5`; `Published` and
`Accessed` are `YYYY-MM-DD` (`Published` may be `unknown`); `Type` is one word
from the list above; put any qualifier ("official docs", "accessed via
summary", "not yet read") in the Summary cell, never in the Tier cell.

### Evidence tiers

General (learning) material:

| Tier | Meaning | Examples |
|---|---|---|
| 1 | Primary, authoritative | peer-reviewed paper or its preprint, official documentation, a standard, a statistical body's dataset |
| 2 | First-party | the author's/maintainer's own blog, talk, repo, README; a company's own page about itself |
| 3 | Reputable secondary | well-known textbook, major educational resource, reputable press, a recognised practitioner writing about someone else's work |
| 4 | Weak secondary | analyst summary, aggregator, undated content, unknown author, a summary of a paywalled report |
| 5 | Forum / anecdote | HN, Reddit, reviews, social posts — quote verbatim, never generalise |

Market research hierarchy — **filing > first-party announcement > reputable
press > analyst summary > forum**:

| Tier | Market-research meaning | Examples |
|---|---|---|
| 1 | Filing / official statistic | SEC 10-K, S-1, Form D; Companies House accounts, SH01, confirmation statement; ONS / World Bank / FRED / Eurostat series; a granted patent |
| 2 | First-party announcement | the company's press release, pricing page, docs, changelog, founder's own post or talk; app-store listing |
| 3 | Reputable press | FT, Reuters, Bloomberg, Sifted, TechCrunch reporting *with* a named source or document |
| 4 | Analyst / aggregator summary | Crunchbase, PitchBook, Statista, Gartner press summaries, "market size" landing pages, LinkedIn headcounts |
| 5 | Forum | HN, Reddit, G2/Capterra reviews, X threads |

A teaching claim needs Tier 1–3. A market number needs Tier 1–2; if you only
have Tier 3–4, present it as "reported by X, unverified" and keep looking.

### Knowledge-base layout for market research

Under `~/.claude/learning/<topic-slug>/` — one entity per file, same citation
format as concept files:

```
sources.md                 every source, all columns above
companies/<company-slug>.md   one per company: registration number + register, incorporation date,
                              HQ, founders/officers (with filing date), funding rounds (date, amount,
                              instrument, source filing), product + pricing (with fetch dates),
                              headcount signals, what customers say (quotes), patents
market-size.md             every number with: series id / dataset, unit, period, body, release date,
                           and the arithmetic if you derived it (top-down vs bottom-up, stated)
customers.md               segments, jobs-to-be-done, verbatim quotes with thread URL + date,
                           sample size you actually read
timeline.md                dated events (funding, launches, pricing changes, regulation, exits),
                           one line each, each with a Tier 1–3 source
courses.md                 (learning topics) courses found, with level and prerequisites
```

Keep concept and entity files focused. Split any file that exceeds ~200 lines
(e.g. `companies/<slug>-funding.md`).

## Phase 7: Return Summary

After storing, produce a brief internal summary:

```
Research complete for: [concept]
Files created/updated: [list]
Providers used: [list, with keyless/keyed noted]
Key verified facts: [bullet list, each with tier]
Key expert perspectives gathered: [bullet list]
Adjacent material stored: [count, and anything worth following up]
Uncertain areas flagged: [bullet list]
Ready to teach with citations.
```

Then return to the Learning agent's teaching flow.

## Returning to an Existing Knowledge Base

If a topic folder already exists with research from a prior session:

1. Read `sources.md` and all existing concept / entity files
2. Assess whether the existing research covers what is needed now
3. If yes, skip research for those concepts — cite the existing files
4. If no, run only the phases needed to fill the gaps
5. Do NOT re-research what is already stored and still accurate. Do re-fetch
   anything time-sensitive (prices, headcounts, "latest" versions) older than
   30 days and update the `Accessed` and `Published` columns.

## Important Rules

- NEVER skip Phase 3 Angle 2 (expert mindset). Technical facts without practitioner perspective produce textbook knowledge, not real understanding.
- NEVER summarize a source without fetching and reading it. Search snippets, abstracts and titles are not sources.
- NEVER store a claim without a URL or direct reference, a date, and a tier.
- NEVER cite a market number (funding, revenue, users, valuation, market size) above Tier 2 without saying so.
- ALWAYS run `--help` on a script before its first use in a session, and pass the script's stderr message on to the user when a provider is unavailable.
- Prefer the keyless path; never ask the user for an API key mid-session — degrade and continue.
- If a source contradicts training knowledge, trust the source.
- If sources contradict each other, record both views in the Contested section.
- Keep concept files focused. One concept per file. Split if a file exceeds ~200 lines.
