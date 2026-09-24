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
  local ref="$1" base="$2" merge_base commits commit author files
  merge_base="$(git merge-base "$base" "$ref")" || return 1
  # Captured first, never iterated straight from a command substitution: a
  # failing rev-list inside `for ... in $(...)` yields an EMPTY loop, which
  # would report an unreadable branch as verified.
  commits="$(git rev-list "${merge_base}..${ref}")" || return 1
  for commit in $commits; do
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

# evidence_records_sourced_in_base <ref> <fork-point>
# Returns 0 only if every path <ref> changes past <fork-point> under
# governance/release-publications/later/ is an ADDED record whose own
# publication.provenance.sourceSha is a commit already contained in
# <fork-point>. A record whose own source is NOT in its branch's base is the
# #1461 shape: check-later-publications rejects it and no merge can repair
# it. Any modification or deletion, unreadable JSON, missing or malformed
# sourceSha, unknown commit, or git failure returns 1 (fail closed).
evidence_records_sourced_in_base() {
  local ref="$1" fork_point="$2" changes status file source
  changes="$(git diff --no-renames --name-status "$fork_point" "$ref" -- "$EVIDENCE_PATH_PREFIX")" || return 1
  while IFS=$'\t' read -r status file; do
    [ -n "${status:-}" ] || continue
    [ "$status" = A ] || return 1
    source="$(git show "${ref}:${file}" | node -e '
      let raw = "";
      process.stdin.on("data", (chunk) => { raw += chunk; });
      process.stdin.on("end", () => {
        const sha = JSON.parse(raw)?.publication?.provenance?.sourceSha;
        if (typeof sha !== "string") process.exit(1);
        process.stdout.write(sha);
      });
    ')" || return 1
    [[ "$source" =~ ^[0-9a-f]{40}$ ]] || return 1
    git merge-base --is-ancestor "$source" "$fork_point" 2>/dev/null || return 1
  done <<< "$changes"
  return 0
}

# classify_open_evidence_branch <ref> <base-ref> <record-path> <record-copy> <source-sha>
# Decides what an ALREADY-OPEN evidence pull request's branch means for the
# record this run built (issue #1468). "Current" below means the branch's
# fork point (its merge-base with <base-ref>) already contains <source-sha>,
# THIS run's source: every commit on such a branch then descends from it, so
# this record introduced there descends from its qualification record's
# introduction (record-later-publication.mjs only builds a trusted-publisher
# record whose qualification introduction is an ancestor of the source).
# Prints exactly one word:
#   missing   -- <ref> cannot be read (e.g. deleted after a merge). Never
#                built on.
#   foreign   -- verify_branch_is_ours refuses it and it does not carry this
#                record. Never built on.
#   conflict  -- carries <record-path> with different bytes, or carries it
#                on a branch verify_branch_is_ours refuses: fail closed.
#   broken    -- verified, but carries a record whose OWN source is not in
#                the branch's base (evidence_records_sourced_in_base): the
#                #1461 shape, which no merge can repair. Fail closed.
#   duplicate -- verified, every record sourced in its base, current, and
#                already carries byte-identical <record-copy>: nothing to do.
#   adoptable -- verified, every record sourced in its base, current, and
#                does not carry this record: safe to add it on top.
#   predates  -- verified, every record sourced in its base, but NOT
#                current: the branch was cut before THIS record's source,
#                so this record goes to a new branch. The pull request stays
#                valid for its own records and should be merged normally.
# (A verified branch carrying a byte-identical copy of this record is
# current by construction or else `broken`, so it is never `predates`.)
# Every git failure lands in a verdict that never builds on the branch.
classify_open_evidence_branch() {
  local ref="$1" base="$2" path="$3" copy="$4" source_sha="$5" fork_point="" carries=false ours=false current=false
  if ! git rev-parse -q --verify "${ref}^{commit}" >/dev/null 2>&1; then
    echo missing
    return 0
  fi
  if git cat-file -e "${ref}:${path}" 2>/dev/null; then carries=true; fi
  if verify_branch_is_ours "$ref" "$base"; then ours=true; fi
  if [ "$ours" != true ]; then
    if [ "$carries" = true ]; then echo conflict; else echo foreign; fi
    return 0
  fi
  if [ "$carries" = true ] && ! git show "${ref}:${path}" | cmp -s "$copy" -; then
    echo conflict
    return 0
  fi
  if ! fork_point="$(git merge-base "$base" "$ref" 2>/dev/null)" \
    || ! evidence_records_sourced_in_base "$ref" "$fork_point"; then
    echo broken
    return 0
  fi
  if git merge-base --is-ancestor "$source_sha" "$fork_point" 2>/dev/null; then current=true; fi
  if [ "$current" != true ]; then
    echo predates
  elif [ "$carries" = true ]; then
    echo duplicate
  else
    echo adoptable
  fi
  return 0
}
