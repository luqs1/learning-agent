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
- **`learning-research` (skill, not user-invocable)** — multi-angle research
  (technical accuracy, expert perspective, contested areas), fetches primary
  sources, and stores them as a structured, citable knowledge base.
- **`learn` (slash command, Claude Code only)** — forks a learning session on a
  given topic.

Runtime flow: **assessment gate → research if it fails → teach with
`[source: filename.md]` citations.**

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
│   ├── agents/learning.md            # agent prompt (Claude flavour)
│   └── skills/
│       ├── learn/SKILL.md            # slash command (Claude only)
│       ├── learning-assessment/SKILL.md
│       └── learning-research/SKILL.md
│
├── .opencode/
│   └── plugins/learning-agent.js     # registers the opencode agent + skills at runtime
├── opencode/                         # ── OPENCODE plugin assets ──
│   ├── agents/learning.md            # agent prompt (opencode flavour)
│   └── skills/
│       ├── learning-assessment/SKILL.md
│       └── learning-research/SKILL.md
│
├── scripts/trace-summary.mjs         # prints a session trace as a timeline (npm run trace)
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

The `learn` slash command lives **only** under `claude/` (opencode has no
slash-command equivalent here). Everything else should match.

When bumping the version, update it in all three manifests:
`package.json`, `claude/.claude-plugin/plugin.json`, and
`.claude-plugin/marketplace.json`.

## Knowledge-base conventions

- One folder per topic, with a **stable slug** reused across sessions
  (e.g. `rust-ownership-model`). Don't invent a new slug each time.
- `sources.md` holds a table of every fetched source with a credibility rating;
  one `<concept-slug>.md` file per concept.
- Inline citation format is `[source: filename.md]`.
- One concept per file; split files that exceed ~200 lines.
- On returning to an existing topic, **read what's there before researching** —
  only fill gaps, don't re-research.

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
  either tree, or a broken scenario fixture. Run it before every commit that
  touches a prompt or skill. CI runs it on every PR.
- **`npm run test:scenarios`** — drives the real agent (`claude -p`) through
  scripted learner sessions and checks the transcript, the knowledge base and
  the trace: gate before the first claim, citations resolve to real files,
  `sources.md` rows rated and dated, probing question first, no lecturing
  streaks, wrong answers corrected rather than advanced, plus medicine and
  market-research extras. Costs tokens; runs nightly and on demand in CI,
  gated on the `ANTHROPIC_API_KEY` secret. Reports land in
  `tests/scenarios/.runs/<stamp>/` (git-ignored).
- **Adding a scenario** = adding one YAML file at
  `tests/scenarios/<domain>/<name>.yaml` with a topic, a learner persona,
  scripted turns (mark one `expect: correction`) and any extra assertions.
  Nothing else changes. `npm run test:scenarios -- --dry-run` validates it.
- **Reading a trace** — every session writes
  `<kb-root>/.traces/<topic-slug>/<timestamp>.jsonl`, one `{ts, event, data}`
  per line (`session.start`, `phase`, `gate.check`, `research.query`,
  `research.fetch`, `kb.write`, `teach`, `check.ask`, `check.verdict`,
  `session.end`). `npm run trace` prints the latest one as a timeline; a
  `teach` with no preceding `gate.check`, or a `check.verdict` of
  `wrong -> advance`, is a regression. Set `LEARNING_KB_ROOT` to point the
  agent (and its traces) at a different root; the test harness does this.
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
