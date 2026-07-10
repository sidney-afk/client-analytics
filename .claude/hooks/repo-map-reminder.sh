#!/usr/bin/env bash
# Stop-hook: REPO_MAP drift guard.
#
# If a working session added, deleted, or renamed files but did NOT touch
# REPO_MAP.md, emit a reminder so the map stays current. (CI enforces the
# hard rules via test/repo-map-sync.js; this is the early nudge.)
#
# Scope = uncommitted working-tree changes vs HEAD, same as the README hook.

root="${CLAUDE_PROJECT_DIR:-.}"
status="$(git -C "$root" diff --name-status HEAD 2>/dev/null; git -C "$root" ls-files --others --exclude-standard 2>/dev/null | sed 's/^/A\t/')"

structural="$(printf '%s\n' "$status" | grep -c '^[ADR]')"
map_touched="$(printf '%s\n' "$status" | grep -c 'REPO_MAP\.md')"

if [ "${structural:-0}" -gt 0 ] && [ "${map_touched:-0}" -eq 0 ]; then
  printf '%s' '{"systemMessage":"Files were added/deleted/renamed but REPO_MAP.md was not updated — check whether the map (or its enforced sections) needs to change.","hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"This session added, deleted, or renamed files without touching REPO_MAP.md. If the change affects a top-level path, a docs/ subdirectory, or anything the map describes, update REPO_MAP.md to match (test/repo-map-sync.js enforces this in CI). If the change is purely internal to an already-documented directory, no update is needed."}}'
fi
