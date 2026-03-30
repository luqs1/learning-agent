# learning-agent

A learning agent that teaches through questions, problems, and active recall — not lecturing. Built on classical Islamic pedagogy: Tadarruj (graduated difficulty), Malaka (embodied mastery), Jadal (structured challenge), and the inseparability of knowledge and action.

Every claim is verified against a persistent, citable knowledge base before it reaches you. The agent will research topics in real-time, store what it finds, and cite its sources.

## How it works

The agent has three components:

1. **learning agent** — the main system prompt defining pedagogy, tone, and session flow
2. **learning-assessment** — a gate that checks whether a claim is backed by verified, cited research before stating it. Hidden from the user — invoked automatically by the agent.
3. **learning-research** — a multi-angle research skill that fetches primary sources, extracts expert perspectives, and stores everything in a persistent knowledge base. Hidden from the user — invoked automatically by the agent.

The flow:

```
Topic introduced
  → Assessment gate checks knowledge base
  → If gaps exist, research fills them (multi-angle: technical, expert perspective, contested areas)
  → Teach with citations [source: filename.md]
  → Comprehension check (question or problem)
  → Repeat
```

Research persists across sessions. If you come back to a topic later, the agent reads what it already has and only researches what's new.

## Supported tools

- [opencode](https://opencode.ai)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

## Install

### opencode

**Prerequisites:** [opencode](https://opencode.ai) installed and configured.

```bash
# Clone the repo
git clone https://github.com/luqs1/learning-agent.git ~/repos/learning-agent

# Create directories if they don't exist
mkdir -p ~/.config/opencode/agents
mkdir -p ~/.config/opencode/skills

# Symlink agent
ln -s ~/repos/learning-agent/opencode/agents/learning.md ~/.config/opencode/agents/learning.md

# Symlink skills
ln -s ~/repos/learning-agent/opencode/skills/learning-assessment ~/.config/opencode/skills/learning-assessment
ln -s ~/repos/learning-agent/opencode/skills/learning-research ~/.config/opencode/skills/learning-research
```

**Usage:** Open opencode and select the **learning** agent from the agent list. The agent takes over the entire session — every message goes through the learning prompt.

**Knowledge base:** `~/.config/opencode/learning/<topic-slug>/`

### Claude Code (plugin)

The easiest way to install. Inside Claude Code, run:

```
/plugin marketplace add luqs1/learning-agent
/plugin install learning-agent@learning-agent
```

To update when new versions are released:

```
/plugin update learning-agent@learning-agent
```

### Claude Code (manual)

If you prefer symlinks over the plugin system:

```bash
# Clone the repo
git clone https://github.com/luqs1/learning-agent.git ~/repos/learning-agent

# Create directories if they don't exist
mkdir -p ~/.claude/agents
mkdir -p ~/.claude/skills

# Symlink agent
ln -s ~/repos/learning-agent/claude/agents/learning ~/.claude/agents/learning

# Symlink skills
ln -s ~/repos/learning-agent/claude/skills/learn ~/.claude/skills/learn
ln -s ~/repos/learning-agent/claude/skills/learning-assessment ~/.claude/skills/learning-assessment
ln -s ~/repos/learning-agent/claude/skills/learning-research ~/.claude/skills/learning-research
```

**Usage:** There are two ways to use it:

#### Full session (recommended)

```bash
claude --agent learning
```

Starts Claude Code with the learning agent as **the** agent for the entire session. Every message you send goes through the learning prompt. This is the full experience — probing questions, layered teaching, comprehension checks, the lot.

#### Quick fork via slash command

Inside any Claude Code session:

```
/learn <topic>
```

This spins up the learning agent in a **temporary forked context**. It teaches you the topic, then you're back to your normal session. Good for "quick, teach me this thing" moments without leaving what you're doing.

**Knowledge base:** `~/.claude/learning/<topic-slug>/`

## Uninstall

**Claude Code (plugin):**

```
/plugin uninstall learning-agent@learning-agent
```

**Claude Code (manual):**

```bash
rm ~/.claude/agents/learning
rm ~/.claude/skills/learn
rm ~/.claude/skills/learning-assessment
rm ~/.claude/skills/learning-research
```

**opencode:**

```bash
rm ~/.config/opencode/agents/learning.md
rm ~/.config/opencode/skills/learning-assessment
rm ~/.config/opencode/skills/learning-research
```

Then optionally delete the repo and knowledge base directories.
