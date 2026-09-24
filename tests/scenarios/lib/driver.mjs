// Drives the learning agent headlessly, one learner turn at a time, through
// `claude -p`. The first turn opens a session with a fixed --session-id; later
// turns --resume it. Output is stream-json so we see every text block and
// tool call the agent produced during the turn, not just its final message.

import { spawn } from "node:child_process";
import path from "node:path";
import { ROOT } from "../../lib/repo.mjs";

export const AGENT_REF = "learning-agent:learning";

export function harnessSystemPrompt({ kbRoot, slug, mode = "teach" }) {
  return [
    "TEST HARNESS NOTE (the learner cannot see this).",
    `The environment variable LEARNING_KB_ROOT is set to "${kbRoot}". Use that directory as the knowledge-base root everywhere the agent prompt and the skills mention the default root:`,
    `- topic folder: ${kbRoot}/${slug}/`,
    `- learner profile: ${kbRoot}/learner.md`,
    `- topic progress: ${kbRoot}/${slug}/progress.md`,
    `- session trace: ${kbRoot}/.traces/${slug}/<session-timestamp>.jsonl`,
    ...(mode === "research" ? [`- research briefs: ${kbRoot}/${slug}/brief-<YYYY-MM-DD>.md`, "This session was opened with the /research command: enter Research Mode for the first message. The gauging question still comes first."] : []),
    `Use the topic slug "${slug}" for this session.`,
    "Otherwise behave exactly as the learning agent prompt specifies. The messages you receive are typed by a real learner.",
  ].join("\n");
}

export function buildArgs({ sessionId, resume, model, budgetUsd, kbRoot, slug, mode, extraArgs = [] }) {
  const args = [
    "-p",
    "--plugin-dir",
    path.join(ROOT, "claude"),
    "--agent",
    AGENT_REF,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "bypassPermissions",
    "--add-dir",
    kbRoot,
    "--append-system-prompt",
    harnessSystemPrompt({ kbRoot, slug, mode }),
  ];
  if (model) args.push("--model", model);
  if (budgetUsd) args.push("--max-budget-usd", String(budgetUsd));
  args.push(resume ? "--resume" : "--session-id", sessionId);
  args.push(...extraArgs);
  return args;
}

/**
 * Run one learner turn. Resolves with what the agent did during the turn.
 */
export function runTurn({ prompt, sessionId, resume, model, budgetUsd, kbRoot, slug, mode, timeoutMs = 20 * 60 * 1000, extraArgs, log = () => {} }) {
  const args = buildArgs({ sessionId, resume, model, budgetUsd, kbRoot, slug, mode, extraArgs });
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn("claude", args, {
      cwd: ROOT,
      env: { ...process.env, LEARNING_KB_ROOT: kbRoot },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const turn = newTurn(startedAt);
    let buf = "";
    const timer = setTimeout(() => {
      turn.error = `turn timed out after ${Math.round(timeoutMs / 1000)}s`;
      child.kill("SIGTERM");
    }, timeoutMs);

    const handleLine = (line) => {
      if (!line.trim()) return;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      ingestEvent(turn, ev, log);
    };

    child.stdout.on("data", (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        handleLine(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    });
    child.stderr.on("data", (chunk) => {
      turn.stderr += chunk;
    });
    child.on("error", (err) => {
      turn.error = err.code === "ENOENT" ? "claude CLI not found on PATH" : err.message;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (buf.trim()) handleLine(buf);
      turn.endedAt = Date.now();
      turn.text = turn.blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n\n");
      if (code !== 0 && !turn.error) turn.error = `claude exited with code ${code}: ${turn.stderr.slice(0, 300)}`;
      resolve(turn);
    });
    child.stdin.end(prompt);
  });
}

export function newTurn(startedAt = Date.now()) {
  // messages:  one entry per top-level or subagent API turn (stream-json emits one
  //            `assistant` event per content block; blocks of one turn share message.id),
  //            {id, at, parent, tools} - `parent` is the Agent tool_use id for subagent turns
  // subagents: every subagent launched during the turn (system task_started events)
  return { startedAt, endedAt: null, text: "", blocks: [], toolNames: [], messages: [], subagents: [], subagentToolNames: [], result: null, costUsd: 0, numTurns: 0, error: null, stderr: "", raw: [] };
}

/**
 * Fold one stream-json event into the turn. Exported so the grouping rules can
 * be unit-tested against recorded event shapes without running the CLI.
 * Subagent output (events with parent_tool_use_id) is recorded in `messages`
 * and `subagentToolNames` but kept out of `blocks`/`text`, which are what the
 * learner would have seen.
 */
export function ingestEvent(turn, ev, log = () => {}) {
  turn.raw.push(ev);
  if (ev.type === "assistant" && ev.message?.content) {
    const parent = ev.parent_tool_use_id || null;
    const id = ev.message.id || ev.request_id || `event-${turn.raw.length}`;
    let msg = turn.messages.find((m) => m.id === id);
    if (!msg) {
      const at = ev.timestamp ? Date.parse(ev.timestamp) : Date.now();
      msg = { id, at: Number.isFinite(at) ? at : Date.now(), parent, tools: [] };
      turn.messages.push(msg);
    }
    for (const block of ev.message.content) {
      if (block.type === "tool_use") msg.tools.push(block.name);
      if (parent) {
        if (block.type === "tool_use") turn.subagentToolNames.push(block.name);
        continue;
      }
      if (block.type === "text" && block.text?.trim()) {
        turn.blocks.push({ type: "text", text: block.text });
        log(`  agent: ${block.text.replace(/\s+/g, " ").slice(0, 110)}`);
      } else if (block.type === "tool_use") {
        const summary = summariseToolInput(block.name, block.input);
        turn.blocks.push({ type: "tool", name: block.name, summary });
        turn.toolNames.push(block.name);
        log(`  tool:  ${block.name} ${summary}`);
      }
    }
  } else if (ev.type === "system" && ev.subtype === "task_started" && ev.subagent_type) {
    turn.subagents.push({ type: ev.subagent_type, description: ev.description || "", toolUseId: ev.tool_use_id || null, backgrounded: !!ev.is_backgrounded });
    log(`  agent: launched ${ev.subagent_type} (${ev.description || ""})`);
  } else if (ev.type === "result") {
    turn.result = ev;
    turn.costUsd = ev.total_cost_usd ?? 0;
    turn.numTurns = ev.num_turns ?? 0;
    if (ev.is_error || ev.subtype !== "success") turn.error = turn.error || `claude result: ${ev.subtype} ${ev.result ? String(ev.result).slice(0, 300) : ""}`;
  }
}

function summariseToolInput(name, input) {
  if (!input) return "";
  if (name === "Bash") return (input.description || input.command || "").replace(/\s+/g, " ").slice(0, 100);
  if (name === "Skill") return input.skill || "";
  if (name === "WebSearch") return input.query || "";
  if (name === "WebFetch") return input.url || "";
  if (name === "Write" || name === "Edit" || name === "Read") return input.file_path || "";
  if (name === "Agent") return `${input.subagent_type || "agent"}: ${input.description || ""}`.trim();
  return JSON.stringify(input).slice(0, 100);
}
