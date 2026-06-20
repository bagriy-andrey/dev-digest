#!/usr/bin/env bash
# UserPromptSubmit hook — engineering-insights "automatic read".
#
# Detects the module(s) named/implied in the user's prompt and injects that module's
# insights.md into context BEFORE the agent works — but only when the file has real
# entries (so empty templates add no noise). Deterministic, cheap, always exits 0.
# Written for portability (no bash-4 features, no `set -u` array traps; macOS bash 3.2 ok).

ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." 2>/dev/null && pwd)}"
[ -n "$ROOT" ] || exit 0

# --- read the prompt from stdin JSON: jq -> python3 -> sed fallback ---
raw="$(cat)"
prompt=""
if command -v jq >/dev/null 2>&1; then
  prompt="$(printf '%s' "$raw" | jq -r '.user_prompt // empty' 2>/dev/null)"
fi
if [ -z "$prompt" ] && command -v python3 >/dev/null 2>&1; then
  prompt="$(printf '%s' "$raw" | python3 -c 'import sys,json
try: sys.stdout.write(str(json.load(sys.stdin).get("user_prompt","")))
except Exception: pass' 2>/dev/null)"
fi
if [ -z "$prompt" ]; then
  prompt="$(printf '%s' "$raw" | sed -n 's/.*"user_prompt"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
fi

lc="$(printf '%s' "$prompt" | tr '[:upper:]' '[:lower:]')"
[ -n "$lc" ] || exit 0

# --- keyword -> module insights.md (word-boundary the short, ambiguous tokens) ---
m() { printf '%s' "$lc" | grep -Eq "$1"; }
files=""
if m 'server|fastify|drizzle|repo-intel|migration|(^|[^a-z])api([^a-z]|$)';  then files="$files server/insights.md"; fi
if m 'client|next|tanstack|(^|[^a-z])web([^a-z]|$)|(^|[^a-z])ui([^a-z]|$)';   then files="$files client/insights.md"; fi
if m 'reviewer-core|grounding|finding|review engine';                        then files="$files reviewer-core/insights.md"; fi
if m 'e2e|agent-browser|browser|(^|[^a-z])flow([^a-z]|$)';                    then files="$files e2e/insights.md"; fi
if m 'shared|vendor|monorepo|dev\.sh|lockfile|secret';                       then files="$files insights.md"; fi

[ -n "$files" ] || exit 0

# --- emit only files that actually have entries (a line starting with "- ") ---
emitted=0
buf=""
for f in $files; do
  p="$ROOT/$f"
  [ -f "$p" ] || continue
  if grep -Eq '^[[:space:]]*-[[:space:]]' "$p"; then
    buf="$buf
=== $f ===
$(cat "$p")
"
    emitted=1
  fi
done

if [ "$emitted" -eq 1 ]; then
  printf '%s\n%s\n' \
    "Relevant module insights for this task (high-confidence guidance — read before working):" \
    "$buf"
fi
exit 0
