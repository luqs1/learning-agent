// Renders per-scenario reports and the run summary as markdown.

import path from "node:path";
import { summarise } from "../../../scripts/trace-summary.mjs";

export function mark(r) {
  if (r.skipped) return "SKIP";
  return r.pass ? "PASS" : "FAIL";
}

export function scenarioReport(run) {
  const { scenario, turns, results, kb, events, costUsd, startedAt, endedAt, error } = run;
  const lines = [];
  lines.push(`# Scenario ${scenario.id}`);
  lines.push("");
  lines.push(`- Topic: ${scenario.topic}`);
  lines.push(`- Level: ${scenario.level}`);
  lines.push(`- Result: **${run.pass ? "PASS" : "FAIL"}** (${results.filter((r) => r.pass && !r.skipped).length}/${results.filter((r) => !r.skipped).length} assertions)`);
  lines.push(`- Model: ${run.model}; judge: ${run.judgeModel}`);
  lines.push(`- Cost: $${costUsd.toFixed(2)} (agent) + $${(run.judgeCostUsd || 0).toFixed(2)} (judges); wall time ${Math.round((endedAt - startedAt) / 1000)}s`);
  lines.push(`- Knowledge base: ${kb.root}`);
  for (const t of kb.traces) lines.push(`- Trace: ${t.file} (${t.events.length} events, ${t.errors.length} malformed)`);
  if (error) lines.push(`- Runner error: ${error}`);
  lines.push("");
  lines.push("## Assertions");
  lines.push("");
  lines.push("| assertion | result | detail |");
  lines.push("|---|---|---|");
  for (const r of results) lines.push(`| ${r.name}${r.judged ? " (judge)" : ""} | ${mark(r)} | ${escapeCell(r.detail || "")} |`);
  const judged = results.filter((r) => r.judged && !r.skipped);
  if (judged.length) {
    lines.push("");
    lines.push("## Judge reasoning");
    for (const r of judged) {
      lines.push("");
      lines.push(`### ${r.name} - ${mark(r)}`);
      lines.push("");
      lines.push(r.reasoning || "(no reasoning returned)");
      if (r.evidence?.length) {
        lines.push("");
        for (const e of r.evidence) lines.push(`> ${e}`);
      }
    }
  }
  lines.push("");
  lines.push("## Trace timeline");
  lines.push("");
  if (!events.length) lines.push("(no trace events)");
  else {
    const t0 = Date.parse(events[0].ts);
    lines.push("```");
    for (const e of events) {
      const off = Math.max(0, Math.round((Date.parse(e.ts) - t0) / 1000));
      lines.push(`+${String(Math.floor(off / 60)).padStart(3)}:${String(off % 60).padStart(2, "0")}  ${e.event.padEnd(15)} ${JSON.stringify(e.data)}`);
    }
    lines.push("```");
    const s = summarise(events);
    lines.push("");
    lines.push(`Counts: ${Object.entries(s.counts).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  lines.push("");
  lines.push("## Knowledge base files");
  lines.push("");
  for (const f of Object.keys(kb.files).sort()) lines.push(`- ${f} (${kb.files[f].split("\n").length} lines)`);
  if (!Object.keys(kb.files).length) lines.push("(none)");
  lines.push("");
  lines.push("## Transcript");
  for (const [i, t] of turns.entries()) {
    lines.push("");
    lines.push(`### Turn ${i + 1}${t.expect ? ` (learner answer is wrong on purpose; expect ${t.expect})` : ""}`);
    lines.push("");
    lines.push(`**Learner:** ${t.learner}`);
    lines.push("");
    const tools = t.agent.blocks.filter((b) => b.type === "tool").map((b) => `${b.name}${b.summary ? `(${b.summary})` : ""}`);
    if (tools.length) lines.push(`*Tools (${tools.length}):* ${tools.join(", ")}`);
    lines.push("");
    lines.push(`**Agent** (${t.agent.numTurns} model turns, $${(t.agent.costUsd || 0).toFixed(2)}, ${Math.round((t.agent.endedAt - t.agent.startedAt) / 1000)}s):`);
    lines.push("");
    lines.push(t.agent.text || "(no text)");
    if (t.agent.error) lines.push(`\n*Turn error:* ${t.agent.error}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function summaryTable(runs, runDir) {
  const rows = runs.map((r) => {
    const passed = r.results.filter((x) => x.pass && !x.skipped).length;
    const total = r.results.filter((x) => !x.skipped).length;
    const trace = r.kb.traces[0]?.file ? path.relative(runDir, r.kb.traces[0].file) : "-";
    return [r.scenario.id, r.pass ? "PASS" : "FAIL", `${passed}/${total}`, `$${(r.costUsd + (r.judgeCostUsd || 0)).toFixed(2)}`, path.relative(runDir, r.reportFile), trace];
  });
  const header = ["scenario", "result", "assertions", "cost", "report", "trace"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const fmt = (r) => r.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [fmt(header), fmt(widths.map((w) => "-".repeat(w))), ...rows.map(fmt)].join("\n");
}

export function summaryMarkdown(runs, runDir, meta) {
  const lines = [`# Scenario run ${meta.stamp}`, "", `- Model: ${meta.model}; judge: ${meta.judgeModel}`, `- ${runs.filter((r) => r.pass).length}/${runs.length} scenarios passed`, `- Total cost: $${runs.reduce((a, r) => a + r.costUsd + (r.judgeCostUsd || 0), 0).toFixed(2)}`, "", "| scenario | result | assertions | cost | report | trace |", "|---|---|---|---|---|---|"];
  for (const r of runs) {
    const passed = r.results.filter((x) => x.pass && !x.skipped).length;
    const total = r.results.filter((x) => !x.skipped).length;
    const trace = r.kb.traces[0]?.file ? `[trace](${path.relative(runDir, r.kb.traces[0].file)})` : "-";
    lines.push(`| ${r.scenario.id} | ${r.pass ? "PASS" : "FAIL"} | ${passed}/${total} | $${(r.costUsd + (r.judgeCostUsd || 0)).toFixed(2)} | [report](${path.relative(runDir, r.reportFile)}) | ${trace} |`);
  }
  lines.push("");
  for (const r of runs) {
    const failed = r.results.filter((x) => !x.pass && !x.skipped);
    if (failed.length) {
      lines.push(`## ${r.scenario.id}: failed assertions`);
      lines.push("");
      for (const f of failed) lines.push(`- **${f.name}**: ${f.detail}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

function escapeCell(s) {
  return String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");
}
