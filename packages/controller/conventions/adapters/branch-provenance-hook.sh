#!/usr/bin/env bash
# Pre-tool-use adapter enforcing two rules from the shared conventions:
# branch provenance (an agent-created branch names its creating agent) and
# default-branch protection.
#
# This is a thin permission response, not a policy. The policy is
# documents/branch-provenance.md; this file only maps one product's hook JSON
# onto it, and is deliberately the smallest thing that can do that.
#
# Configuration, all through the environment so that nothing here encodes one
# operator's topology:
#
#   AGENT_BRANCH_PREFIX   required for the branch-provenance rule; the
#                         creating agent's prefix, e.g. "claude". Default-
#                         branch protection below does not read this
#                         variable and stays fully enforced without it --
#                         only the branch-naming check needs it, and when
#                         it is unset that check asks rather than silently
#                         passing. See the unset handling below.
#   AGENT_CANONICAL_GLOBS optional; colon-separated shell globs naming the
#                         paths where these rules are enforced strictly. When
#                         unset, the rules apply EVERYWHERE -- the fail-safe
#                         direction. A narrowing list is an operator's
#                         topology, so this file ships without one.
#
# Emits a deny/ask decision on stdout, or nothing at all to stay out of the way.

set -u

prefix="${AGENT_BRANCH_PREFIX:-}"

input=$(cat)

if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
  cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null)
else
  # Read each field separately: a command containing spaces or newlines would
  # otherwise be split across both variables by word splitting.
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

# Unset globs means "enforce everywhere", so the default is the strict branch.
in_scope=true
if [[ -n "${AGENT_CANONICAL_GLOBS:-}" ]]; then
  in_scope=false
  # Written unbraced on purpose: a braced all-caps shell variable is
  # indistinguishable from a provisioning template token and would be expanded
  # at install time. This file ships untemplated and must stay that way --
  # including in its comments, which the expander reads like any other bytes.
  _rest="$AGENT_CANONICAL_GLOBS:"
  while [[ -n "$_rest" ]]; do
    _glob="${_rest%%:*}"
    _rest="${_rest#*:}"
    [[ -z "$_glob" ]] && continue
    # Unquoted on the right so the glob is a pattern, not a literal.
    # shellcheck disable=SC2053
    if [[ "$resolved_cwd" == $_glob ]]; then
      in_scope=true
      break
    fi
  done
fi

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

if [[ "$in_scope" == true && -n "$created_branch" ]]; then
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

# Default-branch push protection below never reads AGENT_BRANCH_PREFIX, so it
# stays fully enforced whether or not the branch-provenance rule above could
# evaluate.
printf '%s\n' "$cmd" | grep -qE '(^|&&|;|\|)[[:space:]]*git push (origin )?(main|master)([[:space:]]|:|$)' || exit 0

if [[ "$in_scope" == true ]]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Direct pushes to the default branch are blocked here; use an agent-prefixed task branch and a pull request."}}\n'
else
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"Direct push to a default branch outside the declared canonical paths; confirm this is intentional."}}\n'
fi

exit 0
