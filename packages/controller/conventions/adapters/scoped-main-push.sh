#!/usr/bin/env bash
# Pre-tool-use adapter: protect the default branch and enforce branch
# provenance inside a discovered canonical workspace tree.
#
# This is a thin permission response, not a policy. The policy is
# documents/branch-provenance.md; this file only maps one product's hook
# JSON onto it, restricted to paths a canonical-workspace layout heuristic
# recognizes, and is deliberately the smallest thing that can do that. It
# complements branch-provenance-hook.sh rather than replacing it: that file
# takes an explicit, configured glob list; this one instead recognizes the
# `<root>/projects/*/repos/*` / `<root>/projects/*/worktrees/*` shape
# directly, for an operator whose canonical layout already follows it.
#
# Configuration, all through the environment so that nothing here encodes one
# operator's topology:
#
#   AGENT_BRANCH_PREFIX   required for the branch-provenance rule; the
#                         creating agent's prefix, e.g. "claude". Default-
#                         branch push protection below does not read this
#                         variable and stays fully enforced without it --
#                         only the branch-naming check needs it, and when
#                         it is unset that check asks rather than silently
#                         passing. See the unset handling below.
#   CODE_WORKSPACE_ROOT   optional; the discovery root under which the
#                         canonical `projects/*/repos/*` and
#                         `projects/*/worktrees/*` shape is recognized.
#                         Defaults to "$HOME/code" -- a per-operator runtime
#                         value, never a literal path in this file.
#
# Emits a deny/ask decision on stdout, or nothing at all to stay out of the way.

set -u

prefix="${AGENT_BRANCH_PREFIX:-}"

input=$(cat)

if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
  cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
else
  _extract='import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
key = sys.argv[1]
print(d.get("tool_input", {}).get("command", "") if key == "command" else d.get("cwd", ""))'
  cmd=$(printf '%s' "$input" | python3 -c "$_extract" command 2>/dev/null)
  cwd=$(printf '%s' "$input" | python3 -c "$_extract" cwd 2>/dev/null)
fi

[[ -z "${cmd:-}" ]] && exit 0

resolved_cwd="$cwd"
if [[ -n "$cwd" ]] && cd "$cwd" 2>/dev/null; then
  resolved_cwd="$(pwd -P)"
fi

workspace="${CODE_WORKSPACE_ROOT:-$HOME/code}"
if [[ -d "$workspace" ]] && cd "$workspace" 2>/dev/null; then
  workspace="$(pwd -P)"
fi
case "$resolved_cwd" in
  ${workspace}/projects/*/repos/*|${workspace}/projects/*/worktrees/*|${workspace}/projects/*/worktrees/*/*)
    canonical_workspace=true
    ;;
  *)
    canonical_workspace=false
    ;;
esac

# Cover `git switch -c`, `git checkout -b`, and the bare `git branch <name>`
# creation form. Flag forms of `git branch` (-D, -d, -a, -r, --show-current)
# are read or delete operations, not creation, and must not have their flag
# mistaken for a branch name. Anchored to the start of a command or to a shell
# separator so that prose merely mentioning `git branch <name>` -- a commit
# message, a pull request body, these very comments -- is never read as an
# invocation.
created_branch=$(printf '%s\n' "$cmd" | sed -nE 's/(^|&&|;|\|)[[:space:]]*git (switch -c|checkout -b)[[:space:]]+([^[:space:];|&]+).*/\3/p' | head -n 1)
if [[ -z "$created_branch" ]]; then
  created_branch=$(printf '%s\n' "$cmd" | sed -nE 's/(^|&&|;|\|)[[:space:]]*git branch[[:space:]]+([^-[:space:];|&][^[:space:];|&]*).*/\2/p' | head -n 1)
fi

if [[ "$canonical_workspace" == true && -n "$created_branch" ]]; then
  if [[ -z "$prefix" ]]; then
    # AGENT_BRANCH_PREFIX is the only input this rule needs and there is no
    # safe default to guess it from: calling an unevaluated branch
    # "compliant" would rubber-stamp a generic prefix, and calling it
    # "non-compliant" would block a legitimately prefixed one. Ask, naming
    # the missing variable, rather than silently allowing -- this is the
    # decision, not just its emission: an unconditional deny here would
    # block every branch creation in an unconfigured install, which in
    # practice gets this hook deleted rather than configured.
    # created_branch is parsed from the tool command, not from a trusted
    # environment value -- it is deliberately left out of the JSON reason
    # below rather than interpolated into it, unlike the deny message a few
    # lines down whose %s is always $prefix, a value this file controls.
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"AGENT_BRANCH_PREFIX is unset, so this guard cannot evaluate the agent branch-provenance rule for this branch creation. Confirm it is intentional, or configure AGENT_BRANCH_PREFIX."}}\n'
    exit 0
  fi
  if [[ "$created_branch" != "$prefix"/* ]]; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Agent-created branches must use %s/<short-slug>; generic prefixes such as feat/, fix/, chore/, task/, and agent/ are not allowed."}}\n' "$prefix"
    exit 0
  fi
fi

# Cover the direct-push forms this hook exists to block. This never reads
# AGENT_BRANCH_PREFIX, so it stays fully enforced whether or not the
# branch-provenance rule above could evaluate.
printf '%s\n' "$cmd" | grep -qE '(^|&&|;|\|)[[:space:]]*git push (origin )?main([[:space:]]|:|$)' || exit 0

if [[ "$canonical_workspace" == true ]]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Direct pushes to main are blocked in canonical repositories and their worktrees; use an agent-prefixed task branch and pull request."}}\n'
else
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"Direct push to main outside the canonical workspace repository paths; confirm this is intentional."}}\n'
fi

exit 0
