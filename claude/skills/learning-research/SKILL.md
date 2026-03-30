---
name: learning-research
description: Use when the Learning agent needs to gather verified knowledge on a topic before teaching it
user-invocable: false
---

# Learning Research

## Overview

Before teaching, gather. Before claiming, verify. Before citing, store.

This skill produces a persistent, citable knowledge base the Learning agent draws from for the rest of the session and in future sessions on the same topic.

## Knowledge Base Location

All research is stored at: `~/.claude/learning/<topic-slug>/`

**Deriving the topic slug:**
- Use the conversation topic, lowercased, spaces replaced with hyphens
- Keep it stable across sessions (don't invent a new slug each time)
- Examples: `makemore-neural-networks`, `linux-networking`, `rust-ownership-model`

## Phase 1: Setup

1. Derive the topic slug from the current conversation
2. Check if `~/.claude/learning/<topic-slug>/` exists
3. If not, create it: `mkdir -p ~/.claude/learning/<topic-slug>/`
4. Check if `sources.md` exists - if so, read it to understand what has already been researched
5. If not, create it with the header:
   ```markdown
   # Sources: <Topic Name>

   | URL | Title | Date Accessed | Credibility | Summary |
   |-----|-------|---------------|-------------|---------|
   ```

## Phase 2: Multi-Angle Research

For each concept that needs grounding, run **three angles** of search:

### Angle 1: Technical Accuracy

Search for: the precise technical definition, mechanism, or process.
Goal: establish what is factually correct.

Example searches:
- `"[concept] explained site:arxiv.org OR site:pytorch.org OR site:cs.stanford.edu"`
- `"[concept] official documentation"`
- The original paper or primary source if one exists

### Angle 2: Expert Mindset and Prioritization

Search for: how practitioners in the field actually think about this topic.
Goal: understand what experts emphasize, what they deprioritize, what they consider the key insight vs. a detail, and what debates exist.

This angle is NOT optional. Technical facts without practitioner perspective produce textbook knowledge, not real understanding.

Example searches:
- `"[concept] what actually matters practitioners"`
- `"[concept] common misconceptions experts"`
- `"[concept] [known expert name]"` (e.g. Andrej Karpathy, Yann LeCun, or whoever is authoritative in the domain)
- Blog posts, talks, and interviews from recognized practitioners
- Look specifically for: "most people get X wrong about Y", "the key insight is", "don't waste time on", "I wish I'd known"

What to capture:
- What do experts spend their time on vs. what do beginners fixate on?
- What do experts consider the real bottleneck or core insight?
- What do they explicitly say is overrated or a distraction?
- What is their mental model - how do they think about the problem differently from a textbook?

### Angle 3: Contested and Uncertain Areas

Search for: where the field disagrees, where knowledge is evolving, or where sources conflict.
Goal: know what NOT to teach as settled fact.

Example searches:
- `"[concept] debate" OR "[concept] controversy" OR "[concept] still unknown"`
- `"[concept] limitations"`
- Compare multiple sources for disagreements

## Phase 3: Fetch and Read Primary Sources

For each search angle, fetch at least one primary source (not a summary):
- Official documentation pages
- Original papers (arxiv, etc.)
- The practitioner's own blog post or talk transcript - NOT a summary of their work

Read them. Do not skim. Extract exact quotes where they support key claims.

## Phase 4: Store Research

For each concept researched, create or update `~/.claude/learning/<topic-slug>/<concept-slug>.md`:

```markdown
# [Concept Name]

**Last updated:** YYYY-MM-DD
**Sources used:** [list titles with links]

## Technical Facts

[Numbered facts. Each must be traceable to a specific source.]

1. [Fact]. [source: URL or title]
2. [Fact]. [source: URL or title]

## Expert Perspective

[How do practitioners in this field think about this concept?
What do they emphasize? What do they consider a common mistake?
What is the key insight that separates surface understanding from deep understanding?
Quote or paraphrase practitioners directly, with source.]

## Contested / Uncertain

[What do sources disagree on? What is still an open question?
What should NOT be taught as settled fact?]

## What NOT to Over-Emphasize

[What do experts say is commonly over-emphasized or a distraction?]
```

Add each fetched source to `sources.md`:

```
| [URL] | [Title] | [Today's date] | [High/Medium/Low] | [One-line summary] |
```

Credibility guide:
- **High**: Original paper, official docs, direct author content (their own blog, talk, or repo)
- **Medium**: Reputable textbook, well-known practitioner blog, major educational resource
- **Low**: Secondary summary, unknown author, undated content

## Phase 5: Return Summary

After storing, produce a brief internal summary:

```
Research complete for: [concept]
Files created/updated: [list]
Key verified facts: [bullet list]
Key expert perspectives gathered: [bullet list]
Uncertain areas flagged: [bullet list]
Ready to teach with citations.
```

Then return to the Learning agent's teaching flow.

## Returning to an Existing Knowledge Base

If a topic folder already exists with research from a prior session:

1. Read `sources.md` and all existing concept files
2. Assess whether the existing research covers what is needed now
3. If yes, skip research for those concepts - cite the existing files
4. If no, run only the phases needed to fill the gaps
5. Do NOT re-research what is already stored and still accurate

## Important Rules

- NEVER skip Phase 2 Angle 2 (expert mindset). Technical facts without practitioner perspective produce textbook knowledge, not real understanding.
- NEVER summarize a source without fetching and reading it. Search snippets are not sources.
- NEVER store a claim without a URL or direct reference.
- If a source contradicts training knowledge, trust the source.
- If sources contradict each other, record both views in the Contested section.
- Keep concept files focused. One concept per file. Split if a file exceeds ~200 lines.
