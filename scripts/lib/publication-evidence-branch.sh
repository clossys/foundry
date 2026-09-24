#!/usr/bin/env bash
# Shared ownership verification for the publication-evidence batching branch
# (issue #1346). Sourced by .github/workflows/record-publication-evidence.yml's
# "Push branch..." step, and exercised directly by
# scripts/lib/publication-evidence-branch.test.mjs against real git
# fixtures — including a deliberately "planted" branch, the exact attack the
# 2026-09-23 security re-review (finding "B3-residual") reproduced against
# this workflow's earlier push-retry loop.
#
# A branch is "ours" to write to only if EVERY commit it carries past its
# merge-base with the default branch is authored by exactly this workflow's
# bot identity AND touches only governance/release-publications/later/.
#
# THE AUTHOR CHECK IS DEFENCE IN DEPTH, NOT THE REAL GUARD. Author identity
# is exactly the kind of thing any write-access actor can set on their own
# commits (`git -c user.name='github-actions[bot]' -c user.email=...`), and
# the security re-review measured that directly (finding N-b): a forged
# author passes this half of the check every time. It stays here because it
# costs nothing and raises the bar for a casual attempt, but nothing calling
# this function should treat a passing author check as proof of anything on
# its own.
#
# THE PATH CONFINEMENT IS THE REAL GUARD. It is what actually bounds an
# adopted branch's blast radius: whatever else is on it, this workflow can
# only ever have written files under governance/release-publications/later/,
# so even a branch with a perfectly forged bot author can carry nothing
# outside that directory without failing here. Do not loosen this half to
# make the author check "matter more" — they are not equally load-bearing,
# and this one must stay strict.
BOT_IDENTITY="github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>"
EVIDENCE_PATH_PREFIX="governance/release-publications/later/"

# verify_branch_is_ours <ref> <base-ref>
# <ref> and <base-ref> must already be fetched, local-or-remote-tracking
# refs (e.g. "origin/some-branch"). Returns 0 (true) only if every commit in
# <base-ref>..<ref> passes both checks above; returns 1 (false) on the
# first commit that fails either, on an unrelated history (no merge-base),
# or on any git failure.
verify_branch_is_ours() {
  local ref="$1" base="$2" merge_base commit author files
  merge_base="$(git merge-base "$base" "$ref")" || return 1
  for commit in $(git rev-list "${merge_base}..${ref}"); do
    author="$(git show -s --format='%an <%ae>' "$commit")" || return 1
    if [ "$author" != "$BOT_IDENTITY" ]; then
      return 1
    fi
    files="$(git show --name-only --format= "$commit")" || return 1
    if printf '%s\n' "$files" | grep -qv "^${EVIDENCE_PATH_PREFIX}"; then
      return 1
    fi
  done
  return 0
}
