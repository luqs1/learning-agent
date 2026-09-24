/**
 * Learning Agent plugin for OpenCode.
 *
 * Registers:
 * - Skills: learning-assessment, learning-research (via config.skills.paths)
 * - Agents (via config.agent, loaded from opencode/agents/*.md):
 *     learning            primary  - the teaching session
 *     learning-researcher subagent - one-angle research worker that the
 *                                    learning-research skill launches three
 *                                    of in parallel through the task tool
 * - Agent: researcher (primary; the learning prompt plus a mode preamble:
 *   starts in Research Mode, the equivalent of Claude Code's /research)
 * - Command: /research <question> (via config.command, runs on researcher)
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
// settings that the flat frontmatter cannot express. `permission` is opencode's
// per-tool gate ("allow" | "ask" | "deny").
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
    permission: { task: "deny" },
  },
};

/**
 * Parse YAML frontmatter from a markdown file.
 * Returns { frontmatter: {}, content: string }.
 */
function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
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

export const LearningAgentPlugin = async ({ client, directory }) => {
  return {
    // Register skills directory so opencode discovers learning-assessment
    // and learning-research without symlinks.
    config: async (config) => {
      config.skills = config.skills || {};
      config.skills.paths = config.skills.paths || [];
      if (!config.skills.paths.includes(skillsDir)) {
        config.skills.paths.push(skillsDir);
      }

      // Register each agent from its markdown file.
      config.agent = config.agent || {};
      for (const [name, defaults] of Object.entries(AGENTS)) {
        const agentFile = path.join(agentsDir, `${name}.md`);
        if (!fs.existsSync(agentFile)) continue;
        const raw = fs.readFileSync(agentFile, "utf8");
        const { frontmatter, content } = parseFrontmatter(raw);
        const { permission, ...rest } = defaults;
        config.agent[name] = {
          ...rest,
          description: frontmatter.description || defaults.description,
          mode: frontmatter.mode || defaults.mode,
          color: frontmatter.color || defaults.color,
          prompt: content.trim(),
          ...(permission ? { permission } : {}),
        };
      }

      // Research mode: a second primary agent with the learning prompt,
      // started in research mode. Select it with Tab, or run /research.
      if (config.agent.learning) {
        config.agent.researcher = {
          ...RESEARCHER_AGENT,
          prompt: `${RESEARCHER_PREAMBLE}\n\n${config.agent.learning.prompt}`,
        };
        config.command = config.command || {};
        config.command.research = { ...RESEARCH_COMMAND };
      }
    },
  };
};
