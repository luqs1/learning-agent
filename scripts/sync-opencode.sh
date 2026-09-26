#!/usr/bin/env bash
# Regenerate the opencode copies that are derived mechanically from the Claude
# copies (see AGENTS.md, "Dual-platform structure"):
#
#   claude/skills/learning-research/SKILL.md  -> opencode/skills/learning-research/SKILL.md
#   claude/agents/learning-researcher.md      -> opencode/agents/learning-researcher.md
#   claude/agents/learning.md                 -> opencode/agents/learning.md (body only)
#
# Edit the Claude copy, run `npm run sync:opencode`, commit both. The parity
# lint (`npm test`) fails on any other drift.
set -euo pipefail
cd "$(dirname "$0")/.."

# The research skill: drop the Claude-only frontmatter keys, swap the KB path,
# and turn the substituted script prefix into the relative path opencode uses.
sed -e '/^user-invocable: false$/d' -e '/^allowed-tools: /d' \
    -e 's#~/.claude/learning/#~/.config/opencode/learning/#g' \
    -e 's#\${CLAUDE_SKILL_DIR}/scripts#scripts#g' \
    claude/skills/learning-research/SKILL.md > opencode/skills/learning-research/SKILL.md

# The researcher subagent: opencode frontmatter is description / mode / color
# (its tool restriction lives in .opencode/plugins/learning-agent.js); the body
# is the Claude body with the KB path swapped.
src=claude/agents/learning-researcher.md
dst=opencode/agents/learning-researcher.md
{
  printf -- '---\n'
  sed -n '/^description: /p' "$src"
  printf 'mode: subagent\ncolor: "#7B8D42"\n---\n'
  awk 'f>=2{print} /^---$/{f++}' "$src" | sed 's#~/.claude/learning#~/.config/opencode/learning#g'
} > "$dst"

# The main agent prompt: keep opencode's own frontmatter (description / mode /
# color, hand-maintained), replace the body with the Claude body, KB path swapped.
src=claude/agents/learning.md
main=opencode/agents/learning.md
tmp=$(mktemp)
{
  awk 'f<2{print} /^---$/{f++}' "$main"
  awk 'f>=2{print} /^---$/{f++}' "$src" | sed 's#~/.claude/learning#~/.config/opencode/learning#g'
} > "$tmp"
mv "$tmp" "$main"

echo "synced: opencode/skills/learning-research/SKILL.md, $dst, $main"
