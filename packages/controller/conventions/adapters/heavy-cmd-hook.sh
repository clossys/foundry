#!/usr/bin/env bash
# Pre-tool-use adapter for a shared resource-discipline policy: detect a
# command likely to spike memory or CPU on a constrained machine, and hand it
# to a configured preflight check before it runs.
#
# This is a thin permission response, not a policy. The policy itself --
# which commands count as heavy, and what a preflight check should verify --
# belongs to whichever plane configures this hook; this file only maps one
# product's hook JSON onto that configuration and is deliberately the
# smallest thing that can do that.
#
# Configuration, all through the environment so that nothing here encodes one
# operator's tooling:
#
#   HEAVY_CMD_PATTERN            optional; an extended-regex (grep -E)
#                                 tested against the tool command. When
#                                 unset, a small generic default covers
#                                 common monorepo-wide package-manager
#                                 operations (install, build, typecheck, and
#                                 a recursive "run everything" form). A plane
#                                 with its own heavier script names extends
#                                 this by setting its own pattern -- this
#                                 file ships with no account's own script
#                                 vocabulary baked in.
#   HEAVY_CMD_PREFLIGHT_COMMAND   optional; the name or path of the command
#                                 to run when a heavy command is detected,
#                                 resolved through PATH. When unset, this
#                                 hook still reports what it detected but
#                                 says plainly that it could not run a check.
#
# This is advisory, never a permission decision -- it always exits 0.
#
# DELIBERATE, recorded here so the difference from this directory's two
# protection hooks (branch-provenance-hook.sh, scoped-main-push.sh) is a
# decision and not an accident: those hooks guard an irreversible action
# (a push to the default branch) where an unconfigured guard must not read
# as a working one, so an unset required variable there now yields an
# explicit `ask` decision rather than silently continuing. This hook only
# ever prints advice about a resource check that could not run -- skipping
# it risks a slow or memory-heavy command, never a broken invariant -- so
# degrading open (continue, warn on stderr-visible stdout, never block) is
# the correct default, not a smaller version of the same bug.

set -u

if command -v jq >/dev/null 2>&1; then
  tool_cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null)
else
  tool_cmd=$(python3 -c 'import sys, json
try:
    data = json.load(sys.stdin)
    print(data.get("tool_input", {}).get("command", ""))
except Exception:
    pass' 2>/dev/null)
fi

[[ -z "${tool_cmd:-}" ]] && exit 0

pattern="${HEAVY_CMD_PATTERN:-pnpm install|npm install|npm ci|pnpm build|npm run build|pnpm typecheck|npm run typecheck|pnpm -r run|npm --workspaces run}"
printf '%s\n' "$tool_cmd" | grep -qE "$pattern" || exit 0

echo "[resource preflight -- heavy command detected]"
echo "Command: $tool_cmd"

preflight="${HEAVY_CMD_PREFLIGHT_COMMAND:-}"
if [[ -n "$preflight" ]] && command -v "$preflight" >/dev/null 2>&1; then
  "$preflight" || true
else
  echo "WARNING: HEAVY_CMD_PREFLIGHT_COMMAND is unset or not found on PATH -- skipping the resource check."
fi

exit 0
