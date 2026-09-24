#!/usr/bin/env node
// Print a learning-agent session trace as a timeline.
//
// Usage:
//   node scripts/trace-summary.mjs                      # latest trace under the default roots
//   node scripts/trace-summary.mjs <file.jsonl>         # one trace file
//   node scripts/trace-summary.mjs <dir>                # latest *.jsonl under <dir> (recursively)
//   node scripts/trace-summary.mjs --json <file|dir>    # machine-readable summary instead of text
//
// Trace format (see tests/README.md): one JSON object per line, {ts, event, data}.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const target = args.filter((a) => a !== "--json")[0];

function findTraces(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTraces(p));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(p);
  }
  return out;
}

function latest(files) {
  return files
    .map((f) => ({ f, m: fs.statSync(f).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0]?.f;
}

function resolveTarget() {
  if (target && fs.existsSync(target)) {
    if (fs.statSync(target).isFile()) return target;
    const f = latest(findTraces(target));
    if (f) return f;
    fail(`no *.jsonl under ${target}`);
  }
  if (target) fail(`not found: ${target}`);
  const roots = [
    process.env.LEARNING_KB_ROOT,
    path.join(os.homedir(), ".claude", "learning"),
    path.join(os.homedir(), ".config", "opencode", "learning"),
  ].filter(Boolean);
  const files = roots.flatMap((r) => findTraces(path.join(r, ".traces")));
  const f = latest(files);
  if (!f) fail(`no traces found under ${roots.map((r) => path.join(r, ".traces")).join(", ")}`);
  return f;
}

function fail(msg) {
  console.error(`trace-summary: ${msg}`);
  process.exit(1);
}

export function parseTrace(text) {
  const events = [];
  const errors = [];
  text.split("\n").forEach((line, i) => {
    if (!line.trim()) return;
    try {
      const e = JSON.parse(line);
      if (typeof e.ts !== "string" || typeof e.event !== "string") {
        errors.push({ line: i + 1, error: "missing ts/event", raw: line });
        return;
      }
      events.push({ ...e, data: e.data ?? {}, line: i + 1 });
    } catch (err) {
      errors.push({ line: i + 1, error: err.message, raw: line });
    }
  });
  return { events, errors };
}

function describe(e) {
  const d = e.data;
  switch (e.event) {
    case "session.start":
      return `session start  topic="${d.topic}" slug=${d.slug}`;
    case "session.end":
      return `session end    covered=[${(d.concepts_covered || []).join(", ")}]`;
    case "phase":
      return `phase          ${d.from} -> ${d.to}`;
    case "gate.check":
      return `gate ${String(d.result).padEnd(4)}      ${d.concept}: ${d.reason ?? ""}`;
    case "research.query":
      return `query          [${d.provider}/${d.material_type}] ${d.query}`;
    case "research.fetch":
      return `fetch ${d.ok ? "ok " : "ERR"}      ${d.url}`;
    case "kb.write":
      return `kb write       ${d.file}`;
    case "teach":
      return `teach          ${d.concept}  cites=[${(d.citations || []).join(", ")}]`;
    case "check.ask":
      return `ask            ${d.concept}: ${d.question}`;
    case "check.verdict":
      return `verdict        ${d.concept}: ${d.verdict} -> ${d.action}`;
    case "memory.read":
      return `memory read    ${d.file} ${d.found ? "(found)" : "(absent)"}`;
    case "memory.write":
      return `memory write   ${d.file}`;
    default:
      return `${e.event.padEnd(14)} ${JSON.stringify(d)}`;
  }
}

export function summarise(events) {
  const counts = {};
  for (const e of events) counts[e.event] = (counts[e.event] || 0) + 1;
  const t0 = events.length ? Date.parse(events[0].ts) : NaN;
  const t1 = events.length ? Date.parse(events[events.length - 1].ts) : NaN;
  return {
    events: events.length,
    counts,
    duration_s: Number.isFinite(t0) && Number.isFinite(t1) ? Math.round((t1 - t0) / 1000) : null,
    concepts_taught: [...new Set(events.filter((e) => e.event === "teach").map((e) => e.data.concept))],
    gate_fails: events.filter((e) => e.event === "gate.check" && e.data.result === "fail").length,
    files_written: [...new Set(events.filter((e) => e.event === "kb.write").map((e) => e.data.file))],
    memory_read: events.filter((e) => e.event === "memory.read").map((e) => `${e.data.file}${e.data.found ? "" : " (absent)"}`),
    memory_written: [...new Set(events.filter((e) => e.event === "memory.write").map((e) => e.data.file))],
  };
}

function fmtOffset(ms) {
  if (!Number.isFinite(ms)) return "   ?:??";
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(4, " ")}:${String(s % 60).padStart(2, "0")}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = resolveTarget();
  const { events, errors } = parseTrace(fs.readFileSync(file, "utf8"));
  if (asJson) {
    console.log(JSON.stringify({ file, summary: summarise(events), errors, events }, null, 2));
    process.exit(0);
  }
  console.log(`Trace: ${file}`);
  const t0 = events.length ? Date.parse(events[0].ts) : NaN;
  console.log(`${events.length} events, ${errors.length} malformed lines\n`);
  console.log(" +m:ss  event");
  for (const e of events) console.log(`${fmtOffset(Date.parse(e.ts) - t0)}  ${describe(e)}`);
  for (const err of errors) console.log(`  line ${err.line}: MALFORMED (${err.error}) ${err.raw.slice(0, 120)}`);
  const s = summarise(events);
  console.log("");
  console.log(`Summary: ${s.events} events over ${s.duration_s ?? "?"}s; concepts taught: ${s.concepts_taught.join(", ") || "none"}; gate fails: ${s.gate_fails}; files written: ${s.files_written.length}; memory read: ${s.memory_read.join(", ") || "none"}; memory written: ${s.memory_written.join(", ") || "none"}`);
  console.log(`Counts: ${Object.entries(s.counts).map(([k, v]) => `${k}=${v}`).join("  ")}`);
}
