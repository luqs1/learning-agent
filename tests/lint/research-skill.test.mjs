// The learning-research skill is a retrieval playbook: a provider routing
// table plus bundled scripts. These checks keep the table, the scripts and the
// knowledge-base schema consistent with each other, without touching the
// network (every script's --help and its missing-key path are local).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, PLATFORMS, RESEARCH_SKILL, RESEARCH_SCRIPTS_DIR, SKILL_SCRIPTS_PREFIX, read, exists } from "../lib/repo.mjs";
import { parseFrontmatter } from "../lib/frontmatter.mjs";
import { SOURCES_COLUMNS } from "../scenarios/lib/kb.mjs";

const body = parseFrontmatter(read(RESEARCH_SKILL)).body;
const scriptsDir = path.join(ROOT, RESEARCH_SCRIPTS_DIR);
const scripts = fs
  .readdirSync(scriptsDir)
  .filter((f) => f.endsWith(".sh") && f !== "_lib.sh")
  .sort();
const mentioned = [...new Set([...body.matchAll(/\b([a-z0-9-]+\.sh)\b/g)].map((m) => m[1]))].filter((f) => f !== "_lib.sh").sort();

// Tool names the skill may reference beyond the built-in WebSearch/WebFetch.
const KNOWN_MCP_TOOLS = new Set([
  "mcp__exa__web_search_exa",
  "mcp__exa__web_search_advanced_exa",
  "mcp__exa__web_fetch_exa",
  "mcp__plugin_context7_context7__resolve-library-id",
  "mcp__plugin_context7_context7__query-docs",
]);

// Rows the routing tables must keep (issue #6): learning material and market research.
const REQUIRED_ROWS = {
  "### Learning material": ["Papers", "Articles", "Official docs", "First-party evidence", "Images", "Videos", "Courses", "Code / repos"],
  "### Market research material": ["Company facts", "Funding", "Competitor product", "Customer sentiment", "Market size", "Industry", "News", "Patents", "Trends"],
};

function section(md, heading) {
  const start = md.indexOf(`\n${heading}`);
  assert.ok(start >= 0, `missing section '${heading}' in ${RESEARCH_SKILL}`);
  const rest = md.slice(start + 1 + heading.length);
  const end = rest.search(/\n#{1,3} /);
  return end >= 0 ? rest.slice(0, end) : rest;
}

function run(script, args, envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  return spawnSync("bash", [path.join(scriptsDir, script), ...args], { env, encoding: "utf8", timeout: 20_000 });
}

test("research skill: every script it references exists under scripts/ and is executable", () => {
  assert.ok(mentioned.length > 0, "the skill references no scripts at all");
  for (const f of mentioned) {
    const p = path.join(scriptsDir, f);
    assert.ok(fs.existsSync(p), `${RESEARCH_SKILL} references ${f} but ${RESEARCH_SCRIPTS_DIR}/${f} does not exist`);
    if (process.platform !== "win32") assert.ok(fs.statSync(p).mode & 0o111, `${RESEARCH_SCRIPTS_DIR}/${f} is not executable`);
  }
  assert.ok(exists(path.join(RESEARCH_SCRIPTS_DIR, "_lib.sh")), "_lib.sh (shared helpers) is missing");
});

test("research skill: every script under scripts/ is referenced at least once", () => {
  const unreferenced = scripts.filter((f) => !mentioned.includes(f));
  assert.deepEqual(unreferenced, [], `scripts exist but the skill never tells the model to use them: ${unreferenced.join(", ")}`);
});

test("research skill: script paths use the substituted prefix, and the opencode copy is the documented derivation", () => {
  const prefixed = body.match(/\$\{CLAUDE_SKILL_DIR\}\/scripts\/[a-z0-9-]+\.sh/g) || [];
  assert.ok(prefixed.length >= scripts.length, `expected each script to be called at least once via ${SKILL_SCRIPTS_PREFIX}/<name>.sh`);
  assert.doesNotMatch(body, /(^|[^$}\w/])scripts\/[a-z0-9-]+\.sh/m, "a script is called with a bare scripts/ path, which does not resolve in Claude Code; use the ${CLAUDE_SKILL_DIR}/scripts/ prefix");
  const derived = read(RESEARCH_SKILL)
    .split("\n")
    .filter((l) => l !== "user-invocable: false" && !l.startsWith("allowed-tools: "))
    .join("\n")
    .split(`${PLATFORMS.claude.kbPath}/`)
    .join(`${PLATFORMS.opencode.kbPath}/`)
    .split(SKILL_SCRIPTS_PREFIX)
    .join("scripts");
  assert.equal(read(PLATFORMS.opencode.skills[1]), derived, "opencode/skills/learning-research/SKILL.md is not the Claude copy after the documented sed (see AGENTS.md); regenerate it");
});

test("research skill: the frontmatter pre-approves the bundled scripts", () => {
  const fm = parseFrontmatter(read(RESEARCH_SKILL)).frontmatter;
  assert.equal(fm["allowed-tools"], `Bash(${SKILL_SCRIPTS_PREFIX}/*)`);
  assert.equal(fm["user-invocable"], "false");
});

for (const [heading, rows] of Object.entries(REQUIRED_ROWS)) {
  test(`research skill: routing table '${heading}' keeps its required rows`, () => {
    const table = section(body, heading);
    const firstCells = table
      .split("\n")
      .filter((l) => l.startsWith("| "))
      .map((l) => l.slice(2).split("|")[0].trim());
    for (const row of rows) {
      assert.ok(firstCells.some((c) => c.startsWith(row)), `routing table '${heading}' has no '${row}' row (rows: ${firstCells.join("; ")})`);
    }
    for (const line of table.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Material") && !l.startsWith("|---"))) {
      assert.ok(/(\.sh|WebSearch|WebFetch|mcp__|context7|git clone)/.test(line), `routing row has no concrete call: ${line.slice(0, 80)}`);
    }
  });
}

test("research skill: every MCP tool it names is a known one, and the built-ins are named", () => {
  const tools = new Set([...body.matchAll(/mcp__[a-z0-9_-]+/gi)].map((m) => m[0]));
  for (const t of tools) assert.ok(KNOWN_MCP_TOOLS.has(t), `unknown MCP tool name '${t}' in ${RESEARCH_SKILL}`);
  for (const t of KNOWN_MCP_TOOLS) assert.ok(tools.has(t), `expected ${RESEARCH_SKILL} to route to ${t} when present`);
  assert.match(body, /`WebSearch`/);
  assert.match(body, /`WebFetch`/);
});

test("research skill: reading rules, adjacent-material step, evidence tiers and KB layout are present", () => {
  assert.match(body, /## Phase 4: Reading, not skimming/);
  for (const t of ["PDF", "Long article", "Video", "Image", "Repository", "Filing"]) assert.match(section(body, "## Phase 4: Reading, not skimming"), new RegExp(`^\\| ${t}`, "m"), `reading table has no '${t}' row`);
  assert.match(body, /NEVER cite a search snippet|Never cite a search snippet/i);
  assert.match(body, /## Phase 5: Adjacent material/);
  assert.match(section(body, "## Phase 5: Adjacent material"), /Related-to/);
  assert.match(body, /filing > first-party\s+announcement > reputable\s+press > analyst summary > forum/);
  for (const f of ["companies/<company-slug>.md", "market-size.md", "customers.md", "timeline.md", "courses.md"]) assert.ok(body.includes(f), `KB layout does not mention ${f}`);
});

test("research skill: the sources.md header matches the columns the KB parser expects", () => {
  const header = `| ${SOURCES_COLUMNS.join(" | ")} |`;
  assert.ok(body.includes(header), `expected header '${header}'`);
  const row = body.match(/^\| \[URL\] \| \[Title\] \|.*\|$/m);
  assert.ok(row, "no row template ('| [URL] | [Title] | ... |') for sources.md");
  assert.equal(row[0].split("|").length - 2, SOURCES_COLUMNS.length, "the sources.md row template has a different number of cells than the header");
});

test("research skill: trace events name the real provider", () => {
  const tracing = section(body, "## Tracing");
  assert.match(tracing, /`research\.query`/);
  assert.match(tracing, /"provider":"<provider>"/);
  assert.match(tracing, /arxiv\.sh/, "the provider field must be the script name (e.g. arxiv.sh) or the tool name");
  assert.match(tracing, /mcp__exa__web_search_exa/);
  assert.match(tracing, /`research\.fetch`/);
  assert.match(tracing, /`kb\.write`/);
});

test("scripts: every script prints usage with --help (exit 0) and documents its output", () => {
  for (const f of scripts) {
    const r = run(f, ["--help"]);
    assert.equal(r.status, 0, `${f} --help exited ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /^usage: /m, `${f} --help has no usage line`);
    assert.match(r.stdout, /Output/, `${f} --help does not describe its output`);
    assert.equal(r.stderr.trim(), "", `${f} --help wrote to stderr`);
  }
});

test("scripts: keyed providers exit 2 and name the keyless fallback when their env var is unset", () => {
  const cases = [
    ["exa.sh", ["search", "x"], "EXA_API_KEY"],
    ["websearch.sh", ["x"], "BRAVE_API_KEY"],
    ["fred.sh", ["search", "x"], "FRED_API_KEY"],
    ["companies-house.sh", ["officers", "00000000"], "COMPANIES_HOUSE_API_KEY"],
    ["patents.sh", ["x", "--lens"], "LENS_API_KEY"],
    ["github.sh", ["code", "x"], "GITHUB_TOKEN"],
  ];
  const unset = Object.fromEntries(["EXA_API_KEY", "BRAVE_API_KEY", "TAVILY_API_KEY", "FRED_API_KEY", "COMPANIES_HOUSE_API_KEY", "LENS_API_KEY", "GITHUB_TOKEN"].map((k) => [k, ""]));
  for (const [f, args, key] of cases) {
    const r = run(f, args, unset);
    assert.equal(r.status, 2, `${f} ${args.join(" ")} without ${key} exited ${r.status} (want 2): ${r.stderr}`);
    assert.match(r.stderr, new RegExp(key), `${f}: stderr does not name ${key}`);
    assert.match(r.stderr, /Keyless fallback:/, `${f}: stderr does not name the keyless fallback`);
    assert.equal(r.stdout.trim(), "", `${f}: printed to stdout despite the missing key`);
  }
});

test("scripts: unknown options and missing arguments fail with exit 1 and a message", () => {
  for (const f of ["arxiv.sh", "hn.sh", "edgar.sh"]) {
    const r = run(f, ["--no-such-option"]);
    assert.equal(r.status, 1, `${f} --no-such-option exited ${r.status}`);
    assert.match(r.stderr, /unknown option|missing|required/i);
  }
});

test("scripts: follow the conventions (bash shebang, _lib.sh, no hard-coded temp paths)", () => {
  for (const f of scripts) {
    const src = fs.readFileSync(path.join(scriptsDir, f), "utf8");
    assert.ok(src.startsWith("#!/usr/bin/env bash\n"), `${f} must start with #!/usr/bin/env bash`);
    assert.match(src, /_lib\.sh"/, `${f} must source _lib.sh`);
    assert.doesNotMatch(src, /["' ]\/tmp\//, `${f} hard-codes /tmp; use $LA_TMP (mktemp) so concurrent runs cannot collide`);
    assert.doesNotMatch(src, /\bmapfile\b|declare -A|\$\{[a-zA-Z_]+,,\}/, `${f} uses bash 4+ syntax; macOS ships bash 3.2`);
  }
});
