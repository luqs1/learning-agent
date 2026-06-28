---
name: learn
description: Start a guided learning session on any topic. Uses questions, problems, and active recall instead of lecturing.
argument-hint: <topic>
context: fork
agent: learning
---

## Session Lifecycle

**At the very start of every learning session**, before doing anything else:
1. Run `mkdir -p ~/.claude/learning && touch ~/.claude/learning/.session-active`

This marker file signals to the plugin's hooks that a learning session is active, enabling auto-approval of research tools (WebSearch, WebFetch, Read, etc.) so the session runs smoothly without constant permission prompts.

**When the session ends** (user says stop, goodbye, or switches topic):
1. Run `rm -f ~/.claude/learning/.session-active`

---

Start a learning session on: $ARGUMENTS

If no topic was provided, ask the user what they want to learn about.
