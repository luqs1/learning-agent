// Self-tests for the zero-dependency helpers the harness relies on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYaml } from "../lib/yaml.mjs";
import { parseFrontmatter } from "../lib/frontmatter.mjs";
import { parseTrace, summarise } from "../../scripts/trace-summary.mjs";

test("yaml: maps, lists, block scalars, flow sequences, comments", () => {
  const doc = parseYaml(`
# comment
name: hello
count: 3
flag: true
nothing: null
quoted: "a: b # not a comment"
single: 'it''s'
list: [a, b, 2]
persona: |
  Line one
  Line two

  Line four
folded: >
  one
  two
turns:
  - plain item
  - say: wrong answer   # trailing comment
    expect: correction
  - say: "quoted"
nested:
  inner:
    deep: yes
`);
  assert.equal(doc.name, "hello");
  assert.equal(doc.count, 3);
  assert.equal(doc.flag, true);
  assert.equal(doc.nothing, null);
  assert.equal(doc.quoted, "a: b # not a comment");
  assert.equal(doc.single, "it's");
  assert.deepEqual(doc.list, ["a", "b", 2]);
  assert.equal(doc.persona, "Line one\nLine two\n\nLine four\n");
  assert.equal(doc.folded, "one two\n");
  assert.deepEqual(doc.turns, ["plain item", { say: "wrong answer", expect: "correction" }, { say: "quoted" }]);
  assert.deepEqual(doc.nested, { inner: { deep: "yes" } });
});

test("yaml: unsupported syntax fails loudly with a line number", () => {
  assert.throws(() => parseYaml("a: 1\n  b: 2\n"), /line 2/);
  assert.throws(() => parseYaml("a: [1, 2\n"), /unterminated flow sequence/);
});

test("frontmatter: flat keys and a list key", () => {
  const fm = parseFrontmatter("---\nname: x\ndescription: \"d\"\nskills:\n  - a\n  - b\n---\nbody\n");
  assert.ok(fm.ok);
  assert.deepEqual(fm.frontmatter, { name: "x", description: "d", skills: ["a", "b"] });
  assert.deepEqual(fm.listKeys, ["skills"]);
  assert.equal(fm.body, "body\n");
  assert.equal(parseFrontmatter("no frontmatter").ok, false);
});

test("trace-summary: parses well-formed lines, reports malformed ones, summarises", () => {
  const { events, errors } = parseTrace(
    [
      '{"ts":"2026-01-01T00:00:00Z","event":"session.start","data":{"topic":"t","slug":"t"}}',
      "garbage",
      '{"ts":"2026-01-01T00:01:00Z","event":"gate.check","data":{"concept":"c","result":"fail","reason":"r"}}',
      '{"ts":"2026-01-01T00:02:00Z","event":"kb.write","data":{"file":"c.md"}}',
      '{"ts":"2026-01-01T00:03:00Z","event":"teach","data":{"concept":"c","citations":["c.md"]}}',
      '{"event":"missing-ts"}',
    ].join("\n"),
  );
  assert.equal(events.length, 4);
  assert.equal(errors.length, 2);
  const s = summarise(events);
  assert.equal(s.duration_s, 180);
  assert.deepEqual(s.concepts_taught, ["c"]);
  assert.equal(s.gate_fails, 1);
  assert.deepEqual(s.files_written, ["c.md"]);
});
