// Content rules for the prompt/skill text itself. These are the product; a
// wording change that breaks one of these is a regression, not a style nit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORMS, PROMPT_FILES, CITATION_RE, CITATION_FILE_RE, CITATION_PLACEHOLDERS, read } from "../lib/repo.mjs";
import { parseFrontmatter } from "../lib/frontmatter.mjs";
import { SOURCES_COLUMNS } from "../scenarios/lib/kb.mjs";

const TRACE_EVENTS = [
  "session.start",
  "gate.check",
  "research.query",
  "research.fetch",
  "research.fanout",
  "kb.write",
  "teach",
  "check.ask",
  "check.verdict",
  "phase",
  "memory.read",
  "memory.write",
  "session.end",
];

// Wording that would let memory stand in for the opening gauging question.
// Any line that pairs memory/profile with replacing or skipping the question
// must carry a negation.
const MEMORY_REPLACES_QUESTION_RE = /\b(memory|profile|learner\.md|progress\.md)\b.*\b(replace[sd]?|instead of|in place of|in lieu of|stand[s]? in for|substitute[sd]? for)\b.*\b(question|probe|probing|gauging)\b/i;
const NEGATION_RE = /\b(never|do not|don't|must not|not|cannot)\b/i;

for (const file of PROMPT_FILES) {
  test(`${file}: every [source: ...] uses the documented format`, () => {
    const body = parseFrontmatter(read(file)).body;
    for (const m of body.matchAll(CITATION_RE)) {
      const ref = m[1];
      const ok = CITATION_FILE_RE.test(ref) || CITATION_PLACEHOLDERS.has(ref);
      assert.ok(ok, `${file}: '[source: ${ref}]' is not '[source: <name>.md]' (allowed placeholders: ${[...CITATION_PLACEHOLDERS].join(", ")})`);
    }
  });

  test(`${file}: nothing tells the model to skip the probing question`, () => {
    const lines = parseFrontmatter(read(file)).body.split("\n");
    lines.forEach((line, i) => {
      if (/\bskip\b.*\b(probing|gauging|initial|opening)\b.*\bquestion/i.test(line) || /\bwithout\b.*\bprobing question/i.test(line)) {
        assert.match(line, NEGATION_RE, `${file}:${i + 1} appears to permit skipping the probing question: ${line.trim()}`);
      }
    });
  });

  test(`${file}: nothing lets memory replace the gauging question`, () => {
    const lines = parseFrontmatter(read(file)).body.split("\n");
    lines.forEach((line, i) => {
      if (MEMORY_REPLACES_QUESTION_RE.test(line)) {
        assert.match(line, NEGATION_RE, `${file}:${i + 1} appears to let memory replace the gauging question: ${line.trim()}`);
      }
      // "if memory exists / the profile says ... skip" is the other way to say it.
      if (/\b(memory|profile|learner\.md|progress\.md)\b.*\bskip\b/i.test(line) && /\b(question|probe|probing|gauging|fundamentals|basics)\b/i.test(line)) {
        assert.match(line, NEGATION_RE, `${file}:${i + 1} appears to let memory skip the gauging step: ${line.trim()}`);
      }
    });
  });
}

for (const [name, platform] of Object.entries(PLATFORMS)) {
  test(`${name}: agent prompt keeps the probing-question rule and the citation rule`, () => {
    const body = parseFrontmatter(read(platform.agent)).body;
    assert.match(body, /NEVER skip the initial probing question/);
    assert.match(body, /Question Before You Teach/);
    assert.match(body, /NEVER state a non-trivial fact without a citation in the format `\[source: filename\.md\]`/);
    assert.match(body, /ALWAYS run `learning-assessment`/);
  });

  test(`${name}: agent prompt defines learner memory and pins that it never replaces the gauging question`, () => {
    const body = parseFrontmatter(read(platform.agent)).body;
    assert.match(body, /# Learner Memory/);
    assert.ok(body.includes(`\`${platform.kbPath}/learner.md\``), "learner.md must live at the platform KB root");
    assert.ok(body.includes(`\`${platform.kbPath}/<topic-slug>/progress.md\``), "progress.md must live in the topic folder");
    assert.match(body, /Memory never replaces the gauging question/, "the prompt must state that memory never replaces the gauging question");
    assert.match(body, /Memory is a prior; the answer is the evidence/);
    assert.match(body, /resume -> recall check on prior concepts -> continue/i, "returning-learner flow missing");
    for (const control of ['"faster"', '"slower"', '"skip"', '"I already know this"']) assert.ok(body.includes(control), `pacing control ${control} missing`);
    assert.match(body, /verification question, never a skip/, '"I already know this" must trigger a verification question');
    assert.match(body, /One concept, one check, one verdict/);
    assert.match(body, /## Venture context/, "learner.md template must carry a Venture context section");
    assert.match(body, /after each synthesis checkpoint\*\* and \*\*at session end/, "memory update points must be after synthesis and at session end");
    assert.match(body, /never a personality trait/i, "entries must be factual, not inferred traits");
  });

  test(`${name}: agent prompt documents tracing with the full event vocabulary`, () => {
    const body = parseFrontmatter(read(platform.agent)).body;
    assert.match(body, /# Session Tracing/);
    assert.ok(body.includes(`${platform.kbPath}/.traces/<topic-slug>/`), "trace path must be under the platform KB root");
    for (const ev of TRACE_EVENTS) assert.ok(body.includes("`" + ev + "`"), `agent prompt does not document trace event ${ev}`);
    assert.match(body, /LEARNING_KB_ROOT/, "agent prompt must honour the LEARNING_KB_ROOT override");
  });

  test(`${name}: skills emit their trace events`, () => {
    const [assessment, research] = platform.skills.map((f) => parseFrontmatter(read(f)).body);
    assert.match(assessment, /"event":"gate\.check"/);
    assert.match(assessment, /LEARNING_KB_ROOT/);
    for (const ev of ["research.query", "research.fetch", "research.fanout", "kb.write"]) assert.ok(research.includes("`" + ev + "`"), `research skill does not emit ${ev}`);
    assert.match(research, /LEARNING_KB_ROOT/);
  });

  test(`${name}: skills keep the iron law and the three research angles`, () => {
    const [assessment, research] = platform.skills.map((f) => parseFrontmatter(read(f)).body);
    assert.match(assessment, /NO CLAIM WITHOUT A SOURCE\. NO SOURCE WITHOUT A FILE\./);
    assert.match(research, /Angle 1: Technical Accuracy/);
    assert.match(research, /Angle 2: Expert Mindset/);
    assert.match(research, /Angle 3: Contested and Uncertain/);
    const header = `| ${SOURCES_COLUMNS.join(" | ")} |`;
    assert.ok(research.includes(header), `sources.md table header must be exactly '${header}' (SOURCES_COLUMNS in tests/scenarios/lib/kb.mjs); change the skill and the parser together`);
    assert.match(research, /## Contested \/ Uncertain/);
  });
}
