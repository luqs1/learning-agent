// The claude/ and opencode/ trees are near-duplicates. This test diffs them
// and fails on any difference other than the documented allowed ones:
//   1. the knowledge-base path
//   2. the agent frontmatter keys (claude: name/description/skills; opencode: description/mode/color)
//   3. the `learn` slash command, which exists only under claude/
//   4. `user-invocable: false`, which only the claude skill copies carry
//   5. `allowed-tools`, which only the claude learning-research copy carries
//      (it pre-approves its bundled scripts; opencode has no equivalent key)
//   6. bundled-script paths: claude writes `${CLAUDE_SKILL_DIR}/scripts/x.sh`
//      (substituted by Claude Code), opencode writes `scripts/x.sh` (relative
//      to the base directory its skill tool prints)
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORMS, MIRRORED, PLATFORM_ONLY, SKILL_SCRIPTS_PREFIX, listFiles, read } from "../lib/repo.mjs";
import { parseFrontmatter } from "../lib/frontmatter.mjs";

const KB_TOKEN = "<KB-ROOT>";

function normaliseBody(text, kbPath) {
  return text.split(kbPath).join(KB_TOKEN).split(SKILL_SCRIPTS_PREFIX).join("scripts");
}

function firstDiff(a, b) {
  const la = a.split("\n");
  const lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) return `line ${i + 1}:\n  claude:   ${JSON.stringify(la[i])}\n  opencode: ${JSON.stringify(lb[i])}`;
  }
  return "";
}

for (const [claudeFile, opencodeFile] of MIRRORED) {
  test(`parity: ${claudeFile} == ${opencodeFile} (modulo KB path and frontmatter)`, () => {
    const c = parseFrontmatter(read(claudeFile));
    const o = parseFrontmatter(read(opencodeFile));
    assert.ok(c.ok && o.ok, "both files must have valid frontmatter");
    const cb = normaliseBody(c.body, PLATFORMS.claude.kbPath);
    const ob = normaliseBody(o.body, PLATFORMS.opencode.kbPath);
    assert.equal(cb, ob, `bodies differ beyond the KB path; first difference at ${firstDiff(cb, ob)}`);
    assert.ok(cb.includes(KB_TOKEN), "expected at least one KB path mention so the platform difference is real");
    // Neither tree may contain the other platform's KB path.
    assert.ok(!c.body.includes(PLATFORMS.opencode.kbPath), `${claudeFile} mentions the opencode KB path`);
    assert.ok(!o.body.includes(PLATFORMS.claude.kbPath), `${opencodeFile} mentions the claude KB path`);
    assert.ok(!o.body.includes(SKILL_SCRIPTS_PREFIX), `${opencodeFile} uses the Claude-only ${SKILL_SCRIPTS_PREFIX} prefix (opencode does not substitute it)`);
  });

  test(`parity: ${claudeFile} frontmatter differs from ${opencodeFile} only in the allowed keys`, () => {
    const c = parseFrontmatter(read(claudeFile)).frontmatter;
    const o = parseFrontmatter(read(opencodeFile)).frontmatter;
    const isAgent = claudeFile.endsWith("agents/learning.md");
    const allowedOnlyClaude = isAgent ? new Set(["name", "skills"]) : new Set(["user-invocable", "allowed-tools"]);
    const allowedOnlyOpencode = isAgent ? new Set(["mode", "color"]) : new Set();
    for (const k of Object.keys(c)) {
      if (!(k in o)) assert.ok(allowedOnlyClaude.has(k), `key '${k}' exists only in ${claudeFile}`);
      else assert.deepEqual(c[k], o[k], `frontmatter key '${k}' differs between trees`);
    }
    for (const k of Object.keys(o)) {
      if (!(k in c)) assert.ok(allowedOnlyOpencode.has(k), `key '${k}' exists only in ${opencodeFile}`);
    }
  });
}

test("parity: the file sets of both trees match except for platform-only files", () => {
  const strip = (files, dir) => files.map((f) => f.slice(dir.length + 1));
  const claude = strip(listFiles("claude"), "claude").filter((f) => !PLATFORM_ONLY.claude.includes(`claude/${f}`));
  const opencode = strip(listFiles("opencode"), "opencode").filter((f) => !PLATFORM_ONLY.opencode.includes(`opencode/${f}`));
  assert.deepEqual(claude, opencode, "a file exists in one tree but not the other; mirror it or add it to PLATFORM_ONLY in tests/lib/repo.mjs");
});

test("parity: the learn slash command exists only under claude/", () => {
  assert.ok(listFiles("claude").includes("claude/skills/learn/SKILL.md"));
  assert.ok(!listFiles("opencode").some((f) => f.includes("/learn/")));
});
