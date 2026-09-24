// Content rules for the prompt/skill text itself. These are the product; a
// wording change that breaks one of these is a regression, not a style nit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORMS, PROMPT_FILES, CITATION_RE, CITATION_FILE_RE, CITATION_PLACEHOLDERS, read } from "../lib/repo.mjs";
import { parseFrontmatter } from "../lib/frontmatter.mjs";

const TRACE_EVENTS = [
  "session.start",
  "gate.check",
  "research.query",
  "research.fetch",
  "kb.write",
  "teach",
  "check.ask",
  "check.verdict",
  "phase",
  "session.end",
];

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
        assert.match(line, /\b(never|do not|don't|must not|not)\b/i, `${file}:${i + 1} appears to permit skipping the probing question: ${line.trim()}`);
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
    for (const ev of ["research.query", "research.fetch", "kb.write"]) assert.ok(research.includes("`" + ev + "`"), `research skill does not emit ${ev}`);
    assert.match(research, /LEARNING_KB_ROOT/);
  });

  test(`${name}: skills keep the iron law and the three research angles`, () => {
    const [assessment, research] = platform.skills.map((f) => parseFrontmatter(read(f)).body);
    assert.match(assessment, /NO CLAIM WITHOUT A SOURCE\. NO SOURCE WITHOUT A FILE\./);
    assert.match(research, /Angle 1: Technical Accuracy/);
    assert.match(research, /Angle 2: Expert Mindset/);
    assert.match(research, /Angle 3: Contested and Uncertain/);
    assert.match(research, /\| URL \| Title \| Date Accessed \| Credibility \| Summary \|/, "sources.md table header changed; update tests/scenarios/lib/kb.mjs too");
    assert.match(research, /## Contested \/ Uncertain/);
  });
}
