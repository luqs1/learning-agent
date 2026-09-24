# Learning Agent

A learning agent that teaches through questions, problems, and active recall. Built on classical Islamic pedagogy.

Every claim is verified against a persistent, citable knowledge base. The agent will research topics in real-time, store what it finds, and cite its sources.

## Philosophy

**Verify before you teach.** An LLM's fluency is not knowledge; confident output is exactly what a convincing hallucination looks like. So the agent follows a hard rule — *no claim without a source, no source without a file* — grounding every non-trivial fact in cited research before it reaches you (see [Research](#research) for the mechanics).

**The pillars:**

- **Tadarruj** — graduated difficulty. Never advance until the current concept is verified. Ibn Khaldun warned: advancing before mastery causes the student to lose everything.
- **Malaka** — embodied mastery through practice. Deep understanding forms through repeated retrieval, not passive reading.
- **Prophetic method** — question before teaching. Surface the learner's current understanding before explaining anything.
- **Jadal** — structured challenge. Steelman counter-positions to push from surface understanding to genuine depth.
- **'Ilm + 'Amal** — knowledge and action are inseparable. Abstract understanding must be grounded in application.
- **Tawadu** — honesty about the limits of knowledge. Where experts disagree, say so; where the agent is uncertain, it says so. Acknowledging the edge of what is known is a virtue, not a weakness.

**Depth over breadth.** Better to truly understand three concepts than to skim ten — the agent prioritises mastery of fundamentals over coverage.

**Teacher as companion, not lecturer.** The relationship is collegial — a knowledgeable companion in a study circle, not an authority at a podium. It respects you by challenging you rather than flattering you.

## How it works

The agent has three components:

1. **learning agent** — the main system prompt defining pedagogy, tone, and session flow
2. **learning-assessment** — a gate that checks whether a claim is backed by verified, cited research before stating it. Invoked automatically by the agent.
3. **learning-research** — a multi-angle research skill that fetches primary sources, extracts expert perspectives, and stores everything in a persistent knowledge base. Invoked automatically by the agent.

### Session flow

```
Topic introduced
  → Probe current understanding (question)
  → Assessment gate checks knowledge base
  → If gaps exist, research fills them (multi-angle: technical, expert perspective, contested areas)
  → Teach with citations [source: filename.md]
  → Comprehension check (question or problem)
  → Correct/affirm, fill gaps
  → Teach next concept
  → ... repeat ...
  → Periodic synthesis checkpoint
  → Application exercise
  → Challenge/counter-argument
  → Final synthesis and consolidation
```

### Research

The agent never states a non-trivial fact without first verifying it against a persistent knowledge base. When it encounters a topic or concept it hasn't researched yet, it:

1. **Searches** from three angles — technical accuracy, expert/practitioner perspective, and contested or uncertain areas
2. **Fetches and reads** primary sources (official docs, papers, practitioner blog posts — not summaries)
3. **Stores** the research as structured markdown files, one per concept, with citations
4. **Cites** every claim with `[source: filename.md]`

Research persists across sessions. If you come back to a topic later, the agent reads what it already has and only researches what's new.

## Supported tools

- [opencode](https://opencode.ai)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)

## Install

### opencode

**Prerequisites:** [opencode](https://opencode.ai) installed and configured.

```bash
opencode plugin learning-agent@git+https://github.com/luqs1/learning-agent.git -g
```

This installs the plugin globally and registers the learning agent and its sub-skills automatically. Restart opencode after installing.

Select the **learning** agent from the agent list (Tab key) to start a session.

Knowledge base is stored at `~/.config/opencode/learning/<topic-slug>/`.

### Claude Code

Inside Claude Code, run:

```
/plugin marketplace add luqs1/learning-agent
/plugin install learning-agent@learning-agent
```

To update when new versions are released:

```
/plugin update learning-agent@learning-agent
```

There are two ways to use it:

**Full session (recommended):**

```bash
claude --agent learning-agent:learning
```

The learning agent runs as the agent for the entire session. Every message goes through the learning prompt — probing questions, layered teaching, comprehension checks, the lot.

You can add a shell alias to make this shorter:

```bash
# Add to your .bashrc or .zshrc
alias learn='claude --agent learning-agent:learning'
```

**Quick fork via slash command:**

Inside any Claude Code session, type `/learn <topic>`. This spins up the learning agent in a temporary forked context — good for "quick, teach me this thing" moments without leaving what you're doing.

Knowledge base is stored at `~/.claude/learning/<topic-slug>/`.

## Session traces

Every session also writes a small JSONL trace next to the knowledge base
(`<kb-root>/.traces/<topic-slug>/<timestamp>.jsonl`): one line per gate
decision, research query, file written, teaching step and comprehension check.
`npm run trace` (from a checkout of this repo) prints the latest one as a
timeline. Traces exist so prompt changes can be tested; see
[tests/README.md](./tests/README.md) for the format and the test suites.

## Uninstall

**opencode:**

Remove the plugin line from `~/.config/opencode/opencode.json` and restart opencode.

**Claude Code:**

```
/plugin uninstall learning-agent@learning-agent
```
