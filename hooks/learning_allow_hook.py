#!/usr/bin/env python3
"""
PreToolUse hook for the learning-agent plugin.

Auto-allows:
- Write/Edit to ~/.claude/learning/ (always, by path check)
- Bash commands for session lifecycle (mkdir/touch/rm on the marker file)
- Research tools (WebSearch, WebFetch, Read, Grep, Glob, Agent) ONLY when
  a learning session is active (marker file exists)

The marker file ~/.claude/learning/.session-active is created by the
learning skill at session start and removed at session end.
"""
import json
import os
import re
import sys

MARKER_FILE = os.path.expanduser("~/.claude/learning/.session-active")

# Directories the learning agent writes to
ALLOWED_PATHS = [
    os.path.expanduser("~/.claude/learning/"),
    os.path.expanduser("~/.claude/plugins/marketplaces/learning-agent/"),
]

# Tools allowed only when a learning session is active (marker exists)
SESSION_GATED_TOOLS = {
    "WebSearch",
    "WebFetch",
    "Read",
    "Grep",
    "Glob",
    "Agent",
}

# Tools allowed if targeting learning directories (no session gate needed)
PATH_CHECKED_TOOLS = {
    "Write",
    "Edit",
}


# Bash commands that are always allowed (session lifecycle)
ALLOWED_BASH_PATTERNS = [
    re.compile(r"^mkdir -p ~/\.claude/learning\b"),
    re.compile(r"^touch ~/\.claude/learning/\.session-active$"),
    re.compile(r"^rm -f ~/\.claude/learning/\.session-active$"),
    re.compile(r"^mkdir -p ~/\.claude/learning && touch ~/\.claude/learning/\.session-active$"),
]


def is_allowed_bash(command):
    """Check if a Bash command is an allowed session lifecycle command."""
    if not command:
        return False
    cmd = command.strip()
    return any(p.match(cmd) for p in ALLOWED_BASH_PATTERNS)


def is_learning_path(file_path):
    """Check if a file path is within the learning agent's directories."""
    if not file_path:
        return False
    expanded = os.path.expanduser(file_path)
    resolved = os.path.realpath(expanded)
    for allowed in ALLOWED_PATHS:
        resolved_allowed = os.path.realpath(allowed)
        if resolved.startswith(resolved_allowed):
            return True
    return False


def is_session_active():
    """Check if a learning session is currently active."""
    return os.path.exists(MARKER_FILE)


def allow():
    print(json.dumps({
        "hookSpecificOutput": {
            "permissionDecision": "allow"
        }
    }))
    sys.exit(0)


def passthrough():
    """Don't interfere — let normal permission flow handle it."""
    print(json.dumps({}))
    sys.exit(0)


def main():
    data = json.load(sys.stdin)
    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input", {})

    # Bash: allow session lifecycle commands (mkdir, touch, rm on marker)
    if tool_name == "Bash":
        command = tool_input.get("command", "")
        if is_allowed_bash(command):
            allow()
        passthrough()

    # Write/Edit: allow if targeting learning directories (no session gate)
    if tool_name in PATH_CHECKED_TOOLS:
        file_path = tool_input.get("file_path", "")
        if is_learning_path(file_path):
            allow()
        passthrough()

    # Research tools: allow only if a learning session is active
    if tool_name in SESSION_GATED_TOOLS:
        if is_session_active():
            allow()
        passthrough()

    passthrough()


if __name__ == "__main__":
    main()
