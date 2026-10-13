---
name: learn
description: Start a guided learning session on any topic. Uses questions, problems, and active recall instead of lecturing.
argument-hint: <topic>
---

Start a learning session on: $ARGUMENTS

If no topic was provided, ask the user what they want to learn about.

# Choose where the session runs

A learning session is a conversation: questions, answers, recall checks. Run it
where that conversation is easiest for the user. Decide from what happened in
this conversation before `/learn` was typed:

- **Inline**: nothing came before it (this is the first message, or only
  `/clear` and other built-in commands came before it), or the earlier
  conversation is finished and the user is now turning to learning. Most
  `/learn` invocations are inline.
- **Fork**: the user is in the middle of other work, such as a coding task,
  a debugging session, or a research thread with work still to do, and the
  topic is a detour from it ("while we're here, teach me X"). Forking keeps
  the work context clean and lets the work carry on.

When it is unclear, choose inline.

## Inline

1. Read `${CLAUDE_SKILL_DIR}/../../agents/learning.md`. Its body (everything
   after the frontmatter) is your system prompt for the rest of this session.
   Follow it exactly as if you were the `learning` agent.
2. That agent preloads two skills. Load them with the Skill tool before you
   teach: `learning-agent:learning-assessment` and
   `learning-agent:learning-research`.
3. Start the session on the topic above. You talk to the user directly, one
   turn at a time, as the prompt describes.

## Fork

1. Launch the learning agent with the Agent tool:
   `subagent_type: "learning-agent:learning"`, a short `description`, and a
   prompt that holds the topic and a brief of the surrounding work: what the
   user is building, the files or concepts in play, and why this topic came up.
   The agent cannot see this conversation, so the brief is all it has.
2. Tell the user in one line that the session is running alongside their work.
   Then carry on with the work.
3. When the agent replies, show its question or message to the user exactly
   as written. Send the user's answers back with SendMessage to the same
   agent, so it keeps its context. Do not answer for the user, and do not
   rewrite the agent's questions.
