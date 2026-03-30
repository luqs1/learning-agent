---
name: learning-assessment
description: Use when teaching any claim or concept in the Learning agent, before stating facts to the user
user-invocable: false
---

# Learning Assessment Gate

## Overview

LLMs hallucinate. Training data is stale. Confident-sounding output is not the same as verified knowledge.

**Core principle:** Every non-trivial claim must be grounded in verified, cited research before it reaches the user.

**Violating the letter of this process is violating the spirit of honest teaching.**

## The Iron Law

```
NO CLAIM WITHOUT A SOURCE. NO SOURCE WITHOUT A FILE.
```

If you cannot point to a file in the topic knowledge base that supports a claim, you cannot make that claim until you have researched it.

## When to Use

Invoke this assessment at these three trigger points:

1. **Session start** - When the user introduces a topic for the first time
2. **Before a new concept** - Before teaching any concept not yet verified in this session
3. **On the fly** - When the user asks something that goes beyond what is already in the knowledge base

## Self-Assessment Checklist

Run through each item. A single "No" means: invoke `learning-research` before continuing.

- [ ] Is there a topic folder at `~/.claude/learning/<topic-slug>/`?
- [ ] Does `sources.md` exist in that folder with at least one credible source?
- [ ] Is the specific claim I am about to make covered in one of the topic `.md` files?
- [ ] Can I point to the exact file and section that supports this claim?
- [ ] Is the source primary or authoritative (official docs, peer-reviewed paper, direct author content) rather than a secondary summary?
- [ ] Is the claim I'm making within what the source actually says, not an extrapolation?

## Citation Format

Every non-trivial factual claim must be followed by a citation:

> SGD uses a randomly sampled subset of data to estimate the true gradient [source: sgd-batching.md]

If you cannot add this citation, you cannot make the claim yet.

## Red Flags - STOP

If you catch yourself thinking any of these, invoke `learning-research` immediately:

- "I'm pretty sure this is right"
- "This is general knowledge, I don't need to look it up"
- "I'll verify later if they ask"
- "I covered this in training data"
- "This is obvious / well-known"
- You are extrapolating beyond what the source says
- You cannot remember where you read something

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "This is basic, no need to verify" | Basic facts are the most confidently hallucinated. |
| "I just explained it and it sounded right" | Coherent does not mean correct. The best hallucinations sound right. |
| "The user didn't ask for sources" | They are trusting you. That trust requires verification. |
| "Research would interrupt the flow" | A wrong explanation does more damage than a pause. |
| "I've seen this many times in training" | Training data contains errors. Verify anyway. |

## After Assessment Passes

Continue teaching. Append `[source: filename.md]` to claims. If the user asks for more detail than the knowledge base contains, run assessment again - it will fail, triggering research.

**Required sub-skill for when assessment fails:**
- **`learning-research`** - Run this to gather and store verified knowledge before continuing
