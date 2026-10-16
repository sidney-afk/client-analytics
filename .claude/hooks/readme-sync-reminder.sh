#!/usr/bin/env bash
# Stop-hook: README drift guard.
#
# If a working session changed the app's source (src/index/; index.html is
# built from it and not committed since 2026-10-15) but did NOT touch
# README.md, emit a reminder so the README is kept in sync with the app.
#
# Scope = uncommitted working-tree changes vs HEAD, i.e. the current session's
# in-progress edits. Once you commit, the reminder stops (the commit is treated
# as a deliberate checkpoint). Edit or disable this via /hooks or
# .claude/settings.json.

root="${CLAUDE_PROJECT_DIR:-.}"
files="$(git -C "$root" diff --name-only HEAD 2>/dev/null)"

if printf '%s\n' "$files" | grep -q '^src/index/' && ! printf '%s\n' "$files" | grep -qx 'README.md'; then
  printf '%s' '{"systemMessage":"the app (src/index/) changed but README.md did not — update README.md to keep it in sync.","hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"This session modified the app source in src/index/ but not README.md. If the change affects what README.md documents (features, architecture, data sources, or dev/deploy steps), update README.md to match. If the change is purely internal and alters nothing the README describes, no update is needed."}}'
fi
