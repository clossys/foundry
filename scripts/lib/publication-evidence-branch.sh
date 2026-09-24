#!/usr/bin/env bash
# Shared branch helpers for publication-evidence pull requests (issues #1346,
# #1468). Sourced by .github/workflows/record-publication-evidence.yml's
# "Push branch..." step -- from the default branch's own tip, the same
# revision the workflow file itself runs from -- and exercised directly by
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

# evidence_branch_name <prefix> <run-id>
# Prints a branch name used by exactly one run: <prefix><run-id>-<8 hex>. The
# run id is public, so the random suffix from the runner's own entropy source
# is what keeps the name from being pre-created by anyone else (security
# re-review, finding B3-residual). Returns 1 on a non-numeric run id or if no
# usable randomness could be read.
evidence_branch_name() {
  local prefix="$1" run_id="$2" suffix
  [[ "$run_id" =~ ^[0-9]+$ ]] || return 1
  suffix="$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')" || return 1
  [[ "$suffix" =~ ^[0-9a-f]{8}$ ]] || return 1
  printf '%s%s-%s\n' "$prefix" "$run_id" "$suffix"
}

# classify_open_evidence_branch <ref> <base-ref> <record-path> <record-copy> <source-sha>
# Decides what an ALREADY-OPEN evidence pull request's branch means for the
# record this run built (issue #1468). Prints exactly one word:
#   absent    -- <ref> does not carry <record-path>; it is unrelated.
#   duplicate -- <ref> carries byte-identical <record-copy>, passes
#                verify_branch_is_ours, AND forked from <base-ref> at a
#                commit that already contains <source-sha>. Every commit on
#                such a branch descends from the publish source, so the
#                record's introduction descends from its qualification
#                record's introduction (record-later-publication.mjs only
#                builds a trusted-publisher record whose qualification
#                introduction is an ancestor of the source). Opening a
#                second pull request for it would add nothing.
#   conflict  -- anything else: different bytes, a branch this workflow did
#                not verifiably write, or one forked before the publish
#                source (the #1461 shape, which no merge can repair).
# Fail-closed: every git failure lands in `conflict`, never `duplicate`.
classify_open_evidence_branch() {
  local ref="$1" base="$2" path="$3" copy="$4" source_sha="$5" fork_point
  if ! git cat-file -e "${ref}:${path}" 2>/dev/null; then
    echo absent
    return 0
  fi
  if verify_branch_is_ours "$ref" "$base" \
    && fork_point="$(git merge-base "$base" "$ref")" \
    && git merge-base --is-ancestor "$source_sha" "$fork_point" 2>/dev/null \
    && git show "${ref}:${path}" | cmp -s "$copy" -; then
    echo duplicate
  else
    echo conflict
  fi
  return 0
}
