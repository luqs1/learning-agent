/**
 * Learning Agent plugin for OpenCode.
 *
 * Registers:
 * - Skills: learning-assessment, learning-research (via config.skills.paths)
 * - Agent: learning (via config.agent, loaded from opencode/agents/learning.md)
 */

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

// Paths to plugin assets
const skillsDir = path.join(repoRoot, "opencode", "skills");
const agentFile = path.join(repoRoot, "opencode", "agents", "learning.md");

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

      // Register the learning agent from the markdown file.
      if (fs.existsSync(agentFile)) {
        const raw = fs.readFileSync(agentFile, "utf8");
        const { frontmatter, content } = parseFrontmatter(raw);

        config.agent = config.agent || {};
        config.agent.learning = {
          description:
            frontmatter.description ||
            "For personal deep dives into topics - guided learning through questions, problems, and active recall",
          mode: frontmatter.mode || "primary",
          color: frontmatter.color || "#4A90D9",
          prompt: content.trim(),
        };
      }
    },
  };
};
