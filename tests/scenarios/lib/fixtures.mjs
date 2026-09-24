// Scenario fixture loading and validation.
//
// A scenario is one YAML file at tests/scenarios/<domain>/<name>.yaml. Adding a
// scenario means adding one such file; nothing else needs to change.
//
// Schema (see tests/README.md for the prose version):
//   name:        <string>   must equal the file name without .yaml
//   domain:      <string>   must equal the parent directory name
//   level:       beginner | intermediate | advanced
//   topic:       <string>   what the learner wants to learn (free text)
//   slug:        <kebab-case>  the topic slug the agent is told to use
//   persona:     <string>   who the learner is (for fixture authors and judges)
//   turns:       list of learner turns, in order. Each is a string, or a map:
//                  say: <string>          what the learner types
//                  expect: correction     this answer is wrong on purpose; the
//                                         agent's reply must correct, not advance
//                  note: <string>         free text for humans
//   assertions:  list of extra assertions (string, or map with name + params)
//                on top of the CORE set applied to every scenario.
//   seed:        optional map of <relative path under the KB root> -> file
//                content, written into LEARNING_KB_ROOT before the first turn
//                (e.g. learner.md, <slug>/progress.md) to simulate a returning
//                learner. Paths are relative, no `..`, no leading `/` or `.`.
//   mode:        teach (default) | research. `research` means the session is
//                opened as /research would open it (the harness note says so);
//                trace_written expects brief.write instead of teach, and the
//                brief turn gets the larger paragraph budget in
//                max_paragraphs_without_question (see brief_paragraphs).
//   brief_paragraphs: paragraph budget for the brief turn in research mode
//                (default 12; the turn must still end with a question).
//   model, judge_model, max_paragraphs, budget_usd: optional overrides.

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../../lib/repo.mjs";
import { parseYaml } from "../../lib/yaml.mjs";
import { ASSERTIONS, CORE_ASSERTIONS } from "./assertions.mjs";

export const SCENARIO_DIR = path.join(ROOT, "tests", "scenarios");
export const LEVELS = ["beginner", "intermediate", "advanced"];
export const EXPECTATIONS = ["correction", "advance"];
export const MODES = ["teach", "research"];

export function listFixtureFiles() {
  const out = [];
  for (const entry of fs.readdirSync(SCENARIO_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "lib") continue;
    const dir = path.join(SCENARIO_DIR, entry.name);
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".yaml") || f.endsWith(".yml")) out.push(path.join(dir, f));
    }
  }
  return out.sort();
}

export function loadFixture(file) {
  const doc = parseYaml(fs.readFileSync(file, "utf8"));
  const errors = validateFixture(doc, file);
  if (errors.length) throw new Error(`invalid scenario ${path.relative(ROOT, file)}:\n  - ${errors.join("\n  - ")}`);
  return normalise(doc, file);
}

export function loadFixtures({ only, domain } = {}) {
  return listFixtureFiles()
    .filter((f) => !domain || path.basename(path.dirname(f)) === domain)
    .filter((f) => !only || path.relative(SCENARIO_DIR, f).includes(only))
    .map(loadFixture);
}

export function validateFixture(doc, file) {
  const errors = [];
  const expectName = path.basename(file).replace(/\.ya?ml$/, "");
  const expectDomain = path.basename(path.dirname(file));
  if (!doc || typeof doc !== "object") return ["fixture is not a mapping"];
  if (doc.name !== expectName) errors.push(`name must be '${expectName}' (the file name)`);
  if (doc.domain !== expectDomain) errors.push(`domain must be '${expectDomain}' (the directory name)`);
  if (!LEVELS.includes(doc.level)) errors.push(`level must be one of ${LEVELS.join(", ")}`);
  if (typeof doc.topic !== "string" || !doc.topic.trim()) errors.push("topic is required");
  if (typeof doc.slug !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(doc.slug)) errors.push("slug must be kebab-case");
  if (typeof doc.persona !== "string" || doc.persona.trim().length < 20) errors.push("persona must be a short paragraph");
  if (!Array.isArray(doc.turns) || doc.turns.length < 2) errors.push("turns must be a list with at least two learner turns");
  else {
    doc.turns.forEach((t, i) => {
      const say = typeof t === "string" ? t : t?.say;
      if (typeof say !== "string" || !say.trim()) errors.push(`turns[${i}] needs text (a string or a map with 'say')`);
      if (t && typeof t === "object" && t.expect !== undefined && !EXPECTATIONS.includes(t.expect)) errors.push(`turns[${i}].expect must be one of ${EXPECTATIONS.join(", ")}`);
      if (i === 0 && t && typeof t === "object" && t.expect) errors.push("turns[0] is the opening message and cannot carry an expectation");
    });
  }
  if (doc.assertions !== undefined) {
    if (!Array.isArray(doc.assertions)) errors.push("assertions must be a list");
    else {
      doc.assertions.forEach((a, i) => {
        const name = typeof a === "string" ? a : a?.name;
        if (!name || !ASSERTIONS[name]) errors.push(`assertions[${i}]: unknown assertion '${name}' (known: ${Object.keys(ASSERTIONS).join(", ")})`);
      });
    }
  }
  for (const key of ["max_paragraphs", "brief_paragraphs", "budget_usd"]) {
    if (doc[key] !== undefined && typeof doc[key] !== "number") errors.push(`${key} must be a number`);
  }
  if (doc.mode !== undefined && !MODES.includes(doc.mode)) errors.push(`mode must be one of ${MODES.join(", ")}`);
  if (doc.seed !== undefined) errors.push(...validateSeed(doc.seed));
  return errors;
}

export const SEED_PATH_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*(\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/;

export function validateSeed(seed) {
  if (!seed || typeof seed !== "object" || Array.isArray(seed)) return ["seed must be a map of <relative path> -> <file content>"];
  const errors = [];
  for (const [p, content] of Object.entries(seed)) {
    if (!SEED_PATH_RE.test(p) || p.split("/").includes("..")) errors.push(`seed path '${p}' must be a relative path under the KB root (no '..', no leading '/' or '.')`);
    if (typeof content !== "string" || !content.trim()) errors.push(`seed['${p}'] must be non-empty file content (use a | block scalar)`);
  }
  return errors;
}

/** Write a fixture's seed files under the run's KB root. Returns the paths written. */
export function writeSeed(kbRoot, seed = {}) {
  const written = [];
  for (const [rel, content] of Object.entries(seed)) {
    const target = path.join(kbRoot, rel);
    if (!target.startsWith(path.resolve(kbRoot) + path.sep)) throw new Error(`seed path escapes the KB root: ${rel}`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    written.push(rel);
  }
  return written;
}

function normalise(doc, file) {
  const turns = doc.turns.map((t) => (typeof t === "string" ? { say: t } : { say: t.say, expect: t.expect, note: t.note }));
  const extra = (doc.assertions || []).map((a) => (typeof a === "string" ? { name: a } : { ...a }));
  const assertions = [...CORE_ASSERTIONS.map((name) => ({ name })), ...extra.filter((a) => !CORE_ASSERTIONS.includes(a.name))];
  // A core assertion listed explicitly with params overrides the default params.
  for (const a of extra) {
    if (CORE_ASSERTIONS.includes(a.name)) Object.assign(assertions.find((x) => x.name === a.name), a);
  }
  if (doc.max_paragraphs !== undefined) assertions.find((a) => a.name === "max_paragraphs_without_question").n = doc.max_paragraphs;
  if (doc.brief_paragraphs !== undefined) assertions.find((a) => a.name === "max_paragraphs_without_question").brief_n = doc.brief_paragraphs;
  return {
    file,
    id: `${doc.domain}/${doc.name}`,
    name: doc.name,
    domain: doc.domain,
    level: doc.level,
    mode: doc.mode || "teach",
    topic: doc.topic.trim(),
    slug: doc.slug,
    persona: doc.persona.trim(),
    turns,
    assertions,
    seed: doc.seed || {},
    model: doc.model,
    judge_model: doc.judge_model,
    budget_usd: doc.budget_usd,
  };
}
