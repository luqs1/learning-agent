// Scenario fixtures and the deterministic assertions are checked here without
// any model call, so a broken fixture or a regression in an assertion fails
// `npm test` rather than a nightly run.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listFixtureFiles, loadFixture, loadFixtures, validateFixture, writeSeed } from "../scenarios/lib/fixtures.mjs";
import { parseYaml } from "../lib/yaml.mjs";
import { summarise } from "../../scripts/trace-summary.mjs";
import { ASSERTIONS, CORE_ASSERTIONS } from "../scenarios/lib/assertions.mjs";
import { loadKb, allEvents, parseSourcesTable, paragraphs, normaliseCredibility, tierToCredibility, referencesAnyRow, briefSection, isBrief, parseNumbersTables } from "../scenarios/lib/kb.mjs";
import { buildArgs, harnessSystemPrompt, ingestEvent, newTurn } from "../scenarios/lib/driver.mjs";
import * as repo from "../lib/repo.mjs";

const awaitImportRepo = () => repo;

const REQUIRED_DOMAINS = { "computer-science": 2, medicine: 2, "machine-learning": 2, "market-research": 2 };

test("every fixture parses and validates", () => {
  const files = listFixtureFiles();
  assert.ok(files.length >= 8, `expected at least 8 fixtures, found ${files.length}`);
  for (const f of files) loadFixture(f);
});

test("priority domains each have a beginner and an intermediate scenario", () => {
  const all = loadFixtures();
  for (const [domain, min] of Object.entries(REQUIRED_DOMAINS)) {
    const ofDomain = all.filter((s) => s.domain === domain);
    assert.ok(ofDomain.length >= min, `${domain}: expected >= ${min} scenarios, found ${ofDomain.length}`);
    for (const level of ["beginner", "intermediate"]) assert.ok(ofDomain.some((s) => s.level === level), `${domain}: no ${level} scenario`);
  }
});

test("fixtures: slugs are unique, each has a deliberately wrong turn, core assertions are applied", () => {
  const all = loadFixtures();
  const slugs = all.map((s) => s.slug);
  assert.equal(new Set(slugs).size, slugs.length, "duplicate slug across fixtures");
  for (const s of all) {
    assert.ok(s.turns.some((t) => t.expect === "correction"), `${s.id}: no turn with expect: correction`);
    for (const core of CORE_ASSERTIONS) assert.ok(s.assertions.some((a) => a.name === core), `${s.id}: missing core assertion ${core}`);
  }
});

test("medicine fixtures require the contested section and guideline-grade treatment claims", () => {
  for (const s of loadFixtures({ domain: "medicine" })) {
    for (const name of ["contested_populated", "treatment_claims_guideline_grade"]) assert.ok(s.assertions.some((a) => a.name === name), `${s.id}: missing ${name}`);
  }
});

test("market-research fixtures require cited numbers, no paywalled facts, and provenance", () => {
  for (const s of loadFixtures({ domain: "market-research" })) {
    for (const name of ["numeric_claims_cited", "no_paywalled_as_fact", "first_vs_third_party"]) assert.ok(s.assertions.some((a) => a.name === name), `${s.id}: missing ${name}`);
  }
});

test("every assertion has a description and a run function; core assertions exist", () => {
  for (const [name, def] of Object.entries(ASSERTIONS)) {
    assert.ok(typeof def.describe === "string" && def.describe.length > 10, `${name}: describe missing`);
    assert.equal(typeof def.run, "function", `${name}: run missing`);
  }
  for (const c of CORE_ASSERTIONS) assert.ok(ASSERTIONS[c], `core assertion ${c} is not defined`);
});

test("driver: harness args target the plugin agent, stream-json, and the temp KB root", () => {
  const args = buildArgs({ sessionId: "sid", resume: false, model: "sonnet", budgetUsd: 2, kbRoot: "/tmp/kb", slug: "x" });
  assert.ok(args.includes("learning-agent:learning"));
  assert.ok(args.includes("stream-json"));
  assert.ok(args.includes("bypassPermissions"));
  assert.deepEqual(args.slice(-2), ["--session-id", "sid"]);
  const resumed = buildArgs({ sessionId: "sid", resume: true, kbRoot: "/tmp/kb", slug: "x" });
  assert.deepEqual(resumed.slice(-2), ["--resume", "sid"]);
  assert.match(harnessSystemPrompt({ kbRoot: "/tmp/kb", slug: "x" }), /LEARNING_KB_ROOT is set to "\/tmp\/kb"/);
});

// ---------- deterministic assertions against a synthetic run ----------

function syntheticKb() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "la-kb-"));
  const topic = path.join(root, "hash-tables");
  fs.mkdirSync(path.join(root, ".traces", "hash-tables"), { recursive: true });
  fs.mkdirSync(topic);
  fs.writeFileSync(
    path.join(topic, "sources.md"),
    `# Sources: Hash tables

| URL | Title | Type | Domain | Tier | Published | Accessed | Related-to | Summary |
|-----|-------|------|--------|------|-----------|----------|------------|---------|
| https://docs.python.org/3/faq/design.html | Python Design FAQ | docs | cs | 1 | unknown | 2026-09-24 | | Official docs on dict implementation |
| https://example.com/blog | Someone's blog | article | cs | 4 | 2024-01-02 | 2026-09-24 | https://docs.python.org/3/faq/design.html | not yet read; secondary summary |
`,
  );
  fs.writeFileSync(
    path.join(topic, "hash-collisions.md"),
    `# Hash collisions

**Last updated:** 2026-09-24
**Sources used:** Python Design FAQ (https://docs.python.org/3/faq/design.html)

## Technical Facts

1. Collisions are unavoidable. [source: https://docs.python.org/3/faq/design.html]

## Contested / Uncertain

Open addressing vs chaining trade-offs depend on workload; sources differ on cache effects.
`,
  );
  fs.writeFileSync(
    path.join(root, ".traces", "hash-tables", "s.jsonl"),
    [
      '{"ts":"2026-09-24T10:00:00Z","event":"session.start","data":{"topic":"hash tables","slug":"hash-tables"}}',
      '{"ts":"2026-09-24T10:00:05Z","event":"gate.check","data":{"concept":"hash-collisions","result":"fail","reason":"no topic folder"}}',
      '{"ts":"2026-09-24T10:00:59Z","event":"phase","data":{"from":"probe","to":"research"}}',
      // Search turn (assistant message at 10:01:00): fanout + three angle searches in one message.
      '{"ts":"2026-09-24T10:01:01Z","event":"research.fanout","data":{"angles":["technical","expert","contested"],"parallel":true}}',
      '{"ts":"2026-09-24T10:01:01Z","event":"research.query","data":{"provider":"arxiv.sh","query":"hash table collision resolution","material_type":"paper"}}',
      '{"ts":"2026-09-24T10:01:01Z","event":"research.query","data":{"provider":"WebSearch","query":"hash table collisions what actually matters","material_type":"blog"}}',
      '{"ts":"2026-09-24T10:01:01Z","event":"research.query","data":{"provider":"WebSearch","query":"open addressing vs chaining debate","material_type":"other"}}',
      // Fetch turn (assistant message at 10:01:20): fetches plus the similarity query.
      '{"ts":"2026-09-24T10:01:21Z","event":"research.fetch","data":{"url":"https://docs.python.org/3/faq/design.html","ok":true}}',
      '{"ts":"2026-09-24T10:01:21Z","event":"research.query","data":{"provider":"s2.sh","query":"recommend arXiv:1104.5111","material_type":"paper"}}',
      '{"ts":"2026-09-24T10:01:38Z","event":"phase","data":{"from":"research","to":"merge"}}',
      '{"ts":"2026-09-24T10:01:41Z","event":"kb.write","data":{"file":"hash-collisions.md"}}',
      '{"ts":"2026-09-24T10:01:45Z","event":"phase","data":{"from":"merge","to":"teach"}}',
      '{"ts":"2026-09-24T10:02:00Z","event":"teach","data":{"concept":"hash-collisions","citations":["hash-collisions.md"]}}',
      '{"ts":"2026-09-24T10:03:00Z","event":"check.verdict","data":{"concept":"hash-collisions","verdict":"wrong","action":"correct"}}',
      '{"ts":"2026-09-24T10:04:00Z","event":"memory.write","data":{"file":"learner.md"}}',
      '{"ts":"2026-09-24T10:04:01Z","event":"memory.write","data":{"file":"hash-tables/progress.md"}}',
    ].join("\n") + "\n",
  );
  fs.mkdirSync(path.join(topic, ".research"));
  fs.writeFileSync(path.join(topic, ".research", "hash-collisions-technical.md"), "# Hash collisions — technical\n\nAngle: technical\n\n## Facts\n1. Collisions are unavoidable. [source: https://docs.python.org/3/faq/design.html] (section: dict) — Tier 1 — \"quote\"\n");
  fs.writeFileSync(path.join(root, "learner.md"), "# Learner profile\n\n## Background and expertise\n- 2026-09-24: hobbyist, small Python scripts (self-reported)\n");
  fs.writeFileSync(path.join(topic, "progress.md"), "# Progress: hash tables\n\nLast session: 2026-09-24\n\n## Concepts covered\n| concept | date | check | verdict |\n|---|---|---|---|\n| hash-collisions | 2026-09-24 | what happens on collision | wrong -> correct |\n");
  return root;
}

const SEEDED_LEARNER = "# Learner profile\n\n## Background and expertise\n- 2026-09-10: senior engineer, very comfortable with hash tables (self-reported)\n";

// The synthetic run as a returning learner: learner.md was seeded and the agent read it.
function seededCtx() {
  const ctx = syntheticCtx();
  ctx.scenario.seed = { "learner.md": SEEDED_LEARNER };
  ctx.events = [{ ts: "2026-09-24T10:00:01Z", event: "memory.read", data: { file: "learner.md", found: true } }, ...ctx.events];
  return ctx;
}

function syntheticCtx(overrides = {}) {
  const root = syntheticKb();
  const kb = loadKb(root, "hash-tables");
  const t = (ms) => Date.parse("2026-09-24T10:00:00Z") + ms;
  // Top-level assistant messages of the research turn: search (fanout + 3 searches in one
  // message), fetch (+ similarity query), read, write, then the teaching text.
  const researchMessages = [
    { id: "m-search", at: t(60_000), parent: null, tools: ["Bash", "Bash", "WebSearch", "WebSearch"] },
    { id: "m-fetch", at: t(80_000), parent: null, tools: ["Bash", "Bash"] },
    { id: "m-read", at: t(95_000), parent: null, tools: ["Read", "Read"] },
    { id: "m-write", at: t(100_000), parent: null, tools: ["Write", "Write", "Bash"] },
    { id: "m-teach", at: t(115_000), parent: null, tools: [] },
  ];
  const turns = [
    { learner: "teach me", agent: { text: "Before we start - what is your current mental model of a dict?", startedAt: t(0), endedAt: t(3000), messages: [{ id: "m-probe", at: t(500), parent: null, tools: ["Bash"] }] } },
    { learner: "a list", agent: { text: "A hash function maps a key to a slot [source: hash-collisions.md].\n\nCollisions are unavoidable [source: hash-collisions.md].\n\nWhat happens when two keys share a slot?", startedAt: t(60_000), endedAt: t(130_000), messages: researchMessages } },
    { learner: "never happens", expect: "correction", agent: { text: "Not quite - collisions always happen. Why?", startedAt: t(170_000), endedAt: t(190_000) } },
    { learner: "ok, collisions are handled by chaining. Done for today.", agent: { text: "Good. I keep a short profile of what we covered at " + path.join(root, "learner.md") + " - plain markdown, yours to edit or delete. Next time we start from open addressing.", startedAt: t(230_000), endedAt: t(250_000) } },
  ];
  return { scenario: { slug: "hash-tables", seed: {} }, turns, kb, events: allEvents(kb), judge: async () => ({ pass: true, reasoning: "stub", evidence: [] }), ...overrides };
}

test("assertions: a well-formed synthetic run passes every deterministic core assertion", async () => {
  const ctx = syntheticCtx();
  for (const name of CORE_ASSERTIONS) {
    const r = await ASSERTIONS[name].run(ctx, {});
    assert.ok(r.pass, `${name} failed on a good run: ${r.detail}`);
  }
  assert.ok((await ASSERTIONS.contested_populated.run(ctx, {})).pass);
});

test("assertions: no_trace_narration fails when the agent talks about the trace, not when 'tracing' is a domain word", () => {
  const ctx = syntheticCtx();
  ctx.turns[0].agent.text = "Good, the trace is set up. What is your mental model?";
  const r = ASSERTIONS.no_trace_narration.run(ctx, {});
  assert.equal(r.pass, false);
  assert.match(r.detail, /turn 1/);
  for (const talk of ["I have logged this to the session trace.", "Writing the trace file now.", "Recording a trace event first.", "The session log is in a jsonl file."]) {
    const c = syntheticCtx();
    c.turns[0].agent.text = `${talk} What is your mental model?`;
    assert.equal(ASSERTIONS.no_trace_narration.run(c, {}).pass, false, `should flag: ${talk}`);
  }
  for (const domain of ["The differentiation has to be something AI adds (UBO-chain tracing, risk scoring). Agree?", "Ray tracing renders each pixel by following light paths. Why is that slow?", "Read the stack trace from the bottom. What threw?"]) {
    const c = syntheticCtx();
    c.turns[0].agent.text = domain;
    assert.equal(ASSERTIONS.no_trace_narration.run(c, {}).pass, true, `should not flag: ${domain}`);
  }
});

test("assertions: probe_first fails when the first turn explains instead of asking", () => {
  const ctx = syntheticCtx();
  ctx.turns[0].agent.text = "A hash table maps keys to slots [source: hash-collisions.md]. It is fast.";
  const r = ASSERTIONS.probe_first.run(ctx, {});
  assert.equal(r.pass, false);
  assert.match(r.detail, /no question mark|already cites/);
});

test("assertions: citations_resolve fails on a citation with no file", () => {
  const ctx = syntheticCtx();
  ctx.turns[1].agent.text += " Also [source: made-up.md].";
  const r = ASSERTIONS.citations_resolve.run(ctx, {});
  assert.equal(r.pass, false);
  assert.match(r.detail, /made-up\.md/);
});

test("assertions: gate_before_claim fails when teach precedes gate.check", () => {
  const ctx = syntheticCtx();
  ctx.events = ctx.events.filter((e) => e.event !== "gate.check");
  assert.equal(ASSERTIONS.gate_before_claim.run(ctx, {}).pass, false);
  const ctx2 = syntheticCtx();
  const teach = ctx2.events.find((e) => e.event === "teach");
  ctx2.events = [teach, ...ctx2.events.filter((e) => e !== teach)];
  assert.equal(ASSERTIONS.gate_before_claim.run(ctx2, {}).pass, false);
});

test("assertions: sources_credibility fails on unrated rows and concept files without a primary source", () => {
  const ctx = syntheticCtx();
  ctx.kb.sources[0].credibility = "Excellent";
  assert.match(ASSERTIONS.sources_credibility.run(ctx, {}).detail, /without a High\/Medium\/Low/);
  const ctx2 = syntheticCtx();
  ctx2.kb.files["hash-collisions.md"] = ctx2.kb.files["hash-collisions.md"].replace(/https:\/\/docs\.python\.org\S*/g, "").replace("Python Design FAQ", "");
  assert.match(ASSERTIONS.sources_credibility.run(ctx2, {}).detail, /references no High-credibility source/);
});

test("assertions: max_paragraphs_without_question counts consecutive paragraphs", () => {
  const ctx = syntheticCtx();
  const p = (s) => `${s} ${"word ".repeat(30).trim()}.`;
  ctx.turns[1].agent.text = [p("One"), p("Two"), p("Three"), p("Four"), "Question?"].join("\n\n");
  assert.equal(ASSERTIONS.max_paragraphs_without_question.run(ctx, { n: 3 }).pass, false);
  assert.equal(ASSERTIONS.max_paragraphs_without_question.run(ctx, { n: 4 }).pass, true);
  assert.equal(ASSERTIONS.max_paragraphs_without_question.run(ctx, { n: 1, min_words: 1000 }).pass, true, "paragraphs below min_words are ignored");
  assert.equal(paragraphs("a\n\n```\ncode\n\nmore\n```\n\nb").length, 3);
});

test("assertions: numeric_claims_cited flags uncited numbers and Low-credibility backing", () => {
  const ctx = syntheticCtx();
  ctx.turns[1].agent.text = "The market is worth $5 billion. Udemy has 70 million learners [source: hash-collisions.md]. What do you think?";
  const r = ASSERTIONS.numeric_claims_cited.run(ctx, {});
  assert.equal(r.pass, false);
  assert.match(r.detail, /uncited numeric claim/);
  ctx.turns[1].agent.text = "Udemy has 70 million learners [source: hash-collisions.md]. If the market were $5 billion, what share would you need?";
  assert.equal(ASSERTIONS.numeric_claims_cited.run(ctx, {}).pass, true);
  // A table row is one unit: an abbreviation inside a cell must not split the citation away from the number.
  ctx.turns[1].agent.text = "| Value | What | Date | Source file | Tier |\n|---|---|---|---|---|\n| £2.5m | Detected follow-on incl. Thomson Reuters Ventures | 2024-01 | [source: hash-collisions.md] | 1 |\n\nWhat stands out?";
  assert.equal(ASSERTIONS.numeric_claims_cited.run(ctx, {}).pass, true, ASSERTIONS.numeric_claims_cited.run(ctx, {}).detail);
  ctx.turns[1].agent.text = "| Value | What | Date | Source file | Tier |\n|---|---|---|---|---|\n| £2.5m | Detected follow-on incl. Thomson Reuters Ventures | 2024-01 | none | 1 |\n\nWhat stands out?";
  assert.equal(ASSERTIONS.numeric_claims_cited.run(ctx, {}).pass, false, "an uncited table row is still an uncited number");
});

test("assertions: contested_populated fails on a template-only section", () => {
  const ctx = syntheticCtx();
  ctx.kb.files["hash-collisions.md"] = ctx.kb.files["hash-collisions.md"].replace(/## Contested \/ Uncertain\n\n[^\n]+/, "## Contested / Uncertain\n\n[What do sources disagree on?]");
  assert.equal(ASSERTIONS.contested_populated.run(ctx, {}).pass, false);
});

test("assertions: wrong_answer_corrected records trace evidence and the judge verdict", async () => {
  const ctx = syntheticCtx();
  const r = await ASSERTIONS.wrong_answer_corrected.run(ctx, {});
  assert.equal(r.pass, true);
  assert.match(r.detail, /trace verdicts: wrong->correct/);
  ctx.judge = async () => ({ pass: false, reasoning: "accepted the wrong answer", evidence: ["Great!"] });
  const r2 = await ASSERTIONS.wrong_answer_corrected.run(ctx, {});
  assert.equal(r2.pass, false);
  assert.match(r2.reasoning, /accepted/);
});

// ---------- parallel research (#7) ----------

test("kb: .research/ fragments are exposed as kb.fragments and are never concept files", () => {
  const kb = loadKb(syntheticKb(), "hash-tables");
  assert.deepEqual(Object.keys(kb.fragments), [".research/hash-collisions-technical.md"]);
  assert.match(kb.fragments[".research/hash-collisions-technical.md"], /^Angle: technical/m);
  assert.deepEqual(kb.conceptFiles, ["hash-collisions.md"], "a fragment must not count as a concept file");
  assert.ok(!Object.keys(kb.files).some((f) => f.includes(".research")));
});

test("assertions: research_rounds_max counts the distinct top-level assistant turns that contain searches in the first research phase", () => {
  const good = ASSERTIONS.research_rounds_max.run(syntheticCtx(), {});
  assert.equal(good.pass, true, good.detail);
  assert.match(good.detail, /4 searches in 2 assistant turn\(s\)/);
  assert.match(good.detail, /fanout angles=\[technical, expert, contested\]/);

  // Tighter bound: the fetch-turn similarity query is a second round.
  const tight = ASSERTIONS.research_rounds_max.run(syntheticCtx(), { max: 1 });
  assert.equal(tight.pass, false);
  assert.match(tight.detail, /spread over 2 assistant turns \(max 1\): 3\+1 per turn/);

  // One search per turn (the pre-#7 behaviour): three extra messages, each with its own query.
  const serial = syntheticCtx();
  const t = (ms) => Date.parse("2026-09-24T10:00:00Z") + ms;
  serial.turns[1].agent.messages = [
    { id: "s1", at: t(60_000), parent: null, tools: ["WebSearch"] },
    { id: "s2", at: t(65_000), parent: null, tools: ["WebSearch"] },
    { id: "s3", at: t(70_000), parent: null, tools: ["WebSearch"] },
    { id: "s4", at: t(80_000), parent: null, tools: ["Bash"] },
    { id: "s5", at: t(100_000), parent: null, tools: ["Write"] },
  ];
  const q = (sec, query) => ({ ts: `2026-09-24T10:01:${String(sec).padStart(2, "0")}Z`, event: "research.query", data: { provider: "WebSearch", query, material_type: "other" } });
  serial.events = serial.events.filter((e) => e.event !== "research.query").concat([q(1, "a"), q(6, "b"), q(11, "c"), q(21, "d")]).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const r = ASSERTIONS.research_rounds_max.run(serial, { max: 2 });
  assert.equal(r.pass, false);
  assert.match(r.detail, /4 searches spread over 4 assistant turns \(max 2\)/);

  // Subagent turns (parent set) do not count as rounds: three researchers launched from one message.
  const fanned = syntheticCtx();
  fanned.turns[1].agent.messages = [
    { id: "p1", at: t(60_000), parent: null, tools: ["Bash", "Agent", "Agent", "Agent"] },
    { id: "c1", at: t(61_000), parent: "toolu_1", tools: ["Bash"] },
    { id: "c2", at: t(62_000), parent: "toolu_2", tools: ["WebSearch"] },
    { id: "c3", at: t(70_000), parent: "toolu_3", tools: ["Bash"] },
    { id: "p2", at: t(100_000), parent: null, tools: ["Read", "Read", "Read"] },
    { id: "p3", at: t(110_000), parent: null, tools: ["Write"] },
  ];
  const f = ASSERTIONS.research_rounds_max.run(fanned, { max: 1 });
  assert.equal(f.pass, true, f.detail);
  assert.match(f.detail, /in 1 assistant turn\(s\)/);

  // No fanout event: fails unless require_fanout is off.
  const noFan = syntheticCtx();
  noFan.events = noFan.events.filter((e) => e.event !== "research.fanout");
  assert.match(ASSERTIONS.research_rounds_max.run(noFan, {}).detail, /no research\.fanout event/);
  assert.equal(ASSERTIONS.research_rounds_max.run(noFan, { require_fanout: false }).pass, true);

  // Old runs without message timings are skipped, not failed.
  const old = syntheticCtx();
  for (const turn of old.turns) delete turn.agent.messages;
  const s = ASSERTIONS.research_rounds_max.run(old, {});
  assert.equal(s.skipped, true);

  // Only the first research phase is counted: a later research phase with serial searches is ignored.
  const later = syntheticCtx();
  later.events = later.events.concat([
    { ts: "2026-09-24T10:02:50Z", event: "phase", data: { from: "teach", to: "research" } },
    { ts: "2026-09-24T10:02:51Z", event: "research.query", data: { provider: "WebSearch", query: "later-a", material_type: "other" } },
    { ts: "2026-09-24T10:02:56Z", event: "research.query", data: { provider: "WebSearch", query: "later-b", material_type: "other" } },
    { ts: "2026-09-24T10:03:01Z", event: "research.query", data: { provider: "WebSearch", query: "later-c", material_type: "other" } },
  ]);
  later.turns[2].agent.messages = [
    { id: "l1", at: t(170_000), parent: null, tools: ["WebSearch"] },
    { id: "l2", at: t(175_000), parent: null, tools: ["WebSearch"] },
    { id: "l3", at: t(180_000), parent: null, tools: ["WebSearch"] },
  ];
  assert.equal(ASSERTIONS.research_rounds_max.run(later, {}).pass, true, "a later research phase is not the first one");
});

test("driver: stream-json events are grouped into assistant messages, subagent output stays out of the transcript", () => {
  const turn = newTurn(1000);
  const ev = (over) => ({ type: "assistant", parent_tool_use_id: null, timestamp: "2026-09-24T15:59:49.831Z", message: { id: "msg_1", content: [] }, ...over });
  ingestEvent(turn, ev({ message: { id: "msg_1", content: [{ type: "text", text: "Launching research." }] } }));
  ingestEvent(turn, ev({ message: { id: "msg_1", content: [{ type: "tool_use", name: "Agent", input: { subagent_type: "learning-agent:learning-researcher", description: "Research hash-collisions (technical)" } }] } }));
  ingestEvent(turn, ev({ message: { id: "msg_1", content: [{ type: "tool_use", name: "Agent", input: { subagent_type: "learning-agent:learning-researcher", description: "Research hash-collisions (expert)" } }] } }));
  ingestEvent(turn, { type: "system", subtype: "task_started", subagent_type: "learning-agent:learning-researcher", description: "Research hash-collisions (technical)", tool_use_id: "toolu_1", is_backgrounded: false });
  ingestEvent(turn, ev({ parent_tool_use_id: "toolu_1", timestamp: "2026-09-24T15:59:51.718Z", message: { id: "msg_child", content: [{ type: "text", text: "I will search arXiv now." }, { type: "tool_use", name: "Bash", input: { command: "fanout.sh ..." } }] } }));
  ingestEvent(turn, ev({ timestamp: "2026-09-24T16:00:02.356Z", message: { id: "msg_2", content: [{ type: "text", text: "Here is the concept." }] } }));
  ingestEvent(turn, { type: "result", subtype: "success", total_cost_usd: 0.5, num_turns: 3 });
  assert.deepEqual(turn.messages.map((m) => [m.id, m.parent, m.tools]), [["msg_1", null, ["Agent", "Agent"]], ["msg_child", "toolu_1", ["Bash"]], ["msg_2", null, []]]);
  assert.equal(turn.messages[0].at, Date.parse("2026-09-24T15:59:49.831Z"));
  assert.deepEqual(turn.toolNames, ["Agent", "Agent"], "subagent tool calls are not top-level tools");
  assert.deepEqual(turn.subagentToolNames, ["Bash"]);
  assert.deepEqual(turn.subagents.map((s) => s.type), ["learning-agent:learning-researcher"]);
  turn.text = turn.blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n\n");
  assert.ok(!turn.text.includes("I will search arXiv"), "subagent text must not reach the learner-visible transcript");
  assert.match(turn.blocks[1].summary, /learning-researcher: Research hash-collisions \(technical\)/);
  assert.equal(turn.costUsd, 0.5);
});

test("trace-summary: research.fanout is summarised", () => {
  const events = allEvents(loadKb(syntheticKb(), "hash-tables"));
  const s = summarise(events);
  assert.deepEqual(s.fanouts, ["technical+expert+contested"]);
  assert.equal(s.counts["research.fanout"], 1);
});

// ---------- learner memory (#8) ----------

test("kb: progress.md and learner.md are memory, not concept files", () => {
  const kb = loadKb(syntheticKb(), "hash-tables");
  assert.ok(kb.files["progress.md"], "progress.md is read from the topic folder");
  assert.deepEqual(kb.conceptFiles, ["hash-collisions.md"], "progress.md must not count as a concept file");
  assert.match(kb.learner, /^# Learner profile/);
  assert.match(kb.progress, /^# Progress/);
  const bare = loadKb(fs.mkdtempSync(path.join(os.tmpdir(), "la-kb-")), "x");
  assert.equal(bare.learner, null);
  assert.equal(bare.progress, null);
});

test("assertions: profile_written passes on a good run and names each missing piece", async () => {
  assert.equal(ASSERTIONS.profile_written.run(syntheticCtx()).pass, true);

  const noFile = syntheticCtx();
  noFile.kb.learner = null;
  assert.match(ASSERTIONS.profile_written.run(noFile).detail, /no learner\.md/);

  const undated = syntheticCtx();
  undated.kb.learner = "# Learner profile\n\n## Background and expertise\n- hobbyist\n";
  assert.match(ASSERTIONS.profile_written.run(undated).detail, /no dated/);

  const noEvent = syntheticCtx();
  noEvent.events = noEvent.events.filter((e) => e.event !== "memory.write");
  const r = ASSERTIONS.profile_written.run(noEvent);
  assert.equal(r.pass, false);
  assert.match(r.detail, /no memory\.write event for learner\.md/);
  assert.match(r.detail, /no memory\.write event for progress\.md/);

  const notTold = syntheticCtx();
  notTold.turns[3].agent.text = "Good. Next time we start from open addressing.";
  assert.match(ASSERTIONS.profile_written.run(notTold).detail, /never told/);

  const noProgress = syntheticCtx();
  noProgress.kb.progress = null;
  assert.match(ASSERTIONS.profile_written.run(noProgress).detail, /no progress\.md/);
});

test("assertions: profile_written on a seeded run requires the seed to have changed and does not require an announcement", () => {
  const ctx = seededCtx();
  ctx.turns[3].agent.text = "Good. Next time we start from open addressing."; // no mention of learner.md: fine for a returning learner
  assert.equal(ASSERTIONS.profile_written.run(ctx).pass, true, ASSERTIONS.profile_written.run(ctx).detail);
  ctx.kb.learner = SEEDED_LEARNER;
  const r = ASSERTIONS.profile_written.run(ctx);
  assert.equal(r.pass, false);
  assert.match(r.detail, /unchanged from the seed/);
});

test("assertions: profile_not_trusted needs a seed, a memory.read, a first-turn question and the judge", async () => {
  const good = await ASSERTIONS.profile_not_trusted.run(seededCtx());
  assert.equal(good.pass, true, good.detail);

  const unseeded = await ASSERTIONS.profile_not_trusted.run(syntheticCtx());
  assert.equal(unseeded.pass, false);
  assert.match(unseeded.detail, /needs a seeded learner\.md/);

  const unread = seededCtx();
  unread.events = unread.events.filter((e) => e.event !== "memory.read");
  assert.match((await ASSERTIONS.profile_not_trusted.run(unread)).detail, /profile not read/);

  const lectured = seededCtx();
  lectured.turns[0].agent.text = "Since you are already an expert, let us go straight to open addressing.";
  assert.match((await ASSERTIONS.profile_not_trusted.run(lectured)).detail, /asks no question/);

  const trusted = seededCtx();
  trusted.judge = async ({ material }) => {
    assert.match(material, /## Seeded learner\.md/);
    assert.match(material, /wrong on purpose/);
    return { pass: false, reasoning: "deferred to the profile", evidence: ["given your background I will skip"] };
  };
  const r = await ASSERTIONS.profile_not_trusted.run(trusted);
  assert.equal(r.pass, false);
  assert.match(r.reasoning, /deferred/);
});

test("fixtures: seed maps relative paths to content and rejects escapes", () => {
  const base = { name: "x", domain: "d", level: "beginner", topic: "t", slug: "t", persona: "a persona long enough to pass validation", turns: ["a", "b"] };
  const file = "/tmp/d/x.yaml";
  assert.deepEqual(validateFixture({ ...base, seed: { "learner.md": "# Learner profile\n", "t/progress.md": "# Progress\n" } }, file), []);
  assert.ok(validateFixture({ ...base, seed: { "../learner.md": "x" } }, file).some((e) => /relative path/.test(e)));
  assert.ok(validateFixture({ ...base, seed: { "/etc/passwd": "x" } }, file).some((e) => /relative path/.test(e)));
  assert.ok(validateFixture({ ...base, seed: { "learner.md": "" } }, file).some((e) => /non-empty/.test(e)));
  assert.ok(validateFixture({ ...base, seed: ["learner.md"] }, file).some((e) => /must be a map/.test(e)));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "la-seed-"));
  const written = writeSeed(root, { "learner.md": "# Learner profile\n", "t/progress.md": "# Progress\n" });
  assert.deepEqual(written, ["learner.md", "t/progress.md"]);
  assert.equal(fs.readFileSync(path.join(root, "t", "progress.md"), "utf8"), "# Progress\n");
  assert.throws(() => writeSeed(root, { "../outside.md": "x" }), /escapes/);
});

test("fixtures: the memory scenarios carry their seeds and assertions", () => {
  const returning = loadFixtures({ only: "returning-overrated-profile" })[0];
  assert.ok(returning, "returning-overrated-profile fixture missing");
  assert.ok(returning.seed["learner.md"], "returning scenario must seed learner.md");
  assert.ok(returning.seed[`${returning.slug}/progress.md`], "returning scenario must seed <slug>/progress.md");
  assert.match(returning.seed["learner.md"], /self-reported/);
  for (const name of ["profile_not_trusted", "profile_written"]) assert.ok(returning.assertions.some((a) => a.name === name), `returning scenario missing ${name}`);
  const fresh = loadFixtures({ only: "new-learner-profile-created" })[0];
  assert.ok(fresh, "new-learner-profile-created fixture missing");
  assert.deepEqual(fresh.seed, {}, "the new-learner scenario must not seed anything");
  assert.ok(fresh.assertions.some((a) => a.name === "profile_written"));
  assert.match(fresh.turns.at(-1).say, /stop here/i, "the last turn must end the session so memory is written");
  const seeded = loadFixtures().filter((s) => Object.keys(s.seed).length);
  for (const s of seeded) for (const p of Object.keys(s.seed)) assert.ok(p === "learner.md" || p.startsWith(`${s.slug}/`), `${s.id}: seed path ${p} is outside learner.md and the topic folder`);
});

test("yaml: mapping keys may contain slashes (seed paths)", () => {
  const doc = parseYaml("seed:\n  learner.md: |\n    # Learner profile\n\n    - line\n  big-o/progress.md: |\n    # Progress\nafter: 1\n");
  assert.equal(doc.seed["learner.md"], "# Learner profile\n\n- line\n");
  assert.equal(doc.seed["big-o/progress.md"], "# Progress\n");
  assert.equal(doc.after, 1);
});

test("trace-summary: memory events are summarised", () => {
  const events = allEvents(loadKb(syntheticKb(), "hash-tables"));
  const s = summarise([{ ts: "2026-09-24T09:59:59Z", event: "memory.read", data: { file: "learner.md", found: false } }, ...events]);
  assert.deepEqual(s.memory_read, ["learner.md (absent)"]);
  assert.deepEqual(s.memory_written, ["learner.md", "hash-tables/progress.md"]);
  assert.equal(s.counts["memory.write"], 2);
});

// ---------- research mode (#9) ----------

const BRIEF = `# Brief: who is doing AI-driven KYB for UK fintechs

**Date:** 2026-09-24 | **Topic:** uk-kyb | **Previous brief:** none

## Question
Who else is doing AI-driven KYB for UK fintechs, and how are they funded?

## Hypothesis
> Five or six funded players, none UK-first.

## Findings
1. Acme Verify Ltd was incorporated in 2019 and filed an SH01 allotment in 2024 [source: companies/acme-verify.md] (Tier 1)
2. Acme says its API covers 4m UK companies [source: companies/acme-verify.md] (Tier 2, the company says)
3. The FCA register lists the addressable buyers [source: market-size.md] (Tier 1)

## Numbers
| Value | What | Date | Source file | Tier |
|---|---|---|---|---|
| £3.2m | Acme Verify SH01 share allotment, total consideration | 2024-03-11 | [source: companies/acme-verify.md] | 1 |
| 4m | UK companies Acme says its API covers | 2026-09-24 (fetched) | [source: companies/acme-verify.md] | 2 |

## Contested / Unknown
- Crunchbase lists Acme total funding at $40m (unverified, Tier 4); the SH01 filings read so far account for £3.2m [source: companies/acme-verify.md]
- Nobody publishes how many UK fintechs buy a dedicated KYB tool rather than a KYC bundle.

## Counter-case
The SH01 filings show more UK-registered KYB-first companies than the hypothesis allows, so "none UK-first" is already contradicted by the register [source: companies/acme-verify.md].

## Next questions
- Does any incumbent's pricing page mention UK entity coverage? - look in: competitor product row (fetch-readable.sh /pricing, wayback.sh)

Does the counter-case change your hypothesis, or do you have evidence that answers it?
`;

function researchKb() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "la-rkb-"));
  const topic = path.join(root, "uk-kyb");
  fs.mkdirSync(path.join(root, ".traces", "uk-kyb"), { recursive: true });
  fs.mkdirSync(path.join(topic, "companies"), { recursive: true });
  fs.writeFileSync(
    path.join(topic, "sources.md"),
    `# Sources: UK KYB

| URL | Title | Type | Domain | Tier | Published | Accessed | Related-to | Summary |
|-----|-------|------|--------|------|-----------|----------|------------|---------|
| https://find-and-update.company-information.service.gov.uk/company/12345678/filing-history | Acme Verify Ltd filing history | filing | uk-fintech | 1 | 2024-03-11 | 2026-09-24 | | SH01 allotment 2024-03-11 |
| https://acmeverify.example/product | Acme Verify product page | first-party | uk-fintech | 2 | unknown | 2026-09-24 | | Company says 4m UK companies covered |
| https://register.fca.org.uk/ | FCA Financial Services Register | dataset | uk-fintech | 1 | unknown | 2026-09-24 | | Authorised payment and e-money firms |
| https://www.crunchbase.com/organization/acme-verify | Acme Verify - Crunchbase | report | uk-fintech | 4 | unknown | 2026-09-24 | https://acmeverify.example/product | not read in full; total funding $40m claimed |
`,
  );
  fs.writeFileSync(
    path.join(topic, "companies", "acme-verify.md"),
    `# Acme Verify Ltd

**Last updated:** 2026-09-24
**Sources used:** Acme Verify Ltd filing history (https://find-and-update.company-information.service.gov.uk/company/12345678/filing-history), Acme Verify product page (https://acmeverify.example/product), Crunchbase (https://www.crunchbase.com/organization/acme-verify)

## Registration
Company 12345678, incorporated 2019-05-02 (Companies House).

## Funding
- 2024-03-11 SH01: £3.2m total consideration (filing).
- Crunchbase claims $40m total (unverified, Tier 4).

## Product
The company says its API covers 4m UK companies (product page, fetched 2026-09-24).
`,
  );
  fs.writeFileSync(
    path.join(topic, "market-size.md"),
    `# Market size: UK KYB buyers

**Sources used:** FCA Financial Services Register (https://register.fca.org.uk/)

## Buyers
Authorised payment and e-money firms per the FCA register, accessed 2026-09-24.
`,
  );
  fs.writeFileSync(path.join(topic, "brief-2026-09-24.md"), BRIEF);
  fs.writeFileSync(path.join(root, "learner.md"), "# Learner profile\n\n## Venture context\n- Hypothesis: 2026-09-24: five or six funded players, none UK-first - untested\n");
  fs.writeFileSync(path.join(topic, "progress.md"), "# Progress: UK KYB\n\nLast session: 2026-09-24\n");
  fs.writeFileSync(
    path.join(root, ".traces", "uk-kyb", "s.jsonl"),
    [
      '{"ts":"2026-09-24T10:00:00Z","event":"session.start","data":{"topic":"uk kyb competitors","slug":"uk-kyb"}}',
      '{"ts":"2026-09-24T10:00:01Z","event":"memory.read","data":{"file":"learner.md","found":false}}',
      '{"ts":"2026-09-24T10:00:02Z","event":"phase","data":{"from":"start","to":"gauge"}}',
      '{"ts":"2026-09-24T10:01:00Z","event":"phase","data":{"from":"gauge","to":"plan"}}',
      '{"ts":"2026-09-24T10:01:05Z","event":"gate.check","data":{"concept":"uk-kyb-competitors","result":"fail","reason":"no topic folder"}}',
      '{"ts":"2026-09-24T10:01:10Z","event":"phase","data":{"from":"plan","to":"research"}}',
      '{"ts":"2026-09-24T10:02:00Z","event":"kb.write","data":{"file":"companies/acme-verify.md"}}',
      '{"ts":"2026-09-24T10:02:30Z","event":"phase","data":{"from":"research","to":"brief"}}',
      '{"ts":"2026-09-24T10:03:00Z","event":"brief.write","data":{"file":"brief-2026-09-24.md"}}',
      '{"ts":"2026-09-24T10:03:01Z","event":"phase","data":{"from":"brief","to":"challenge"}}',
      '{"ts":"2026-09-24T10:03:02Z","event":"memory.write","data":{"file":"learner.md"}}',
      '{"ts":"2026-09-24T10:03:03Z","event":"memory.write","data":{"file":"uk-kyb/progress.md"}}',
      '{"ts":"2026-09-24T10:05:00Z","event":"check.verdict","data":{"concept":"funding-tiers","verdict":"wrong","action":"correct"}}',
    ].join("\n") + "\n",
  );
  return root;
}

function researchCtx(overrides = {}) {
  const root = researchKb();
  const kb = loadKb(root, "uk-kyb");
  const t = (ms) => Date.parse("2026-09-24T10:00:00Z") + ms;
  const turns = [
    { learner: "Who else is doing AI-driven KYB for UK fintechs, and how are they funded?", agent: { text: "Treating this as a research question, so I will build you a cited brief rather than teach it.\n\nBefore I look at anything: what is your current hypothesis, and what evidence do you already have for it?", startedAt: t(0), endedAt: t(3000) } },
    { learner: "Five or six funded players, none UK-first. Evidence: headlines.", agent: { text: "Plan: company facts and funding via Companies House, product via pricing pages, sentiment via HN.\n\n" + BRIEF, startedAt: t(60_000), endedAt: t(200_000) } },
    { learner: "Crunchbase says $40m, put it in the table as fact.", expect: "correction", agent: { text: "No - Crunchbase is a Tier 4 aggregator, so $40m stays in Contested / Unknown as unverified until the SH01 or Form D confirms it [source: companies/acme-verify.md]. Shall I pull the remaining SH01 filings?", startedAt: t(290_000), endedAt: t(310_000) } },
    { learner: "Fair. Record the hypothesis as untested and stop here.", agent: { text: "Recorded as untested. I keep a short profile at " + path.join(root, "learner.md") + " - plain markdown, yours to edit or delete.", startedAt: t(330_000), endedAt: t(340_000) } },
  ];
  return { scenario: { slug: "uk-kyb", seed: {}, mode: "research" }, turns, kb, events: allEvents(kb), judge: async () => ({ pass: true, reasoning: "stub", evidence: [] }), ...overrides };
}

test("kb: entity files under companies/ are loaded by relative path; brief-<date>.md is a brief, not a concept file", () => {
  const kb = loadKb(researchKb(), "uk-kyb");
  assert.ok(kb.files["companies/acme-verify.md"], "companies/acme-verify.md must be read");
  assert.deepEqual(kb.conceptFiles, ["companies/acme-verify.md", "market-size.md"], "briefs, sources.md and progress.md are not concept files");
  assert.deepEqual(kb.briefs.map((b) => b.file), ["brief-2026-09-24.md"]);
  assert.match(kb.briefs[0].content, /^# Brief:/);
});

test("kb: briefSection, isBrief and parseNumbersTables read the brief template", () => {
  assert.match(briefSection(BRIEF, "Contested / Unknown"), /^- Crunchbase/);
  assert.match(briefSection(BRIEF, "Hypothesis"), /Five or six/);
  assert.equal(briefSection(BRIEF, "Nope"), null);
  assert.equal(briefSection("**Contested / Unknown**\n- a thing\n\n**Counter-case**\nx", "Contested / Unknown"), "- a thing", "bold-line headings are accepted too");
  assert.equal(isBrief(BRIEF), true);
  assert.equal(isBrief("What is your hypothesis?"), false);
  const rows = parseNumbersTables(BRIEF);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].value, rows[0].file, rows[0].tier, rows[0].date], ["£3.2m", "companies/acme-verify.md", 1, "2024-03-11"]);
  assert.deepEqual([rows[1].file, rows[1].tier], ["companies/acme-verify.md", 2]);
  const bare = parseNumbersTables("| Value | What | Date | Source | Tier |\n|---|---|---|---|---|\n| 5 | x | 2024 | market-size.md | **1** |\n");
  assert.deepEqual([bare[0].file, bare[0].tier], ["market-size.md", 1], "a bare file name and a bold tier still parse");
  assert.equal(parseNumbersTables("| a | b |\n|---|---|\n| 1 | 2 |").length, 0, "an unrelated table is ignored");
});

test("assertions: a well-formed research-mode run passes every core assertion and the four research assertions", async () => {
  const ctx = researchCtx();
  for (const name of [...CORE_ASSERTIONS, "gauge_first", "numbers_table_tiered", "contested_nonempty", "brief_written", "profile_written", "numeric_claims_cited"]) {
    const r = await ASSERTIONS[name].run(ctx, {});
    assert.ok(r.pass, `${name} failed on a good research run: ${r.detail}`);
  }
});

test("assertions: trace_written wants brief.write in research mode and teach otherwise", () => {
  const ctx = researchCtx();
  assert.equal(ASSERTIONS.trace_written.run(ctx).pass, true, "no teach event is fine in research mode");
  const noBrief = researchCtx();
  noBrief.events = noBrief.events.filter((e) => e.event !== "brief.write");
  assert.match(ASSERTIONS.trace_written.run(noBrief).detail, /missing events: brief\.write/);
  const asTeach = researchCtx();
  asTeach.scenario.mode = "teach";
  assert.match(ASSERTIONS.trace_written.run(asTeach).detail, /missing events: teach/);
});

test("assertions: gauge_first wants hypothesis + evidence, a question and no citations in the first turn", () => {
  assert.equal(ASSERTIONS.gauge_first.run(researchCtx()).pass, true);
  const noHyp = researchCtx();
  noHyp.turns[0].agent.text = "What is your current mental model of KYB?";
  const r = ASSERTIONS.gauge_first.run(noHyp);
  assert.equal(r.pass, false);
  assert.match(r.detail, /hypothesis/);
  assert.match(r.detail, /evidence/);
  const cited = researchCtx();
  cited.turns[0].agent.text = "Acme raised £3.2m [source: companies/acme-verify.md]. What is your hypothesis and what evidence do you have?";
  assert.match(ASSERTIONS.gauge_first.run(cited).detail, /already cites/);
  const briefed = researchCtx();
  briefed.turns[0].agent.text = BRIEF + "\n\nWhat is your hypothesis and evidence?";
  assert.match(ASSERTIONS.gauge_first.run(briefed).detail, /already contains a brief/);
});

test("assertions: numbers_table_tiered rejects Tier 3+, unknown files, tier mismatches and a missing table", () => {
  assert.equal(ASSERTIONS.numbers_table_tiered.run(researchCtx()).pass, true);

  const tier3 = researchCtx();
  tier3.turns[1].agent.text = tier3.turns[1].agent.text.replace("| [source: companies/acme-verify.md] | 1 |", "| [source: companies/acme-verify.md] | 3 |");
  const r3 = ASSERTIONS.numbers_table_tiered.run(tier3);
  assert.equal(r3.pass, false);
  assert.match(r3.detail, /Tier 3 number in the Numbers table/);

  const ghost = researchCtx();
  ghost.turns[1].agent.text = ghost.turns[1].agent.text.replace("| [source: companies/acme-verify.md] | 2 |", "| [source: companies/ghost.md] | 2 |");
  assert.match(ASSERTIONS.numbers_table_tiered.run(ghost).detail, /companies\/ghost\.md, which is not in the topic folder/);

  const mismatch = researchCtx();
  // market-size.md references only a Tier 1 row; a Tier 2 claim on it cannot resolve to a Tier 2 source.
  mismatch.turns[1].agent.text = mismatch.turns[1].agent.text.replace("| [source: companies/acme-verify.md] | 2 |", "| [source: market-size.md] | 2 |");
  const rm = ASSERTIONS.numbers_table_tiered.run(mismatch);
  assert.equal(rm.pass, false);
  assert.match(rm.detail, /market-size\.md references no sources\.md row of Tier 2 \(it references Tier 1 rows\)/);

  const unbacked = researchCtx();
  unbacked.kb.files["companies/acme-verify.md"] = "# Acme\n\nNo sources here.\n";
  assert.match(ASSERTIONS.numbers_table_tiered.run(unbacked).detail, /references no rated row at all/);

  const noTable = researchCtx();
  noTable.kb.briefs = [];
  noTable.turns[1].agent.text = "## Findings\n1. x [source: market-size.md]\n\n## Contested / Unknown\n- y\n\nQuestion?";
  assert.match(ASSERTIONS.numbers_table_tiered.run(noTable).detail, /no Numbers table/);

  const noBrief = researchCtx();
  noBrief.kb.briefs = [];
  noBrief.turns[1].agent.text = "Nothing here?";
  assert.match(ASSERTIONS.numbers_table_tiered.run(noBrief).detail, /no brief found/);
});

test("assertions: contested_nonempty rejects empty, 'none' and template sections in the file and in the turn", () => {
  assert.equal(ASSERTIONS.contested_nonempty.run(researchCtx()).pass, true);
  const none = researchCtx();
  none.kb.briefs[0].content = none.kb.briefs[0].content.replace(/## Contested \/ Unknown\n[\s\S]*?\n\n## Counter-case/, "## Contested / Unknown\n- None - the picture is settled and every source agrees on every number.\n\n## Counter-case");
  const r = ASSERTIONS.contested_nonempty.run(none);
  assert.equal(r.pass, false);
  assert.match(r.detail, /brief-2026-09-24\.md: Contested \/ Unknown says there is nothing contested/);
  const empty = researchCtx();
  empty.turns[1].agent.text = empty.turns[1].agent.text.replace(/## Contested \/ Unknown\n[\s\S]*?\n\n## Counter-case/, "## Contested / Unknown\n\n## Counter-case");
  assert.match(ASSERTIONS.contested_nonempty.run(empty).detail, /turn 2: Contested \/ Unknown is empty/);
  const tpl = researchCtx();
  tpl.turns[1].agent.text = tpl.turns[1].agent.text.replace(/## Contested \/ Unknown\n[\s\S]*?\n\n## Counter-case/, "## Contested / Unknown\n- <where sources disagree: both figures, both tiers> [source: x.md] and some more template words to pass the length check\n\n## Counter-case");
  assert.match(ASSERTIONS.contested_nonempty.run(tpl).detail, /still the template/);
});

test("assertions: brief_written checks the file, its sections, the brief.write event and delivery in the transcript", () => {
  const good = ASSERTIONS.brief_written.run(researchCtx());
  assert.equal(good.pass, true, good.detail);
  assert.match(good.detail, /phases seen: gauge -> plan -> research -> brief -> challenge/);

  const noFile = researchCtx();
  noFile.kb.briefs = [];
  assert.match(ASSERTIONS.brief_written.run(noFile).detail, /no brief-<YYYY-MM-DD>\.md/);

  const partial = researchCtx();
  partial.kb.briefs[0].content = partial.kb.briefs[0].content.replace("## Counter-case", "## Rebuttal");
  assert.match(ASSERTIONS.brief_written.run(partial).detail, /missing section\(s\) Counter-case/);

  const noEvent = researchCtx();
  noEvent.events = noEvent.events.filter((e) => e.event !== "brief.write");
  const r = ASSERTIONS.brief_written.run(noEvent);
  assert.match(r.detail, /no brief\.write trace event/);
  assert.match(r.detail, /no brief\.write event names it/);

  const badName = researchCtx();
  badName.events = badName.events.map((e) => (e.event === "brief.write" ? { ...e, data: { file: "brief.md" } } : e));
  assert.match(ASSERTIONS.brief_written.run(badName).detail, /not brief-YYYY-MM-DD\.md/);

  const fileOnly = researchCtx();
  fileOnly.turns[1].agent.text = "I wrote the brief to the topic folder. Want to see it?";
  assert.match(ASSERTIONS.brief_written.run(fileOnly).detail, /no agent turn contains the brief/);
});

test("assertions: max_paragraphs_without_question gives the brief turn the brief_n budget in research mode only, and it must end with a question", () => {
  const long = "word ".repeat(30).trim() + ".";
  const briefTurn = ["## Findings", long, long, long, long, long, "## Numbers\n| Value | What | Date | Source file | Tier |\n|---|---|---|---|---|\n| 1 | " + long + " | 2024 | [source: market-size.md] | 1 |", "## Contested / Unknown", long, "## Counter-case", long, "Does the counter-case change your hypothesis?"].join("\n\n");
  const ctx = researchCtx();
  ctx.turns[1].agent.text = briefTurn;
  assert.equal(ASSERTIONS.max_paragraphs_without_question.run(ctx, {}).pass, true, ASSERTIONS.max_paragraphs_without_question.run(ctx, {}).detail);
  assert.equal(ASSERTIONS.max_paragraphs_without_question.run(ctx, { brief_n: 4 }).pass, false, "a smaller brief budget from the fixture is honoured");
  const teach = researchCtx();
  teach.scenario.mode = "teach";
  teach.turns[1].agent.text = briefTurn;
  const rt = ASSERTIONS.max_paragraphs_without_question.run(teach, {});
  assert.equal(rt.pass, false, "outside research mode a long brief is still lecturing");
  assert.match(rt.detail, /budget 3\)/);
  const noClose = researchCtx();
  noClose.turns[1].agent.text = briefTurn.replace("\n\nDoes the counter-case change your hypothesis?", "");
  const rn = ASSERTIONS.max_paragraphs_without_question.run(noClose, {});
  assert.equal(rn.pass, false);
  assert.match(rn.detail, /does not end with a question/);
});

test("assertions: sources_credibility does not demand a Technical Facts section of entity files", () => {
  const r = ASSERTIONS.sources_credibility.run(researchCtx(), {});
  assert.equal(r.pass, true, r.detail);
  const ctx = researchCtx();
  ctx.kb.files["market-size.md"] = "# Market size\n\nNothing cited.\n";
  assert.match(ASSERTIONS.sources_credibility.run(ctx, {}).detail, /market-size\.md references no High-credibility source/);
});

test("fixtures: mode is validated, defaults to teach, and the research fixtures carry the research assertions", () => {
  const base = { name: "x", domain: "d", level: "beginner", topic: "t", slug: "t", persona: "a persona long enough to pass validation", turns: ["a", "b"] };
  const file = "/tmp/d/x.yaml";
  assert.deepEqual(validateFixture({ ...base, mode: "research", brief_paragraphs: 10 }, file), []);
  assert.ok(validateFixture({ ...base, mode: "brief" }, file).some((e) => /mode must be one of/.test(e)));
  assert.ok(validateFixture({ ...base, brief_paragraphs: "ten" }, file).some((e) => /brief_paragraphs must be a number/.test(e)));
  const research = loadFixtures().filter((s) => s.mode === "research");
  assert.ok(research.length >= 2, "expected at least two research-mode fixtures");
  assert.ok(research.every((s) => s.domain === "market-research"));
  for (const s of research) {
    for (const name of ["gauge_first", "numbers_table_tiered", "contested_nonempty", "brief_written", "no_paywalled_as_fact", "first_vs_third_party"]) assert.ok(s.assertions.some((a) => a.name === name), `${s.id}: missing ${name}`);
    assert.match(s.turns[1].say, /hypothesis/i, `${s.id}: the second learner turn must state the hypothesis (the answer to the gauging question)`);
    assert.match(s.turns[1].say, /evidence/i, `${s.id}: the second learner turn must say what evidence the learner already has`);
  }
  assert.ok(research.some((s) => Object.keys(s.seed).includes("learner.md") && /## Venture context\n- Building:/.test(s.seed["learner.md"])), "one research fixture must seed learner.md with venture context");
  assert.ok(research.some((s) => !Object.keys(s.seed).length), "one research fixture must start with no memory");
  for (const s of loadFixtures().filter((x) => x.mode !== "research")) assert.equal(s.mode, "teach");
});

test("driver: the harness note announces /research only in research mode", () => {
  const research = harnessSystemPrompt({ kbRoot: "/tmp/kb", slug: "x", mode: "research" });
  assert.match(research, /opened with the \/research command/);
  assert.match(research, /\/tmp\/kb\/x\/brief-<YYYY-MM-DD>\.md/);
  assert.doesNotMatch(harnessSystemPrompt({ kbRoot: "/tmp/kb", slug: "x" }), /\/research/);
  assert.ok(buildArgs({ sessionId: "sid", resume: false, kbRoot: "/tmp/kb", slug: "x", mode: "research" }).some((a) => /opened with the \/research command/.test(a)));
});

test("trace-summary: brief.write and phases are summarised", () => {
  const s = summarise(allEvents(loadKb(researchKb(), "uk-kyb")));
  assert.deepEqual(s.briefs_written, ["brief-2026-09-24.md"]);
  assert.deepEqual(s.phases, ["gauge", "plan", "research", "brief", "challenge"]);
  assert.equal(s.counts["brief.write"], 1);
});

test("kb: citations may name an entity file one directory deep", () => {
  const { CITATION_FILE_RE } = awaitImportRepo();
  assert.ok(CITATION_FILE_RE.test("companies/acme-verify.md"));
  assert.ok(CITATION_FILE_RE.test("market-size.md"));
  assert.ok(!CITATION_FILE_RE.test("a/b/c.md"), "two levels deep is not a KB path");
  assert.ok(!CITATION_FILE_RE.test("/etc/passwd.md"));
});

test("kb: credibility cells with qualifiers normalise to the bare rating; junk does not", () => {
  assert.equal(normaliseCredibility("High (official docs)"), "High");
  assert.equal(normaliseCredibility("**medium**"), "Medium");
  assert.equal(normaliseCredibility("Medium-High (detailed)"), "Medium");
  assert.equal(normaliseCredibility("Excellent"), "Excellent");
});

test("assertions: max_paragraphs_without_question ignores short transitions and headings", () => {
  const ctx = syntheticCtx();
  const long = "word ".repeat(30).trim() + ".";
  ctx.turns[1].agent.text = ["Okay, here is the grounded version.", "**Layer 1**", long, long, long, "Check: what happens next?"].join("\n\n");
  assert.equal(ASSERTIONS.max_paragraphs_without_question.run(ctx, { n: 3 }).pass, true);
  ctx.turns[1].agent.text = [long, long, long, long, "Check: what happens next?"].join("\n\n");
  assert.equal(ASSERTIONS.max_paragraphs_without_question.run(ctx, { n: 3 }).pass, false);
});

test("kb: a concept file may reference a source by URL, title or distinctive hostname, but not a generic host", () => {
  const rows = parseSourcesTable("| URL | Title | Date Accessed | Credibility | Summary |\n|---|---|---|---|---|\n| https://docs.python.org/3/x.html | Time complexity | 2026-09-24 | High | s |\n| https://medium.com/@someone/post | A Post | 2026-09-24 | Low | s |\n");
  assert.equal(referencesAnyRow("**Sources used:** docs.python.org time-complexity page", rows).length, 1);
  assert.equal(referencesAnyRow("**Sources used:** something on medium.com", rows).length, 0);
  assert.equal(referencesAnyRow("see https://docs.python.org/3/x.html", rows).length, 1);
  assert.equal(referencesAnyRow("nothing relevant", rows).length, 0);
});

test("kb: the current sources layout parses by header; Tier maps to credibility, Accessed is the date, Related-to is kept", () => {
  const kb = loadKb(syntheticKb(), "hash-tables");
  assert.equal(kb.sources.length, 2);
  const [primary, neighbour] = kb.sources;
  assert.deepEqual(
    { url: primary.url, type: primary.type, domain: primary.domain, tier: primary.tier, credibility: primary.credibility, date: primary.date, published: primary.published, relatedTo: primary.relatedTo },
    { url: "https://docs.python.org/3/faq/design.html", type: "docs", domain: "cs", tier: "1", credibility: "High", date: "2026-09-24", published: "unknown", relatedTo: "" },
  );
  assert.equal(neighbour.credibility, "Low");
  assert.equal(neighbour.relatedTo, "https://docs.python.org/3/faq/design.html");
  assert.match(neighbour.summary, /not yet read/);
  assert.equal(tierToCredibility("2"), "High");
  assert.equal(tierToCredibility("3"), "Medium");
  assert.equal(tierToCredibility("5"), "Low");
  assert.equal(tierToCredibility("?"), null, "a pending tier is not a rating");
  const bad = parseSourcesTable("| URL | Title | Type | Domain | Tier | Published | Accessed | Related-to | Summary |\n|---|---|---|---|---|---|---|---|---|\n| https://a.example | A | paper | cs | High | unknown | 2026-09-24 | | s |\n");
  assert.equal(bad[0].credibility, "High", "a legacy word in the Tier cell is still understood only if it is a rating word");
  const junk = parseSourcesTable("| URL | Title | Type | Domain | Tier | Published | Accessed | Related-to | Summary |\n|---|---|---|---|---|---|---|---|---|\n| https://a.example | A | paper | cs | ? | unknown | 2026-09-24 | | s |\n");
  assert.equal(junk[0].credibility, "?", "an unparseable tier is returned as written so sources_credibility fails");
});

test("kb: the legacy sources layout (Date Accessed | Credibility) still parses, with and without a header row", () => {
  const withHeader = parseSourcesTable("| URL | Title | Date Accessed | Credibility | Summary |\n|---|---|---|---|---|\n| https://a.example | A | 2026-09-24 | Medium (textbook) | s |\n");
  assert.deepEqual([withHeader[0].date, withHeader[0].credibility, withHeader[0].summary, withHeader[0].tier], ["2026-09-24", "Medium", "s", ""]);
  const noHeader = parseSourcesTable("| https://a.example | A | 2026-09-24 | Low | one | two |\n");
  assert.deepEqual([noHeader[0].date, noHeader[0].credibility, noHeader[0].summary], ["2026-09-24", "Low", "one | two"]);
});

test("assertions: sources_credibility and numeric_claims_cited work on the current layout (tier-derived ratings)", () => {
  const ctx = syntheticCtx();
  assert.equal(ASSERTIONS.sources_credibility.run(ctx, {}).pass, true);
  ctx.turns[1].agent.text = "Python dicts resize at 2/3 load [source: hash-collisions.md]. What triggers the resize?";
  assert.equal(ASSERTIONS.numeric_claims_cited.run(ctx, {}).pass, true, "a Tier 1 row counts as High-credibility backing");
  const ctx2 = syntheticCtx();
  ctx2.kb.sources[0].tier = "4";
  ctx2.kb.sources[0].credibility = "Low";
  assert.match(ASSERTIONS.sources_credibility.run(ctx2, {}).detail, /no High-credibility/);
});

test("kb: sources table parser handles markdown links and skips header rows", () => {
  const rows = parseSourcesTable("| URL | Title | Date Accessed | Credibility | Summary |\n|---|---|---|---|---|\n| [NICE NG136](https://www.nice.org.uk/guidance/ng136) | Hypertension | 2026-09-24 | High | Guideline |\n");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, "https://www.nice.org.uk/guidance/ng136");
  assert.equal(rows[0].credibility, "High");
});
