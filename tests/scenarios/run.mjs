#!/usr/bin/env node
// Scenario runner: drives the learning agent headlessly through each fixture's
// scripted learner turns, then evaluates the fixture's assertions against the
// transcript, the knowledge base and the trace the agent wrote.
//
//   npm run test:scenarios                         # every fixture
//   npm run test:scenarios -- --domain medicine    # one domain
//   npm run test:scenarios -- --only hash-tables   # fixtures whose path contains the string
//   npm run test:scenarios -- --dry-run            # validate fixtures and print the plan, no model calls
//   npm run test:scenarios -- --model sonnet --judge-model sonnet -j 2
//
// Every run writes to tests/scenarios/.runs/<stamp>/<domain>/<name>/ :
//   kb/            the knowledge base the agent built (LEARNING_KB_ROOT), incl. kb/.traces/
//   turns.json     raw per-turn data (text blocks, tool calls, timings, cost)
//   report.md      assertions, judge reasoning, trace timeline, transcript
// and tests/scenarios/.runs/<stamp>/summary.md for the whole run.
//
// Exit code: 0 if every scenario passed, 1 otherwise, 2 on usage error.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ROOT } from "../lib/repo.mjs";
import { loadFixtures, SCENARIO_DIR } from "./lib/fixtures.mjs";
import { runTurn } from "./lib/driver.mjs";
import { loadKb, allEvents } from "./lib/kb.mjs";
import { judge as llmJudge, DEFAULT_JUDGE_MODEL } from "./lib/judge.mjs";
import { ASSERTIONS } from "./lib/assertions.mjs";
import { scenarioReport, summaryTable, summaryMarkdown, mark } from "./lib/report.mjs";

const argv = parseArgs(process.argv.slice(2));
if (argv.help) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(0);
}

const model = argv.model || process.env.SCENARIO_MODEL || "sonnet";
const judgeModel = argv["judge-model"] || DEFAULT_JUDGE_MODEL;
const concurrency = Math.max(1, Number(argv.j || argv.concurrency || 1));
const firstTurnBudget = Number(process.env.SCENARIO_FIRST_TURN_BUDGET_USD || 6);
const turnBudget = Number(process.env.SCENARIO_TURN_BUDGET_USD || 3);
const turnTimeoutMs = Number(process.env.SCENARIO_TURN_TIMEOUT_S || 1200) * 1000;

let scenarios;
try {
  scenarios = loadFixtures({ only: argv.only, domain: argv.domain });
} catch (err) {
  console.error(err.message);
  process.exit(2);
}
if (!scenarios.length) {
  console.error("no scenarios matched");
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
const runDir = path.join(SCENARIO_DIR, ".runs", stamp);

console.log(`Scenarios: ${scenarios.length}  model=${model}  judge=${judgeModel}  concurrency=${concurrency}`);
for (const s of scenarios) console.log(`  ${s.id.padEnd(45)} ${s.level.padEnd(12)} ${s.turns.length} turns  ${s.assertions.length} assertions`);

if (argv["dry-run"]) {
  console.log("\nDry run: fixtures are valid; nothing executed.");
  process.exit(0);
}

fs.mkdirSync(runDir, { recursive: true });
console.log(`Run dir: ${runDir}\n`);

const runs = await pool(scenarios, concurrency, runScenario);

console.log("\n" + summaryTable(runs, runDir));
fs.writeFileSync(path.join(runDir, "summary.md"), summaryMarkdown(runs, runDir, { stamp, model, judgeModel }));
console.log(`\nSummary: ${path.join(runDir, "summary.md")}`);
process.exit(runs.every((r) => r.pass) ? 0 : 1);

async function runScenario(scenario) {
  const dir = path.join(runDir, scenario.domain, scenario.name);
  const kbRoot = path.join(dir, "kb");
  fs.mkdirSync(kbRoot, { recursive: true });
  const log = (msg) => console.log(`[${scenario.id}] ${msg}`);
  const sessionId = randomUUID();
  const startedAt = Date.now();
  const turns = [];
  let error = null;
  let costUsd = 0;

  for (const [i, t] of scenario.turns.entries()) {
    log(`learner turn ${i + 1}/${scenario.turns.length}: ${t.say.replace(/\s+/g, " ").slice(0, 100)}`);
    const agent = await runTurn({
      prompt: t.say,
      sessionId,
      resume: i > 0,
      model: scenario.model || model,
      budgetUsd: scenario.budget_usd || (i === 0 ? firstTurnBudget : turnBudget),
      kbRoot,
      slug: scenario.slug,
      timeoutMs: turnTimeoutMs,
      log,
    });
    costUsd += agent.costUsd || 0;
    turns.push({ learner: t.say, expect: t.expect, agent });
    if (agent.error) {
      log(`turn ${i + 1} error: ${agent.error}`);
      error = `turn ${i + 1}: ${agent.error}`;
      if (!agent.text) break;
    }
  }
  fs.writeFileSync(path.join(dir, "turns.json"), JSON.stringify(turns.map((t) => ({ ...t, agent: { ...t.agent, raw: undefined } })), null, 2));

  const kb = loadKb(kbRoot, scenario.slug);
  const events = allEvents(kb);
  let judgeCostUsd = 0;
  const judge = async (args) => {
    const r = await llmJudge({ ...args, model: scenario.judge_model || judgeModel });
    judgeCostUsd += r.costUsd || 0;
    return r;
  };
  const ctx = { scenario, turns, kb, events, judge };
  const results = [];
  for (const a of scenario.assertions) {
    const def = ASSERTIONS[a.name];
    const { name, ...params } = a;
    let r;
    try {
      r = await def.run(ctx, params);
    } catch (err) {
      r = { pass: false, detail: `assertion threw: ${err.message}` };
    }
    if (def.judged && !r.detail) r.detail = r.error ? `judge error: ${r.reasoning}` : (r.reasoning || "").slice(0, 200);
    results.push({ name, judged: !!def.judged, describe: def.describe, ...r });
    log(`${mark(r).padEnd(4)} ${name}${r.detail ? ` - ${r.detail.slice(0, 160)}` : ""}`);
  }
  if (error) results.push({ name: "runner", pass: false, detail: error });

  const run = { scenario, turns, kb, events, results, model: scenario.model || model, judgeModel: scenario.judge_model || judgeModel, costUsd, judgeCostUsd, startedAt, endedAt: Date.now(), error, pass: results.every((r) => r.pass || r.skipped) };
  run.reportFile = path.join(dir, "report.md");
  fs.writeFileSync(run.reportFile, scenarioReport(run));
  log(`${run.pass ? "PASS" : "FAIL"}  report: ${path.relative(ROOT, run.reportFile)}`);
  return run;
}

async function pool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function parseArgs(args) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--dry-run") out["dry-run"] = true;
    else if (a.startsWith("--")) out[a.slice(2)] = args[i + 1] && !args[i + 1].startsWith("-") ? args[++i] : true;
    else if (a === "-j") out.j = args[++i];
    else out.only = a;
  }
  return out;
}
