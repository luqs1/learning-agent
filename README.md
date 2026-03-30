# learning-agent

A learning agent that teaches through questions, problems, and active recall — not lecturing. Built on classical Islamic pedagogy: Tadarruj (graduated difficulty), Malaka (embodied mastery), Jadal (structured challenge), and the inseparability of knowledge and action.

Every claim is verified against a persistent, citable knowledge base before it reaches you. The agent will research topics in real-time, store what it finds, and cite its sources.

## Supported tools

- [opencode](https://opencode.ai)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

## Install

### opencode

```bash
# Clone the repo
git clone https://github.com/luqs1/learning-agent.git ~/repos/learning-agent

# Symlink agent
ln -s ~/repos/learning-agent/opencode/agents/learning.md ~/.config/opencode/agents/learning.md

# Symlink skills
ln -s ~/repos/learning-agent/opencode/skills/learning-assessment ~/.config/opencode/skills/learning-assessment
ln -s ~/repos/learning-agent/opencode/skills/learning-research ~/.config/opencode/skills/learning-research
```

Then select the **learning** agent in opencode.

Knowledge base is stored at `~/.config/opencode/learning/`.

### Claude Code

```bash
# Clone the repo
git clone https://github.com/luqs1/learning-agent.git ~/repos/learning-agent

# Symlink agent
ln -s ~/repos/learning-agent/claude/agents/learning ~/.claude/agents/learning

# Symlink skills
ln -s ~/repos/learning-agent/claude/skills/learn ~/.claude/skills/learn
ln -s ~/repos/learning-agent/claude/skills/learning-assessment ~/.claude/skills/learning-assessment
ln -s ~/repos/learning-agent/claude/skills/learning-research ~/.claude/skills/learning-research
```

**Usage:**

```bash
# Start a full learning session
claude --agent learning

# Or activate mid-conversation with the slash command
/learn <topic>
```

Knowledge base is stored at `~/.claude/learning/`.

## How it works

The agent has three components:

1. **learning agent** — the main system prompt defining pedagogy, tone, and session flow
2. **learning-assessment** — a gate that checks whether a claim is backed by verified, cited research before stating it
3. **learning-research** — a multi-angle research skill that fetches primary sources, extracts expert perspectives, and stores everything in a persistent knowledge base

The flow: topic introduced → assessment gate checks knowledge base → if gaps exist, research fills them → teach with citations → comprehension check → repeat.

Research persists across sessions. If you come back to a topic later, the agent reads what it already has and only researches what's new.
