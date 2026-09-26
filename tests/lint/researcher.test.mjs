// Parallel research (#7): the one-angle researcher subagent exists in both
// trees, is registered on both platforms, and fanout.sh works. Everything here
// is local: no model, no network (fanout.sh is exercised with echo/sleep).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, PLATFORMS, RESEARCHER_AGENT, OPENCODE_PLUGIN, RESEARCH_SCRIPTS_DIR, SKILL_SCRIPTS_PREFIX, read, exists } from "../lib/repo.mjs";
import { parseFrontmatter } from "../lib/frontmatter.mjs";

const REQUIRED_TOOLS = ["Bash", "Read", "Write", "WebSearch", "WebFetch"];
const FORBIDDEN_TOOLS = ["Agent", "Task", "Edit"];
const FANOUT = path.join(ROOT, RESEARCH_SCRIPTS_DIR, "fanout.sh");

function splitTools(value) {
  return Array.isArray(value) ? value : String(value).split(",").map((s) => s.trim()).filter(Boolean);
}

for (const [name, platform] of Object.entries(PLATFORMS)) {
  test(`${name}: the researcher subagent exists with valid frontmatter and exactly the platform keys`, () => {
    assert.ok(exists(platform.subagent), `${platform.subagent} is missing`);
    const fm = parseFrontmatter(read(platform.subagent));
    assert.ok(fm.ok, `frontmatter errors in ${platform.subagent}: ${fm.errors?.join("; ")}`);
    assert.deepEqual(Object.keys(fm.frontmatter).sort(), [...platform.subagentFrontmatterKeys].sort());
    assert.ok(fm.frontmatter.description.length > 40, "description is too short");
    assert.match(fm.frontmatter.description, /angle/i, "description must say it works one angle");
  });

  test(`${name}: the researcher prompt is a one-angle worker that writes fragments and never launches subagents`, () => {
    const body = parseFrontmatter(read(platform.subagent)).body;
    assert.match(body, /one concept from one angle/i);
    assert.ok(body.includes(".research/"), "must write under <topic>/.research/");
    assert.match(body, /<concept-slug>-<angle>\.md/);
    assert.match(body, /sources-<angle>\.md/);
    assert.match(body, /Never launch subagents/);
    assert.match(body, /Never write or edit `sources\.md`, a concept file/, "the parent merges; the researcher must not write the merged files");
    for (const ev of ["research.query", "research.fetch", "kb.write"]) assert.ok(body.includes("`" + ev + "`"), `researcher does not emit ${ev}`);
    assert.match(body, /Never emit `research\.fanout`/, "only the parent emits research.fanout");
    assert.match(body, /iron law/i);
    assert.match(body, /read every source in full/i);
    assert.ok(body.includes(platform.kbPath), `must mention the ${name} knowledge-base root`);
    assert.match(body, /fanout\.sh/, "must fan out within its angle");
    assert.match(body, /Phase 3b: Fan-out/, "must verify the preloaded skill is the plugin copy");
    assert.match(body, /<Scripts dir>\/\.\.\/SKILL\.md/, "must know where to read the plugin skill from when a stale copy was preloaded");
    assert.doesNotMatch(body, /\[source: (?!filename\.md)[a-z-]+\.md\]/, "a researcher writes URL citations, not concept-file citations");
  });
}

test("claude: the researcher restricts its tools and preloads the research skill", () => {
  const fm = parseFrontmatter(read(PLATFORMS.claude.subagent));
  assert.equal(fm.frontmatter.name, RESEARCHER_AGENT);
  const tools = splitTools(fm.frontmatter.tools);
  for (const t of REQUIRED_TOOLS) assert.ok(tools.includes(t), `tools must include ${t} (has ${tools.join(", ")})`);
  for (const t of FORBIDDEN_TOOLS) assert.ok(!tools.includes(t), `tools must not include ${t}: a researcher never launches researchers or edits merged files`);
  assert.ok(tools.some((t) => t.startsWith("mcp__exa")), "Exa MCP tools should be allowed when present");
  assert.ok(tools.some((t) => t.startsWith("mcp__plugin_context7")), "context7 MCP tools should be allowed when present");
  assert.deepEqual(fm.listKeys, ["skills"]);
  assert.deepEqual(fm.frontmatter.skills, ["learning-research"], "the routing table must be preloaded");
});

test("opencode: the researcher is a flat-frontmatter subagent and the plugin registers it with task denied", async () => {
  const fm = parseFrontmatter(read(PLATFORMS.opencode.subagent));
  assert.deepEqual(fm.listKeys, [], "opencode frontmatter must be flat (the plugin loader only reads key: value)");
  assert.equal(fm.frontmatter.mode, "subagent");
  assert.match(fm.frontmatter.color, /^#[0-9A-Fa-f]{6}$/);
  const { LearningAgentPlugin } = await import(path.join(ROOT, OPENCODE_PLUGIN));
  const hooks = await LearningAgentPlugin({ client: null, directory: ROOT });
  const config = {};
  await hooks.config(config);
  assert.equal(config.agent.learning.mode, "primary");
  const researcher = config.agent[RESEARCHER_AGENT];
  assert.ok(researcher, `plugin does not register agent ${RESEARCHER_AGENT}`);
  assert.equal(researcher.mode, "subagent");
  assert.equal(researcher.permission?.task, "deny", "a researcher must not be able to launch researchers");
  assert.equal(researcher.prompt, fm.body.trim());
  assert.equal(researcher.description, fm.frontmatter.description);
  assert.ok(config.skills.paths.some((p) => p.endsWith(path.join("opencode", "skills"))));
});

test("the research skill launches the researcher by its platform identifiers and the agent prompt knows about the merge", () => {
  const skill = parseFrontmatter(read("claude/skills/learning-research/SKILL.md")).body;
  assert.match(skill, /subagent_type: "learning-agent:learning-researcher"/, "Claude Code plugin agents are addressed as <plugin>:<agent>");
  assert.match(skill, /subagent_type: "learning-researcher"/, "opencode addresses the agent by name");
  for (const p of Object.values(PLATFORMS)) {
    const agent = parseFrontmatter(read(p.agent)).body;
    assert.match(agent, /`learning-researcher`/);
    assert.match(agent, /research -> merge/);
    assert.match(agent, /`merge`/, "the phase vocabulary must include merge");
  }
});

// ---------- fanout.sh (no network) ----------

function fanout(args, { input, env } = {}) {
  return spawnSync("bash", [FANOUT, ...args], { encoding: "utf8", input, env: { ...process.env, ...env }, timeout: 30_000 });
}

test("fanout.sh: exists, is executable, --help exits 0 and documents the stagger table", () => {
  assert.ok(fs.existsSync(FANOUT), "fanout.sh is missing");
  if (process.platform !== "win32") assert.ok(fs.statSync(FANOUT).mode & 0o111, "fanout.sh is not executable");
  const r = fanout(["--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^usage: fanout\.sh/m);
  for (const host of ["arxiv", "gdelt", "reddit", "web.archive.org", "semanticscholar"]) assert.match(r.stdout, new RegExp(host, "i"), `--help does not list the ${host} stagger`);
  assert.match(r.stdout, /Output/);
  const skill = parseFrontmatter(read("claude/skills/learning-research/SKILL.md")).body;
  assert.ok(skill.includes(`${SKILL_SCRIPTS_PREFIX}/fanout.sh`), "the skill must call fanout.sh via the substituted prefix");
});

test("fanout.sh: runs commands concurrently, prints one JSON object per command in input order, reports exit codes", () => {
  const t0 = Date.now();
  const r = fanout(["--timeout", "10", "sleep 1; echo one", "echo two", "exit 3"]);
  const wall = Date.now() - t0;
  assert.equal(r.status, 1, "one command failed, so fanout exits 1");
  const rows = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((x) => x.i), [0, 1, 2]);
  assert.deepEqual(rows.map((x) => x.exit), [0, 0, 3]);
  assert.equal(rows[0].stdout.trim(), "one");
  assert.equal(rows[1].stdout.trim(), "two");
  assert.ok(rows[0].ms >= 900, "sleep 1 should take about a second");
  assert.ok(rows[1].ms < 900, "echo should not wait for the sleep (concurrent)");
  assert.ok(wall < 5000, `whole run took ${wall}ms; commands did not run concurrently`);
  for (const row of rows) for (const k of ["cmd", "host", "exit", "ms", "stdout", "stderr", "truncated"]) assert.ok(k in row, `row lacks ${k}`);
  assert.match(r.stderr, /3 commands, 1 failed/);
});

test("fanout.sh: reads commands from stdin, times out with exit 124, reports a missing command as 127, staggers same-host calls", () => {
  const r = fanout(["--timeout", "1"], { input: "sleep 5; echo late\nno-such-command-xyz\n# a comment line is ignored\n\n" });
  const rows = r.stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].exit, 124);
  assert.match(rows[0].stderr, /timed out/);
  assert.equal(rows[1].exit, 127);
  // Two calls to a host with a 3 s gap (arxiv) must start >= 3 s apart, even though the
  // script itself never runs (the token "arxiv.sh" decides the host; the command is a stub).
  const t0 = Date.now();
  // `--help` is local, so this exercises the host table and the gap without the network.
  const s = fanout(["--timeout", "10", "arxiv.sh --help", "arxiv.sh --help"]);
  const rowsS = s.stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(rowsS.map((x) => x.host), ["export.arxiv.org", "export.arxiv.org"]);
  assert.deepEqual(rowsS.map((x) => x.exit), [0, 0]);
  assert.ok(Date.now() - t0 >= 2900, "same-host calls must be staggered by the provider gap");
  const u = fanout(["--timeout", "10", "echo x", "echo y"]);
  assert.deepEqual(u.stdout.trim().split("\n").map((l) => JSON.parse(l).host), ["other", "other"]);
});

test("fanout.sh: unknown options exit 1; no commands on a tty prints usage", () => {
  const r = fanout(["--bogus"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown option/);
  const e = fanout([], { input: "" });
  assert.equal(e.status, 1, "empty stdin is an error, not silence");
  assert.match(e.stderr, /no commands/);
});
