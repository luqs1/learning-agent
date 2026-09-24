// LLM judge for the few assertions that cannot be decided by regex or file
// checks. One `claude -p` call, no tools, structured JSON output. The judge's
// reasoning is returned so the report can record it.

import { spawn } from "node:child_process";

export const DEFAULT_JUDGE_MODEL = process.env.SCENARIO_JUDGE_MODEL || "sonnet";

const SCHEMA = {
  type: "object",
  properties: {
    pass: { type: "boolean" },
    reasoning: { type: "string", description: "Two to five sentences: what you checked and why it passes or fails." },
    evidence: { type: "array", items: { type: "string" }, description: "Short verbatim quotes from the material that decided the verdict." },
  },
  required: ["pass", "reasoning", "evidence"],
};

export function buildJudgePrompt({ name, rubric, material }) {
  return [
    `You are a strict, literal test judge for an automated test named "${name}". You decide only the rubric below; ignore everything else about quality.`,
    "Read the material, then answer with the JSON object requested. Quote evidence verbatim. If the rubric cannot be violated because the material contains nothing it applies to, pass and say so.",
    "",
    "## Rubric",
    rubric.trim(),
    "",
    "## Material",
    material.trim(),
  ].join("\n");
}

export async function judge(opts) {
  const first = await judgeOnce(opts);
  if (!first.error) return first;
  const second = await judgeOnce(opts);
  return second.error ? { ...second, reasoning: `${second.reasoning} (after retry; first attempt: ${first.reasoning})` } : second;
}

function judgeOnce({ name, rubric, material, model = DEFAULT_JUDGE_MODEL, timeoutMs = 5 * 60 * 1000 }) {
  const prompt = buildJudgePrompt({ name, rubric, material });
  const args = ["-p", "--output-format", "json", "--json-schema", JSON.stringify(SCHEMA), "--tools", "", "--no-session-persistence", "--model", model, "--max-budget-usd", "3.00"];
  return new Promise((resolve) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", (e) => resolve({ pass: false, reasoning: `judge could not run: ${e.message}`, evidence: [], error: true }));
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const res = JSON.parse(out);
        const v = res.structured_output || tryParse(res.result);
        if (!v || typeof v.pass !== "boolean") throw new Error(`no structured verdict (${res.subtype || "?"})`);
        resolve({ pass: v.pass, reasoning: v.reasoning || "", evidence: v.evidence || [], model, costUsd: res.total_cost_usd || 0 });
      } catch (e) {
        resolve({ pass: false, reasoning: `judge failed: ${e.message} ${err.slice(0, 200)}`, evidence: [], error: true, model });
      }
    });
    child.stdin.end(prompt);
  });
}

function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Compact a transcript for the judge: learner and agent turns, tool calls omitted. */
export function transcriptForJudge(turns, { maxChars = 60_000 } = {}) {
  const parts = turns.map((t, i) => `### Turn ${i + 1}\n\n**Learner:** ${t.learner}\n\n**Agent:**\n${t.agent.text || "(no text)"}`);
  const text = parts.join("\n\n");
  return text.length > maxChars ? text.slice(0, maxChars) + "\n\n[... truncated ...]" : text;
}

export function filesForJudge(kb, names, { maxCharsEach = 12_000 } = {}) {
  return names
    .filter((n) => kb.files[n])
    .map((n) => {
      const body = kb.files[n];
      return `### File: ${n}\n\n${body.length > maxCharsEach ? body.slice(0, maxCharsEach) + "\n[... truncated ...]" : body}`;
    })
    .join("\n\n");
}
