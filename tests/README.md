# Testing the learning agent

The product here is prose: two agent prompts and two skills. This directory is
the safety net that tells you whether a wording change made the agent worse.

There are two layers:

| Layer | Command | Needs a model? | When |
|---|---|---|---|
| **Lint** - deterministic checks on the prompt/skill files | `npm test` | No (seconds) | every PR, locally before committing |
| **Scenarios** - drive the real agent through scripted learner sessions | `npm run test:scenarios` | Yes (costs tokens, minutes) | nightly / on demand / before merging a prompt change |

Both use Node's built-in test runner and have **zero npm dependencies**
(Node 22+; Node 24 in CI). The scenario runner needs the `claude` CLI on PATH
and a working login or `ANTHROPIC_API_KEY`.

## 1. Lint suite (`npm test`)

`tests/lint/*.test.mjs`, run with `node --test`. What it asserts:

- **Frontmatter** - every agent/skill file has a valid block; skill `name`
  matches its folder; the opencode copies are flat `key: value` (the plugin
  loader cannot parse nested YAML); the Claude agent lists exactly the two
  shared skills; the `learn` command forks into `agent: learning`.
- **Parity** - the `claude/` and `opencode/` trees are identical after
  normalising the knowledge-base path and the bundled-script prefix. Only
  these differences are allowed: the KB path, the agent frontmatter keys
  (`name`/`skills` vs `mode`/`color`), the `learn` command (Claude only),
  `user-invocable: false` and `allowed-tools` (Claude skills only), and script
  paths (`${CLAUDE_SKILL_DIR}/scripts/x.sh` in Claude, `scripts/x.sh` in
  opencode). The test prints the first differing line. The
  `opencode/skills/learning-research/scripts` symlink is followed, so both
  trees must list the same script files.
- **Research skill** (`research-skill.test.mjs`) - the provider routing tables
  keep their required rows (papers, articles, docs, first-party, images,
  videos, courses, repos; company facts, funding, competitor product,
  sentiment, market size, industry reports, news, patents, trends) and every
  row names a concrete call; every script the skill references exists and is
  executable, every script under `scripts/` is referenced, every MCP tool name
  is a known one; the `sources.md` header equals `SOURCES_COLUMNS` in
  `tests/scenarios/lib/kb.mjs`; the opencode copy is exactly the documented
  derivation of the Claude copy; every script's `--help` exits 0; every keyed
  script exits 2 naming its keyless fallback when the key is unset; scripts
  follow the conventions in AGENTS.md. No network calls.
- **Manifests** - `package.json`, `claude/.claude-plugin/plugin.json` and
  `.claude-plugin/marketplace.json` carry the same version and name;
  `claude plugin validate ./claude` passes (skipped if the CLI is absent).
- **Prompt content** - both shared skills are `user-invocable: false`; every
  `[source: ...]` example in the prompts uses `[source: <name>.md]` (the
  single allowed exception is the `[source: URL or title]` placeholder in the
  concept-file template); no line permits skipping the probing question; the
  probing-question rule, citation rule, iron law and three research angles
  are still present; both trees document the full trace vocabulary and honour
  `LEARNING_KB_ROOT`.
- **Harness self-tests** - the YAML-subset parser, the frontmatter parser,
  the trace parser, every scenario fixture (it must load and validate), the
  driver's CLI arguments, and each deterministic assertion against a
  synthetic run (both the passing case and a broken case).

If you change the `sources.md` table header or the concept-file template in
`learning-research`, update `SOURCES_COLUMNS` / `parseSourcesTable` in
`tests/scenarios/lib/kb.mjs` and the lint will tell you so. The current
layout is `| URL | Title | Type | Domain | Tier | Published | Accessed |
Related-to | Summary |`; the parser reads columns by header name, derives the
High/Medium/Low rating from `Tier` (1-2 High, 3 Medium, 4-5 Low), and still
accepts the pre-#6 layout (`| URL | Title | Date Accessed | Credibility |
Summary |`) so old knowledge bases keep working.

## 2. Session traces

Every session the agent runs writes a JSONL trace, one JSON object per line:

```json
{"ts":"2026-09-24T10:00:05Z","event":"gate.check","data":{"concept":"hash-collisions","result":"fail","reason":"no topic folder"}}
```

Location: `<kb-root>/.traces/<topic-slug>/<session-timestamp>.jsonl`, where
`<kb-root>` is `~/.claude/learning` (Claude Code) or
`~/.config/opencode/learning` (opencode), or `$LEARNING_KB_ROOT` if set. The
agent appends each line with `echo '{...}' >> <file>`; the skills append their
own events to the same file.

### Event vocabulary

| event | emitted by | data |
|---|---|---|
| `session.start` | agent, once, first thing | `topic`, `slug` |
| `phase` | agent, on every flow transition | `from`, `to` (`probe`, `research`, `teach`, `check`, `recall`, `apply`, `challenge`, `synthesis`) |
| `gate.check` | `learning-assessment`, every run | `concept`, `result` (`pass`/`fail`), `reason` |
| `research.query` | `learning-research`, every search | `provider` (the script or tool actually called: `arxiv.sh`, `hn.sh`, `WebSearch`, `mcp__exa__web_search_exa`, ...), `query`, `material_type` (`docs`/`paper`/`blog`/`talk`/`dataset`/`news`/`other`) |
| `research.fetch` | `learning-research`, every fetch | `url`, `ok` (bool) |
| `kb.write` | `learning-research`, every KB file written | `file` |
| `teach` | agent, before each teaching message | `concept`, `citations` (array of `file.md`) |
| `check.ask` | agent, every question it will evaluate | `concept`, `question` |
| `check.verdict` | agent, on evaluating an answer | `concept`, `verdict` (`correct`/`partial`/`wrong`), `action` (`advance`/`correct`/`reteach`) |
| `session.end` | agent, at wrap-up | `concepts_covered` |

Values are short strings (under 200 chars), double quotes only, no
apostrophes (the line is single-quoted for the shell). Unknown events are
tolerated by the tooling, so a new feature can add its own (see *Extending*).

### Reading a trace

```bash
npm run trace                              # latest trace under the default roots
npm run trace -- path/to/session.jsonl     # one file
npm run trace -- ~/.claude/learning/.traces/hash-tables   # latest in a folder
npm run trace -- --json path/to/session.jsonl             # machine-readable
```

Output is a timeline with offsets from `session.start`, then counts:

```
 +m:ss  event
   0:00  session start  topic="Hash tables" slug=hash-tables
   0:03  gate fail      hash-function: no topic folder
   0:10  query          [web_search/docs] hash table collision resolution
   1:00  kb write       hash-function.md
   2:00  teach          hash-function  cites=[hash-function.md]
   3:00  ask            hash-function: What happens on collision?
   4:00  verdict        hash-function: wrong -> correct
```

Things to look for: a `teach` with no earlier `gate.check` (gate skipped); a
`gate.check` with `result: pass` on a brand-new topic (rationalised past the
gate); `check.verdict: wrong -> advance` (advanced past a misunderstanding);
`research.fetch` with `ok: false` followed by `kb.write` (stored without
reading); a session with `teach` events but no `check.ask` (lecturing).

## 3. Scenario tests (`npm run test:scenarios`)

A scenario is **one YAML file** at `tests/scenarios/<domain>/<name>.yaml`.
The runner drives the real agent through the scripted learner turns, then
evaluates assertions against the transcript, the knowledge base the agent
built, and the trace it wrote.

### Why not `claude plugin eval`?

Evaluated first (Claude Code 2.1.x, `claude plugin eval --help` and
https://code.claude.com/docs/en/plugin-evals). It does not fit: each case is
a single prompt followed by an autonomous run (no scripted follow-up turns,
only a `history_file` hack), it cannot target a plugin *agent*
(`--agent learning-agent:learning`), and its sandbox gives the run a
throwaway `HOME`, which breaks the knowledge-base and trace paths the
assertions need. It remains a reasonable tool for single-turn ablation
("does the plugin change the first reply vs. no plugin?") if someone wants
that later. The runner here uses `claude -p` directly:

```
claude -p --plugin-dir ./claude --agent learning-agent:learning \
  --output-format stream-json --verbose --permission-mode bypassPermissions \
  --add-dir <kb> --append-system-prompt "<harness note>" \
  --session-id <uuid>            # first turn
  --resume <uuid>                # later turns
```

with `LEARNING_KB_ROOT=<run-dir>/kb` in the environment. Both prompts honour
that variable, and the harness note restates the resolved paths and the topic
slug, so runs never touch `~/.claude/learning`.

### Running

```bash
npm run test:scenarios                          # all fixtures (8 x ~4 turns; budget a few dollars each)
npm run test:scenarios -- --domain medicine     # one domain
npm run test:scenarios -- --only hash-tables    # fixtures whose path contains the string
npm run test:scenarios -- --dry-run             # validate fixtures, print the plan, no model calls
npm run test:scenarios -- --model opus --judge-model sonnet -j 2
npm run test:scenarios -- --evaluate tests/scenarios/.runs/<stamp>   # re-run assertions on an
                                            # existing run without re-driving the agent (--no-judge skips judges)
```

`--evaluate` is the loop for iterating on an assertion: change it, re-evaluate
a saved run in seconds, then re-drive once it does what you mean.

Environment knobs: `SCENARIO_MODEL` (default `sonnet`), `SCENARIO_JUDGE_MODEL`
(default `sonnet`), `SCENARIO_FIRST_TURN_BUDGET_USD` (default 6; the first
turn does the research), `SCENARIO_TURN_BUDGET_USD` (default 3),
`SCENARIO_TURN_TIMEOUT_S` (default 1200).

Each run writes `tests/scenarios/.runs/<stamp>/`:

```
summary.md                       pass/fail table with links to every report and trace
<domain>/<name>/report.md        assertions, judge reasoning, trace timeline, KB file list, transcript
<domain>/<name>/turns.json       raw per-turn data: text blocks, tool calls, timings, cost
<domain>/<name>/kb/              the knowledge base the agent built (LEARNING_KB_ROOT)
<domain>/<name>/kb/.traces/      the session trace
```

Exit code 0 if every scenario passed, 1 otherwise. `.runs/` is git-ignored;
CI uploads it as an artifact.

### Fixture format

```yaml
name: beginner-hash-tables          # == file name
domain: computer-science            # == directory name
level: beginner                     # beginner | intermediate | advanced
topic: how hash tables work         # free text
slug: hash-tables                   # the topic slug the agent is told to use
persona: |                          # who the learner is; for authors and judges
  Self-taught hobbyist ...
turns:                              # learner turns, in order; the first opens the session
  - "I want to understand how hash tables actually work ..."
  - "My mental model is ..."
  - say: "If you make the table big enough collisions never happen."
    expect: correction              # wrong on purpose: the reply must correct, not advance
    note: Why this is wrong (for humans)
  - "OK so ... in my own words ..."
assertions:                         # extras on top of the core set (see below)
  - contested_populated
  - name: max_paragraphs_without_question
    n: 3
# optional: model, judge_model, budget_usd, max_paragraphs
```

Write scripted answers so they make sense whatever exact question the agent
asked: state the learner's belief ("My current model is ...") rather than
answering a specific phrasing. The wrong turn should assert the misconception
plainly so the agent has something concrete to correct.

The YAML parser is a small subset (`tests/lib/yaml.mjs`): maps, lists, block
scalars `|`/`>`, flow lists `[a, b]`, quoted strings, comments. Anything
fancier fails loudly with a line number.

### Assertions

**Core (every scenario):**

| name | how | checks |
|---|---|---|
| `trace_written` | files | a well-formed JSONL trace exists under `.traces/<slug>/` with `session.start`, `gate.check` and `teach` |
| `no_trace_narration` | regex | the agent never mentions tracing/trace files to the learner |
| `probe_first` | regex | the first agent turn asks a question, cites nothing, and is at most 4 paragraphs |
| `gate_before_claim` | trace + transcript | a `gate.check` precedes the first `teach` event and the first cited claim |
| `claims_cited` | **judge** | every non-trivial factual claim carries `[source: x.md]` |
| `citations_resolve` | files | every `[source: x.md]` names a file in the topic folder; at least one citation exists |
| `sources_credibility` | files | every `sources.md` row has High/Medium/Low and a date; each concept file references a High (primary) source and has a Technical Facts section |
| `max_paragraphs_without_question` | regex | no agent turn has more than `n` (default 3) consecutive paragraphs without a question |
| `wrong_answer_corrected` | **judge** + trace | after each `expect: correction` turn the reply corrects rather than advances; the trace's `check.verdict` is reported alongside |

**Domain extras (list them in the fixture):**

| name | how | checks |
|---|---|---|
| `contested_populated` | files | every concept file has a non-empty, non-template *Contested / Uncertain* section |
| `treatment_claims_guideline_grade` | **judge** | medicine: every dosing/treatment/threshold claim cites a file backed by a guideline-grade source (NICE, WHO, ADA, ESC, AHA/ACC, BNF, Cochrane, ...) |
| `numeric_claims_cited` | regex + files | market research: every sentence with a market/funding/user-count number carries a citation whose file is backed by a High/Medium **dated** `sources.md` row |
| `no_paywalled_as_fact` | **judge** | market research: paywalled analyst figures (Gartner, Statista, Grand View, ...) are flagged as unverified, never stated as fact |
| `first_vs_third_party` | **judge** | market research: company self-reports are marked as such, distinct from independent evidence |

Judge assertions call `claude -p` with no tools, a tight rubric and a JSON
schema (`pass`, `reasoning`, `evidence`); the reasoning and quoted evidence
are written into `report.md`. Everything else is regex or file checks.

### Reading a report

`report.md` starts with the pass/fail table, then judge reasoning, then the
trace timeline, then the full transcript with the tools used per turn. When a
deterministic assertion fails, the `detail` column names the turn or file.
Compare the trace timeline against the transcript to see *when* the gate ran
relative to what the learner saw.

## 4. CI

`.github/workflows/test.yml`:

- **lint** on every pull request and push to `main`.
- **scenarios** on `workflow_dispatch` (inputs: `filter`, `model`) and nightly.
  The job checks for the `ANTHROPIC_API_KEY` secret first and skips with a
  warning if it is absent, so forks without the secret do not fail. Reports,
  traces and knowledge bases are uploaded as the `scenario-runs` artifact.

## 5. Extending

- **Add a scenario:** add one file under `tests/scenarios/<domain>/`. A new
  domain is just a new directory. `npm test` validates it; `--dry-run` shows
  the plan.
- **Add an assertion:** add one entry to `ASSERTIONS` in
  `tests/scenarios/lib/assertions.mjs` (`describe` + `run(ctx, params)`; set
  `judged: true` if it calls `ctx.judge`). Add it to `CORE_ASSERTIONS` only if
  every scenario should run it. Add a synthetic-run test in
  `tests/lint/scenarios.test.mjs`.
- **Add a trace event:** document it in the `Session Tracing` table of both
  agent prompts (the lint checks both trees list the same vocabulary) and in
  the table above. `trace-summary` prints unknown events generically, so
  nothing breaks in between.
- **Search providers (#6) / parallel research (#7):** the research skill
  emits `research.query` with the real `provider` (script or tool name) and
  `research.fetch` per source; the existing assertions only care that a
  `gate.check` precedes teaching and that the files are cited and rated. A
  new provider = a new script under `claude/skills/learning-research/scripts/`
  plus a row in the routing table; `research-skill.test.mjs` checks both
  halves exist, that `--help` works and that a missing key degrades. A
  parallel step can fan the scripts out as-is (they are `mktemp`-only).
- **Learner memory (#8):** a new KB file family should still live under
  `<kb-root>/...` so `LEARNING_KB_ROOT` isolates it; add a `kb.write` for it
  and, if it changes the first turn, adjust `probe_first` via a fixture param.
- **Research mode (#9):** a mode that legitimately skips the probing question
  must not do so by editing the rule text (the lint pins it); give scenarios a
  fixture-level switch and a matching assertion instead.
