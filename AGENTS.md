# AGENTS.md

Guidance for agents and contributors working in this repository.
For the *why* behind the tool — the pedagogy and guiding principles — see the
[Philosophy section of the README](./README.md#philosophy).

## What this is

A single learning agent that teaches through questions, problems, and active
recall instead of lecturing, and that verifies every non-trivial claim against a
persistent, citable knowledge base before stating it. It is shipped to **two
platforms from one repository**: [opencode](https://opencode.ai) and
[Claude Code](https://docs.anthropic.com/en/docs/claude-code).

## Architecture

Three cooperating parts plus a slash command:

- **Agent (`learning`, primary)** — the system prompt that runs the session:
  probe → teach in layers → comprehension check → recall → apply → challenge →
  synthesise.
- **`learning-assessment` (gate skill, not user-invocable)** — before any claim,
  checks whether it is backed by verified, cited research. A single failed check
  forces research. Enforces the iron law: *no claim without a source*.
- **`learning-research` (skill, not user-invocable)** — a retrieval playbook:
  a provider routing table (material type × domain → exact tool call), bundled
  helper scripts for 20+ free search APIs, rules for reading each material type
  in full, an adjacent-material step, and the knowledge-base schema (evidence
  tiers, market-research layout).
- **`learning-researcher` (subagent, not for direct use)** — a one-angle
  research worker. For a fresh concept the research skill launches three of
  them in **one message** (technical, expert, contested — or market-research
  sub-questions); each runs the routing table for its angle, reads its sources
  in full, and writes `<topic>/.research/<concept>-<angle>.md` plus a
  per-angle sources fragment. The Learning agent then **merges**: dedupe by
  normalised URL, highest tier wins, disagreements between angles go to
  *Contested*. `scripts/fanout.sh` runs several helper scripts concurrently
  with per-host staggering for the rate-limited providers.
- **`learn` (slash command, Claude Code only)** — forks a learning session on a
  given topic.
- **`research` (slash command, Claude Code only)** — forks the same agent in
  **research mode**: gauge (hypothesis + evidence, never skipped) → read
  venture context and the existing KB → plan sub-questions against the
  routing table → research → store one entity per file → brief → challenge
  (Jadal) → next questions. The brief is sent to the user and written to
  `<kb-root>/<topic-slug>/brief-<YYYY-MM-DD>.md`. The mode is defined in the
  agent prompt ("Research Mode" section); the agent also enters it from a
  plain session when the request reads as a research question.

Runtime flow: **assessment gate → research if it fails (fan out three angles →
merge) → teach with `[source: filename.md]` citations** (research mode: the
same gate and fan-out, then a cited brief instead of a lesson).

## Repository layout

```
.
├── AGENTS.md                         # this file
├── CLAUDE.md                         # symlink → AGENTS.md
├── README.md                         # user-facing: install, usage, philosophy
├── package.json                      # npm/opencode entry (main → opencode plugin)
│
├── .claude-plugin/
│   └── marketplace.json              # Claude Code marketplace manifest → ./claude
│
├── claude/                           # ── CLAUDE CODE plugin ──
│   ├── .claude-plugin/plugin.json
│   ├── agents/
│   │   ├── learning.md               # agent prompt (Claude flavour)
│   │   └── learning-researcher.md    # one-angle research subagent (tools restricted, skill preloaded)
│   └── skills/
│       ├── learn/SKILL.md            # slash command (Claude only)
│       ├── research/SKILL.md         # /research <question> slash command (Claude only)
│       ├── learning-assessment/SKILL.md
│       └── learning-research/
│           ├── SKILL.md
│           └── scripts/              # provider helper scripts (bash + curl + jq/python3)
│               ├── _lib.sh           # shared: http retries, JSON helpers, mktemp, exit codes
│               ├── fanout.sh         # run N script calls concurrently, per-host cap + stagger
│               ├── arxiv.sh, s2.sh, openalex.sh, pubmed.sh, crossref.sh      # papers
│               ├── wikimedia-images.sh, openverse.sh                          # images
│               ├── yt-search.sh, yt-transcript.sh                             # video
│               ├── edgar.sh, companies-house.sh, hn.sh, reddit.sh,            # market research
│               │   worldbank.sh, fred.sh, ons.sh, wayback.sh, news.sh, patents.sh, github.sh
│               ├── exa.sh, websearch.sh                                       # keyed web search
│               └── fetch-readable.sh                                          # URL → readable text
│
├── .opencode/
│   └── plugins/learning-agent.js     # registers the opencode agents (learning, learning-researcher, researcher), the /research command + skills
├── opencode/                         # ── OPENCODE plugin assets ──
│   ├── agents/
│   │   ├── learning.md               # agent prompt (opencode flavour)
│   │   └── learning-researcher.md    # derived from the Claude copy (scripts/sync-opencode.sh)
│   └── skills/
│       ├── learning-assessment/SKILL.md
│       └── learning-research/
│           ├── SKILL.md
│           └── scripts → ../../../claude/skills/learning-research/scripts   # relative symlink
│
├── scripts/trace-summary.mjs         # prints a session trace as a timeline (npm run trace)
├── scripts/sync-opencode.sh          # regenerates the derived opencode copies (npm run sync:opencode)
├── tests/                            # see tests/README.md
│   ├── lint/                         # deterministic checks, no model (npm test)
│   ├── lib/                          # shared helpers: frontmatter, yaml subset, repo paths
│   └── scenarios/                    # model-driven scenario tests (npm run test:scenarios)
│       ├── run.mjs                   # runner: claude -p, turn by turn
│       ├── lib/                      # driver, assertions, judge, kb parsing, report
│       └── <domain>/<name>.yaml      # one fixture per scenario
└── .github/workflows/test.yml        # lint on PRs; scenarios nightly / on demand
```

## Dual-platform structure — keep both trees in sync (IMPORTANT)

The agent prompt and the two shared skills exist as **near-duplicate copies** in
`claude/` and `opencode/`. When you change one, you must mirror the change in the
other. The **only intended differences** between the copies are:

1. **Knowledge-base path:**
   - Claude Code → `~/.claude/learning/<topic-slug>/`
   - opencode    → `~/.config/opencode/learning/<topic-slug>/`
2. **Frontmatter format:**
   - Claude agent (`claude/agents/learning.md`): `name`, `description`, `skills:`
   - opencode agent (`opencode/agents/learning.md`): `description`, `mode`,
     `color` — skills are registered programmatically by
     `.opencode/plugins/learning-agent.js`, not via frontmatter.
   - Claude researcher (`claude/agents/learning-researcher.md`): `name`,
     `description`, `tools` (Bash, Read, Write, WebSearch, WebFetch, the Exa
     and context7 MCP patterns — no Agent, no Edit) and `skills:` preloading
     `learning-research`; opencode researcher: `description`,
     `mode: subagent`, `color`, with the tool restriction applied by the
     plugin JS (`permission: { task: "deny" }`) and the skill loaded through
     opencode's `skill` tool (the prompt says so).
   - Claude skills carry `user-invocable: false` (and `learning-research` also
     `allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/*)` so its scripts run
     without permission prompts); opencode skills carry neither, because
     opencode only accepts `name`, `description`, `license`, `compatibility`,
     `metadata`.
3. **Script paths in `learning-research/SKILL.md`:**
   - Claude Code → `${CLAUDE_SKILL_DIR}/scripts/<name>.sh`
   - opencode    → `scripts/<name>.sh`
   (see [Bundled scripts and path resolution](#bundled-scripts-and-path-resolution)).
4. **How the parallel research fan-out is launched** (the prompt text is
   identical; the platform mechanism differs):
   - Claude Code → the `Agent` tool with
     `subagent_type: "learning-agent:learning-researcher"` (plugin agents are
     addressed as `<plugin>:<agent>`); three calls in one assistant message
     run **concurrently** (verified with `claude -p --output-format
     stream-json`: subagent events carry `parent_tool_use_id`, and two
     8-second subagents launched from one message overlapped).
   - opencode → the `task` tool with `subagent_type: "learning-researcher"`,
     registered by the plugin JS with `mode: subagent`. opencode's task tool
     starts each call as its own background job, so three calls in one message
     also run concurrently, but that is opencode's behaviour, not something
     this plugin controls; the skill's **multi-call fan-out** (all searches as
     parallel tool calls in one message, scripts bundled through `fanout.sh`)
     is the documented fallback on either platform when no subagent tool is
     available, and is what a researcher uses inside its own angle.

5. **Research mode entry point:**
   - Claude Code → `claude/skills/research/SKILL.md`, a user-invocable
     slash command (`/research <question>`, `context: fork`,
     `agent: learning`) whose body tells the agent to enter research mode.
   - opencode → no command file. `.opencode/plugins/learning-agent.js`
     registers a second primary agent, **`researcher`**, whose prompt is the
     learning prompt (`opencode/agents/learning.md`) with a short `# Mode`
     preamble prepended, plus a **`/research`** command (`config.command`)
     that runs on it with the same template text as the Claude skill. Chosen
     over a `research:` prefix because opencode's config hook accepts
     `agent` and `command` maps directly, so users get Tab-selectable
     `researcher` and `/research <question>` with nothing to remember. The
     rules of the mode live only in the prompt file; the preamble and the
     command template are mode lines, and the lint checks the researcher
     prompt ends with the learning prompt verbatim.

The `learn` and `research` slash commands live **only** under `claude/`
(opencode registers `/research` in code, see above). Everything else should
match. Three opencode files are derived mechanically from their Claude copies
by `scripts/sync-opencode.sh` (`npm run sync:opencode`): the research skill,
the researcher subagent, and the main agent prompt `opencode/agents/learning.md`
(opencode frontmatter kept, Claude body with the KB path swapped):

```bash
# opencode/skills/learning-research/SKILL.md
sed -e '/^user-invocable: false$/d' -e '/^allowed-tools: /d' \
    -e 's#~/.claude/learning/#~/.config/opencode/learning/#g' \
    -e 's#\${CLAUDE_SKILL_DIR}/scripts#scripts#g' \
    claude/skills/learning-research/SKILL.md > opencode/skills/learning-research/SKILL.md
# opencode/agents/learning-researcher.md: description / mode: subagent / color
# frontmatter, then the Claude body with the KB path swapped (see the script).
# opencode/agents/learning.md: its own frontmatter kept, the Claude body with
# the KB path swapped.
```

Edit the Claude copy, run the sync script, and commit both. `npm test` (the
parity lint) applies the same normalisation and fails on any other drift.

## Bundled scripts and path resolution

`learning-research` ships helper scripts in `claude/skills/learning-research/scripts/`.
`opencode/skills/learning-research/scripts` is a **relative symlink** to that
directory (the same trick as `CLAUDE.md → AGENTS.md`), so there is one copy to
maintain and both plugin trees see it.

How each platform lets `SKILL.md` refer to those scripts:

- **Claude Code** substitutes `${CLAUDE_SKILL_DIR}` (the directory containing
  the skill's `SKILL.md` — for a plugin skill that is the skill's subdirectory
  inside the installed plugin, not the plugin root) in the skill's markdown
  body and in `allowed-tools` Bash rules. `${CLAUDE_PLUGIN_ROOT}` (the plugin's
  install directory) is also substituted in plugin skills. So
  `${CLAUDE_SKILL_DIR}/scripts/arxiv.sh` resolves wherever the marketplace
  installs the plugin, and the matching `allowed-tools: Bash(${CLAUDE_SKILL_DIR}/scripts/*)`
  rule pre-approves running them. Docs: https://code.claude.com/docs/en/skills
- **opencode** does no substitution. When the model loads a skill, the `skill`
  tool returns the body followed by `Base directory for this skill: <path>` and
  the note that relative paths such as `scripts/` resolve against it, plus a
  sampled file list. The opencode copy therefore uses plain `scripts/<name>.sh`
  paths. opencode discovers the skill through `config.skills.paths`, which
  `.opencode/plugins/learning-agent.js` points at `opencode/skills/`.

Script conventions (enforce them in any new script):

- `#!/usr/bin/env bash`, source `_lib.sh`, bash 3.2 compatible (macOS
  `/bin/bash`): no associative arrays, no `mapfile`, no `${var,,}`.
- Dependencies: `curl`, `jq`, `python3` stdlib only (`yt-dlp` for the two
  video scripts, `pdftotext`/`pypdf` optional for PDFs). Nothing to install.
- `--help` on stdout (exit 0); JSON on stdout; errors on stderr; exit `1` on
  failure, `2` when a required API key is unset — and the exit-2 message must
  name the keyless fallback. Zero keys must still work end to end.
- Temp files only via `mktemp` under `$LA_TMP` (cleaned on exit), so scripts
  can be run concurrently by a parallel research step. `fanout.sh` is that
  step's runner: it takes one command per argument (or per stdin line), runs
  them concurrently with a per-host cap (default 1) and a per-host minimum
  gap (arXiv 3 s, GDELT 5 s, Reddit 2 s, Wayback 1 s, Semantic Scholar 1 s,
  SEC 0.1 s), and prints one JSON object per command. A new rate-limited
  provider needs a row in its `HOSTS` table.
- Test against the live API before committing; paste a real output line in
  the PR.

When bumping the version, update it in all three manifests:
`package.json`, `claude/.claude-plugin/plugin.json`, and
`.claude-plugin/marketplace.json`.

## Knowledge-base conventions

- One folder per topic, with a **stable slug** reused across sessions
  (e.g. `rust-ownership-model`). Don't invent a new slug each time.
- `sources.md` holds a table of every fetched source with columns
  `URL | Title | Type | Domain | Tier | Published | Accessed | Related-to | Summary`.
  `Type` is the material kind (paper, article, first-party, video, image,
  course, repo, filing, dataset, news, forum, patent, report); `Tier` is the
  evidence tier 1–5 (market research: filing > first-party announcement >
  reputable press > analyst summary > forum); `Related-to` links a neighbour
  found by the adjacent-material step to its primary source.
- One `<concept-slug>.md` file per concept. Market-research topics add
  `companies/<company-slug>.md`, `market-size.md`, `customers.md`,
  `timeline.md`; learning topics may add `courses.md`.
- Research mode writes its brief to `brief-<YYYY-MM-DD>.md` in the topic
  folder (one per day, accumulating across sessions; a returning session reads
  the latest first and opens with what changed). Sections, in order: Question ·
  Hypothesis (the user's, verbatim) · Findings (cited, tiered) · Numbers
  (`Value | What | Date | Source file | Tier`, Tier 1–2 only) · Contested /
  Unknown (never empty; the only place a Tier 3+ number may appear, flagged
  "unverified") · Counter-case · Next questions.
- Inline citation format is `[source: filename.md]`, or
  `[source: companies/<slug>.md]` for an entity file.
- One concept (or entity) per file; split files that exceed ~200 lines.
- On returning to an existing topic, **read what's there before researching** —
  only fill gaps, don't re-research.
- **Research fragments** — `<topic-slug>/.research/<concept-slug>-<angle>.md`
  and `.research/sources-<angle>.md` are what the parallel researchers wrote
  before the merge. They are kept as the audit trail, never cited, and never
  concept files (`loadKb` exposes them as `kb.fragments`). Merge rules
  (normalised-URL dedupe, highest tier wins, disagreements to *Contested*,
  a neighbour found twice stored once) are in the research skill under
  "Merging angle fragments".
- **Learner memory** lives beside the research: `<kb-root>/learner.md` (one
  global profile: background, goals, explanation styles, strengths,
  misconceptions, pace, topics studied, venture context) and
  `<kb-root>/<topic-slug>/progress.md` (concepts covered with verdicts, open
  gaps, last session, next step). Both are plain markdown the learner may edit
  or delete. Entries are short, dated and factual — never inferred traits. The
  agent reads them at session open and writes them after each synthesis
  checkpoint and at session end. Memory targets the opening gauging question;
  it never replaces it. Templates are in the agent prompt.

## Editing conventions

- The two shared skills are **`user-invocable: false`** — they are invoked by the
  agent, not directly by users. Keep them that way.
- Skill and agent definitions are markdown with YAML frontmatter; the opencode
  plugin parses frontmatter itself (see `parseFrontmatter` in the plugin JS), so
  keep frontmatter simple (`key: value`, no nested YAML).
- Prefer editing the prompt/skill content in plain prose; this *is* the product.

## Testing

Full details in [tests/README.md](./tests/README.md). The short version:

- **`npm test`** — deterministic lint, no model calls, runs in seconds. Fails
  on: invalid frontmatter, any claude/opencode drift beyond the allowed
  differences above, mismatched manifest versions, a shared skill that is not
  `user-invocable: false`, a `[source: ...]` example in the wrong format, any
  wording that permits skipping the probing question, a missing trace event in
  either tree, a researcher subagent missing from either tree or registered
  wrongly, a broken `fanout.sh`, a research-mode section that lost its
  template or evidence rules, or a broken scenario fixture. Run it before
  every commit that touches a prompt or skill. CI runs it on every PR.
- **`npm run test:scenarios`** — drives the real agent (`claude -p`) through
  scripted learner sessions and checks the transcript, the knowledge base and
  the trace: gate before the first claim, citations resolve to real files,
  `sources.md` rows rated and dated, probing question first, no lecturing
  streaks, wrong answers corrected rather than advanced, plus medicine,
  market-research and research-mode extras (`mode: research` fixtures:
  gauging question first, Numbers rows Tier 1–2 and resolvable, Contested /
  Unknown populated, brief written). Costs tokens; runs nightly and on demand in CI,
  gated on the `ANTHROPIC_API_KEY` secret. Reports land in
  `tests/scenarios/.runs/<stamp>/` (git-ignored).
- **Adding a scenario** = adding one YAML file at
  `tests/scenarios/<domain>/<name>.yaml` with a topic, a learner persona,
  scripted turns (mark one `expect: correction`) and any extra assertions;
  a `seed:` map pre-writes `learner.md` / `<slug>/progress.md` for a
  returning-learner scenario. Nothing else changes.
  `npm run test:scenarios -- --dry-run` validates it.
- **Reading a trace** — every session writes
  `<kb-root>/.traces/<topic-slug>/<timestamp>.jsonl`, one `{ts, event, data}`
  per line (`session.start`, `memory.read`, `phase`, `gate.check`,
  `research.fanout`, `research.query`, `research.fetch`, `kb.write`, `teach`,
  `check.ask`, `check.verdict`, `memory.write`, `brief.write`, `session.end`;
  research mode uses the phases `gauge`, `plan`, `research`, `merge`, `brief`,
  `challenge`). `npm run trace` prints the latest one as a timeline; a `teach`
  with no preceding `gate.check`, or a `check.verdict` of `wrong -> advance`,
  is a regression, and so are `research.query` events spread over many
  assistant turns for a fresh topic (the `research_rounds_max` assertion counts
  them). Set `LEARNING_KB_ROOT` to point the agent (and its traces) at a
  different root; the test harness does this.
- When you add a trace event or change the `sources.md` layout, update **both**
  agent prompts / skills and the tables in `tests/README.md`; the lint checks
  the trees agree.

## Install / distribution (reference)

- **opencode:** `opencode plugin learning-agent@git+https://github.com/luqs1/learning-agent.git -g`
- **Claude Code:** `/plugin marketplace add luqs1/learning-agent` then
  `/plugin install learning-agent@learning-agent`

## Naming (in flux)

The project currently ships as **`learning-agent`** (agent name: `learning`).
The brand name is being revisited — see issue #3 — so a rename is likely later.
Until that lands, `learning-agent` / `learning` remain the canonical identifiers
in all code, manifests, and install commands. Do not partially rename.
