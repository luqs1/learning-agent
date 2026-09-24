# Learning Agent

A learning agent that teaches through questions, problems, and active recall instead of lecturing you. Every claim is verified against a persistent, citable knowledge base: the agent researches topics in real time, stores what it finds, and cites its sources.

The method is drawn from the classical Islamic scholarly tradition of teaching, which worked out in detail how people come to know things — see [Where the method comes from](#where-the-method-comes-from).

## Philosophy

**Verify before you teach.** An LLM's fluency is not knowledge; confident output is exactly what a convincing hallucination looks like. So the agent follows a hard rule — *no claim without a source, no source without a file* — grounding every non-trivial fact in cited research before it reaches you (see [Research](#research) for the mechanics).

**The pillars:**

- **Graduated difficulty** (*Tadarruj*, "step by step") — never advance until the current concept is verified. Ibn Khaldun, the 14th-century historian and social theorist, warned that advancing before mastery causes the student to lose everything.
- **Mastery through practice** (*Malaka*, a "deeply rooted faculty") — deep understanding forms through repeated retrieval, not passive reading. Ibn Khaldun's term for knowledge that has become second nature.
- **Question before teaching** (the Prophetic method) — surface the learner's current understanding before explaining anything. Named for the Prophet Muhammad's habit of opening a lesson with "Do you know what X is?" and only then giving the answer.
- **Structured challenge** (*Jadal*, "disputation") — steelman counter-positions to push from surface understanding to genuine depth. The formal debate practice of the classical scholarly tradition.
- **Knowledge tied to action** (*'Ilm* and *'Amal*, "knowledge" and "action") — the two are inseparable. Abstract understanding must be grounded in application.
- **Honesty about the limits of knowledge** (*Tawadu*, "humility") — where experts disagree, say so; where the agent is uncertain, it says so. Acknowledging the edge of what is known is a virtue, not a weakness.

**Depth over breadth.** Better to truly understand three concepts than to skim ten — the agent prioritises mastery of fundamentals over coverage.

**Teacher as companion, not lecturer.** The relationship is collegial — a knowledgeable companion in a *halaqa* (the traditional study circle, where students sit in a ring around the teacher rather than in rows facing a podium). It respects you by challenging you rather than flattering you.

### Where the method comes from

The pillars are not a modern framework with Arabic labels attached. They come from the classical Islamic tradition of teaching and learning, whose scholars spent centuries working out how knowledge is actually acquired and passed on. Ibn Khaldun (1332–1406), best known for the *Muqaddimah*, is the source for graduated difficulty and mastery through practice; questioning before teaching goes back to the Prophet Muhammad; disputation and the study circle were the everyday institutions of that scholarly world for a thousand years. The agent borrows the method, not the subject matter — it will teach you Rust or Roman history the same way.

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

### Use it for research

The same verify-and-cite engine works for questions that are not lessons — sizing a market, mapping funded competitors, checking a hypothesis against the evidence. A dedicated research mode that swaps the teaching loop for a brief-building loop (every number cited, contested and unknown areas called out) is coming via [issue #9](https://github.com/luqs1/learning-agent/issues/9); until then, the teaching mode will still research and cite, it just insists on teaching you along the way.

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
