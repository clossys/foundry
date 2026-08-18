# Generic interactive workspace-navigation helpers.
#
# This file deliberately hardcodes no account, repository, product, or port
# number. A fixed alias per repository (which repositories exist, which
# package-manager filter or port each one's dev server wants) is exactly one
# account's own reviewed inventory -- the same reason skill *content* stays
# out of this package (see conventions/documents/skill-registry.md). What a
# shared, account-neutral adapter can supply is the shape every account's
# navigation follows, not the particular repositories filling it in. An
# operator who wants shorter, repository-named aliases layers them on top of
# this file from their own account-owned shell configuration.
#
# Desktop task scope comes from the repository opened in the app, never from
# these aliases -- see shell-integration.zsh's own header, which sources this
# file only as an optional, non-required navigation convenience.

if [[ -z "${CODE_WORKSPACE_ROOT:-}" ]]; then
  export CODE_WORKSPACE_ROOT="$HOME/code"
fi

alias croot='cd "$CODE_WORKSPACE_ROOT"'

# cd into <account>/repos/<repository> under the discovery root, e.g.
# `cw example-account example-repo`. Falls back to the account's worktrees
# tree when the plain repos path does not exist, so the same shorthand also
# reaches an ephemeral worktree named the same way.
cw() {
  if [[ $# -lt 2 ]]; then
    echo "usage: cw <account> <repository> [worktree]" >&2
    return 1
  fi
  local account="$1" repository="$2" worktree="${3:-}"
  if [[ -n "$worktree" ]]; then
    cd "$CODE_WORKSPACE_ROOT/projects/$account/worktrees/$repository/$worktree"
    return
  fi
  local target="$CODE_WORKSPACE_ROOT/projects/$account/repos/$repository"
  if [[ ! -d "$target" ]]; then
    target="$CODE_WORKSPACE_ROOT/projects/$account/worktrees/$repository"
  fi
  cd "$target"
}
