// Repository paths and the platform table shared by lint tests and the
// scenario runner. Adding a platform or a shared file means editing this
// file only.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const PLATFORMS = {
  claude: {
    dir: "claude",
    kbPath: "~/.claude/learning",
    agent: "claude/agents/learning.md",
    agentFrontmatterKeys: ["name", "description", "skills"],
    skills: ["claude/skills/learning-assessment/SKILL.md", "claude/skills/learning-research/SKILL.md"],
  },
  opencode: {
    dir: "opencode",
    kbPath: "~/.config/opencode/learning",
    agent: "opencode/agents/learning.md",
    agentFrontmatterKeys: ["description", "mode", "color"],
    skills: ["opencode/skills/learning-assessment/SKILL.md", "opencode/skills/learning-research/SKILL.md"],
  },
};

// Files that must stay mirrored between the two trees: [claude, opencode].
export const MIRRORED = [
  ["claude/agents/learning.md", "opencode/agents/learning.md"],
  ["claude/skills/learning-assessment/SKILL.md", "opencode/skills/learning-assessment/SKILL.md"],
  ["claude/skills/learning-research/SKILL.md", "opencode/skills/learning-research/SKILL.md"],
];

// Files that exist in exactly one tree, by design.
export const PLATFORM_ONLY = {
  claude: ["claude/skills/learn/SKILL.md", "claude/.claude-plugin/plugin.json"],
  opencode: [],
};

export const SHARED_SKILLS = ["learning-assessment", "learning-research"];

// The learning-research helper scripts live once, under claude/; the opencode
// tree reaches them through a relative symlink. The Claude copy of SKILL.md
// prefixes every script path with this variable (Claude Code substitutes it);
// the opencode copy uses bare `scripts/`.
export const RESEARCH_SKILL = "claude/skills/learning-research/SKILL.md";
export const RESEARCH_SCRIPTS_DIR = "claude/skills/learning-research/scripts";
export const SKILL_SCRIPTS_PREFIX = "${CLAUDE_SKILL_DIR}/scripts";

export const MANIFESTS = ["package.json", "claude/.claude-plugin/plugin.json", ".claude-plugin/marketplace.json"];

export const PROMPT_FILES = [
  ...Object.values(PLATFORMS).map((p) => p.agent),
  ...Object.values(PLATFORMS).flatMap((p) => p.skills),
  ...PLATFORM_ONLY.claude.filter((f) => f.endsWith(".md")),
];

export function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

export function readJson(rel) {
  return JSON.parse(read(rel));
}

export function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

export function listFiles(relDir) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      // Follow symlinked directories (opencode/skills/learning-research/scripts
      // -> claude/.../scripts) so both trees list the same script files.
      const isDir = e.isDirectory() || (e.isSymbolicLink() && fs.statSync(p).isDirectory());
      if (isDir) walk(p);
      else out.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, relDir));
  return out.sort();
}

// The documented inline citation format, and the only other `[source: ...]`
// spelling the prompts are allowed to contain (the concept-file template in
// learning-research cites the raw URL/title inside knowledge-base files).
export const CITATION_RE = /\[source: ([^\]]+)\]/g;
export const CITATION_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;
export const CITATION_PLACEHOLDERS = new Set(["filename.md", "URL or title"]);
