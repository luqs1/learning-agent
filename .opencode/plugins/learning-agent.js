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
    },
  };
};
