/**
 * Learning Agent plugin for OpenCode (V2 plugin API).
 *
 * V2 plugins default-export a definition with a stable `id` and a `setup(ctx)`
 * function (see https://opencode.ai/v2/docs/build/plugins). V1's returned
 * `{ config }` hook object no longer runs in V2; registration is done through
 * domain transforms instead:
 *
 * - Skills: `ctx.skill.transform` adds learning-assessment and learning-research
 *   (read from opencode/skills/<name>/SKILL.md).
 * - Agents: `ctx.agent.transform` registers
 *     learning            primary  - the teaching session
 *     learning-researcher subagent - one-angle research worker that the
 *                                    learning-research skill launches three
 *                                    of in parallel through the task tool
 *   and the second primary agent
 *     researcher (the learning prompt plus a mode preamble: starts in Research
 *     Mode, the equivalent of Claude Code's /research).
 * - Command: `ctx.command.transform` adds /research <question>, which switches
 *   the session to the researcher agent and submits the command template.
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

// Paths to plugin assets
const skillsDir = path.join(repoRoot, "opencode", "skills");
const agentsDir = path.join(repoRoot, "opencode", "agents");

// Agents to register: file name (without .md) -> defaults and platform-side
// settings that the flat frontmatter cannot express. `permissions` is opencode
// V2's ordered rule list ({ action, resource, effect }).
const AGENTS = {
  learning: {
    description: "For personal deep dives into topics - guided learning through questions, problems, and active recall",
    mode: "primary",
    color: "#4A90D9",
  },
  "learning-researcher": {
    description: "One-angle research worker for the learning agent; launched by the learning-research skill, not for direct use",
    mode: "subagent",
    color: "#7B8D42",
    // A researcher never launches researchers; it also never edits the
    // learner's memory or the merged knowledge-base files (the prompt says
    // so; the parent merges). Everything else it needs is allowed: bash for
    // the helper scripts, read/write for the fragments, webfetch, skill.
    // V2 renamed the V1 `task` action to `subagent`.
    permissions: [{ action: "subagent", resource: "*", effect: "deny" }],
  },
};

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns { frontmatter: {}, content: string }.
 */
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content: raw };

  const fm = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const value = line
        .slice(idx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      fm[key] = value;
    }
  }
  return { frontmatter: fm, content: match[2] };
}

/** Read an agent markdown file, or undefined when it is absent. */
function readAgent(name) {
  const file = path.join(agentsDir, `${name}.md`);
  if (!fs.existsSync(file)) return undefined;
  const { frontmatter, content } = parseFrontmatter(fs.readFileSync(file, "utf8"));
  return { frontmatter, content: content.trim() };
}

/** Read every opencode/skills/<id>/SKILL.md into a Skill.Info record. */
function readSkills() {
  const skills = [];
  if (!fs.existsSync(skillsDir)) return skills;
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(skillsDir, entry.name, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const { frontmatter, content } = parseFrontmatter(fs.readFileSync(file, "utf8"));
    skills.push({
      id: entry.name,
      name: frontmatter.name || entry.name,
      description: frontmatter.description || "",
      path: file,
      content: content.trim(),
    });
  }
  return skills;
}

// Research mode on opencode. The prompt is the learning agent's prompt; this
// preamble tells it the session was opened as a researcher, which is the same
// signal Claude Code's /research command gives (see "Research Mode" in the
// prompt). Keep it a mode line only: the rules live in the prompt file.
export const RESEARCHER_PREAMBLE = [
  "# Mode",
  "",
  "You were started as the `researcher` agent. Treat the first user message as a research question and enter Research Mode (defined below) for the whole session. The gauging question - the user's current hypothesis and the evidence they already have for it - still comes first, before any research. Everything else in this prompt applies unchanged.",
].join("\n");

export const RESEARCHER_AGENT = {
  description: "Cited research briefs: market size, competitors and their funding, evidence for or against a hypothesis. The learning agent in research mode.",
  mode: "primary",
  color: "#D9834A",
};

export const RESEARCH_COMMAND = {
  description: "Build a cited research brief on a question (learning agent, research mode)",
  agent: "researcher",
  template: [
    "Enter research mode for this question: $ARGUMENTS",
    "",
    "Open with the gauging question - the user's current hypothesis and the evidence they already have for it - before any research. Then read the venture context and the existing knowledge base, plan the sub-questions, research and store, and deliver the brief, the counter-case and the next questions, writing the brief to the topic folder.",
    "",
    "If no question was provided, ask what the user wants a brief on.",
  ].join("\n"),
};

export default {
  id: "learning-agent",
  async setup(ctx) {
    // Skills: register learning-assessment and learning-research through the
    // V2 plugin API (there is no config.skills.paths to point at a directory).
    await ctx.skill.transform((draft) => {
      for (const skill of readSkills()) draft.add(skill);
    });

    // Agents: register each from its markdown file. `update` upserts: a new id
    // starts from opencode's default agent definition (allow-all, with the
    // usual external-directory/env asks) and this callback layers the agent's
    // prompt and restrictions on top.
    await ctx.agent.transform((draft) => {
      for (const [name, defaults] of Object.entries(AGENTS)) {
        const parsed = readAgent(name);
        if (!parsed) continue;
        const { permissions } = defaults;
        draft.update(name, (agent) => {
          agent.name = name;
          agent.description = parsed.frontmatter.description || defaults.description;
          agent.mode = parsed.frontmatter.mode || defaults.mode;
          agent.color = parsed.frontmatter.color || defaults.color;
          agent.system = parsed.content;
          if (permissions) agent.permissions.push(...permissions);
        });
      }

      // Research mode: a second primary agent with the learning prompt,
      // started in research mode. Select it with Tab, or run /research.
      const learning = readAgent("learning");
      if (learning) {
        draft.update("researcher", (agent) => {
          agent.name = "researcher";
          agent.description = RESEARCHER_AGENT.description;
          agent.mode = RESEARCHER_AGENT.mode;
          agent.color = RESEARCHER_AGENT.color;
          agent.system = `${RESEARCHER_PREAMBLE}\n\n${learning.content}`;
        });
      }
    });

    // /research <question>: switch the session to the researcher agent, then
    // submit the template with the user's arguments.
    await ctx.command.transform((editor) => {
      editor.add({
        name: "research",
        description: RESEARCH_COMMAND.description,
        execute: async ({ sessionID, prompt, delivery }) => {
          await ctx.session.switchAgent({ sessionID, agent: RESEARCH_COMMAND.agent });
          const args = (prompt?.text ?? "").trim();
          const text = RESEARCH_COMMAND.template.replace("$ARGUMENTS", args);
          await ctx.session.prompt({
            sessionID,
            text,
            files: prompt?.files,
            agents: prompt?.agents,
            skills: prompt?.skills,
            delivery,
          });
        },
      });
    });
  },
};
