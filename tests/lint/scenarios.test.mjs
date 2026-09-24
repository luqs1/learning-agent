// Scenario fixtures and the deterministic assertions are checked here without
// any model call, so a broken fixture or a regression in an assertion fails
// `npm test` rather than a nightly run.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listFixtureFiles, loadFixture, loadFixtures } from "../scenarios/lib/fixtures.mjs";
import { ASSERTIONS, CORE_ASSERTIONS } from "../scenarios/lib/assertions.mjs";
import { loadKb, allEvents, parseSourcesTable, paragraphs, normaliseCredibility } from "../scenarios/lib/kb.mjs";
import { buildArgs, harnessSystemPrompt } from "../scenarios/lib/driver.mjs";

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

| URL | Title | Date Accessed | Credibility | Summary |
|-----|-------|---------------|-------------|---------|
| https://docs.python.org/3/faq/design.html | Python Design FAQ | 2026-09-24 | High | Official docs on dict implementation |
| https://example.com/blog | Someone's blog | 2026-09-24 | Low | Secondary summary |
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
      '{"ts":"2026-09-24T10:01:00Z","event":"kb.write","data":{"file":"hash-collisions.md"}}',
      '{"ts":"2026-09-24T10:02:00Z","event":"teach","data":{"concept":"hash-collisions","citations":["hash-collisions.md"]}}',
      '{"ts":"2026-09-24T10:03:00Z","event":"check.verdict","data":{"concept":"hash-collisions","verdict":"wrong","action":"correct"}}',
    ].join("\n") + "\n",
  );
  return root;
}

function syntheticCtx(overrides = {}) {
  const root = syntheticKb();
  const kb = loadKb(root, "hash-tables");
  const t = (ms) => Date.parse("2026-09-24T10:00:00Z") + ms;
  const turns = [
    { learner: "teach me", agent: { text: "Before we start - what is your current mental model of a dict?", startedAt: t(0), endedAt: t(3000) } },
    { learner: "a list", agent: { text: "A hash function maps a key to a slot [source: hash-collisions.md].\n\nCollisions are unavoidable [source: hash-collisions.md].\n\nWhat happens when two keys share a slot?", startedAt: t(60_000), endedAt: t(130_000) } },
    { learner: "never happens", expect: "correction", agent: { text: "Not quite - collisions always happen. Why?", startedAt: t(170_000), endedAt: t(190_000) } },
  ];
  return { scenario: { slug: "hash-tables" }, turns, kb, events: allEvents(kb), judge: async () => ({ pass: true, reasoning: "stub", evidence: [] }), ...overrides };
}

test("assertions: a well-formed synthetic run passes every deterministic core assertion", async () => {
  const ctx = syntheticCtx();
  for (const name of CORE_ASSERTIONS) {
    const r = await ASSERTIONS[name].run(ctx, {});
    assert.ok(r.pass, `${name} failed on a good run: ${r.detail}`);
  }
  assert.ok((await ASSERTIONS.contested_populated.run(ctx, {})).pass);
});

test("assertions: no_trace_narration fails when the agent talks about the trace", () => {
  const ctx = syntheticCtx();
  ctx.turns[0].agent.text = "Good, the trace is set up. What is your mental model?";
  const r = ASSERTIONS.no_trace_narration.run(ctx, {});
  assert.equal(r.pass, false);
  assert.match(r.detail, /turn 1/);
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

test("kb: sources table parser handles markdown links and skips header rows", () => {
  const rows = parseSourcesTable("| URL | Title | Date Accessed | Credibility | Summary |\n|---|---|---|---|---|\n| [NICE NG136](https://www.nice.org.uk/guidance/ng136) | Hypertension | 2026-09-24 | High | Guideline |\n");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, "https://www.nice.org.uk/guidance/ng136");
  assert.equal(rows[0].credibility, "High");
});
