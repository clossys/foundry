# Security policy

## Reporting a vulnerability

Please report security issues **privately**, not through a public issue.

Use GitHub's private vulnerability reporting on this repository:
**Security → Report a vulnerability**. That opens a private thread visible only
to the maintainers.

Expect an acknowledgement within 7 days. If a report is confirmed, a fix and an
advisory are published together; you will be credited unless you ask otherwise.

Please do not open a public issue, pull request, or discussion describing an
unpatched vulnerability.

## Supported versions

The latest published minor of each package is supported. Fixes are released
forward; there are no long-term support branches.

## Repository security controls

| Control | Status |
| --- | --- |
| Secret scanning | Enabled |
| Secret scanning push protection | Enabled — a push containing a recognised credential is rejected at the remote, not reported after it lands |
| `gitleaks` over full history | Runs in CI on every pull request and push |
| `check-public-safety` | Required check on every pull request |
| `check-name-collision` | Required before every publish — see below |
| `conversation-safety` (issues, comments, pull request descriptions) | Runs after the text is already posted — labels a finding and fails the check, never echoing the matched text and never commenting. Detects; does not prevent. See below |
| `check-commit-messages` | Required check on every pull request. Scans commit message text against the same identity denylist — a surface neither the tree scan nor the tarball scan has ever read. See below |
| `check-merge-policy` | Weekly on a schedule. Compares the merge methods the forge offers for the default branch against `governance/merge-policy.json` and fails on drift. Observes; it cannot apply the declaration, because merge methods live in GitHub's settings store rather than in this tree. See below |
| `check-package-visibility` | Daily on a schedule, with no credential in either direction it checks -- every request, declared-package reads and the scope roster read alike, is anonymous. A scoped npm package defaults to restricted access unless published with `--access public`; this gate fails when a declared package is not anonymously installable right now (it deliberately does not try to tell "never published" apart from "private" -- both are the same failure of this repository's invariant that every declared package is already public) AND when a package live under the scope is not accounted for by the declaration. See the script's own header for both directions and issue #844 for the one piece (a deprecated-package retention cross-check) cut as a separate scope decision. Detects; there is no API to fix it. See [scripts/check-package-visibility.mjs](scripts/check-package-visibility.mjs) and [docs/PUBLISHING.md](docs/PUBLISHING.md#public-access-and-parity) |

## The publish-safety gate

`scripts/check-public-safety.mjs` exists because this repository intends
every package it ships to be safe for a public, external audience. It
refuses a tree that contains:

- **Forbidden files** — agent instruction files (`CLAUDE.md`, `AGENTS.md`,
  `.claude/`, `.codex/`), changelogs carrying internal references, `.npmrc`,
  `.env*`, private keys, and committed build output (`dist/`, `build/`,
  `.next/`, `coverage/`). One deliberate exception: this repository's own
  root `AGENTS.md` — the file governing contributions here — and the root
  `CLAUDE.md` compatibility loader are exempt by exact path. They are
  purpose-written for this public repository and content-scanned like
  everything else; only their filenames are excused from the forbidden-file
  rule. A package-level or otherwise-nested `AGENTS.md` or `CLAUDE.md` is
  still refused outright. Build output is the subtle one:
  it can embed resolved local paths and other detail from wherever it was
  compiled.
- **Credential-shaped strings** — provider API keys, tokens, private keys,
  database URLs, JWTs. Matching lines are reported by file and line number but
  never echoed, so the gate cannot leak a secret into a CI log.
- **Private identity** — names, domains, handles and internal paths that
  must never become public.

A separate gate, `scripts/check-artifact-safety.mjs`, runs the same scan
against the actual packed tarball rather than the git tree — `dist/` is
gitignored (so the tree scan never sees it) but ships to every consumer, and
compiled output can carry a leak the source never did.

### Why the denylist is not in this repository

A denylist is a list of exactly the strings that must never be public. Committed
here, it would publish them — readable by anyone and indexed by code search. So
the terms live outside the repository and are loaded at run time, from exactly
one of:

1. `--denylist <file>`
2. `$PUBLIC_SAFETY_DENYLIST` — CI writes a repository secret to a temp file

There is no generic on-disk default (there used to be one, at
`~/.config/public-safety/denylist.json`; it was removed because a machine that
also works with another repository's denylist would silently load that file —
same name, wrong terms — and report a confident FULL-mode pass that never
actually checked this repository's real identity terms). Neither source
present is treated exactly like a denylist that fails to parse: PARTIAL mode,
below.

### FULL and PARTIAL mode

Pull requests from forks cannot read repository secrets, so the gate runs
without a denylist there. That is **PARTIAL** mode: forbidden files, structural
rules and secret detection still apply, but identity checks are skipped. Partial
mode prints a banner and never claims a tree is cleared for publication.

`--require-denylist` turns a missing denylist into a hard failure (exit 2). The
publish workflow uses that flag, so a release can never pass on a degraded scan.

Both modes are advisory in one direction only: the gate can prove a tree dirty,
never prove it clean. Human review before a first publish is still required.

## The conversation-safety gate

`scripts/check-public-safety.mjs` and the tarball scan both operate on
files — the git tree and the packed package, respectively. Neither one has
ever seen an issue, a pull request description, or a comment: those aren't
files, they live in GitHub's own database, and no amount of tightening the
tree scan reaches them. This gap is not hypothetical — an audit of this
repository's conversation history found private-identity findings across
issues, pull requests, and comments while the git tree stayed clean the
whole time.

`.github/workflows/conversation-safety.yml` runs
`scripts/check-conversation-safety.mjs` against issue, comment, and
pull-request-description text after it is posted or edited, in FULL mode
only (`--require-denylist` — a run that cannot load the denylist fails the
job rather than reporting a degraded pass that could be mistaken for
clean). On a finding it applies the `public-safety` label and fails the
check. It deliberately posts no comment. Commenting the matched string back
would republish exactly what triggered the finding — but even a redacted
comment naming only the category is a public announcement that this
particular text holds something its author did not mean to publish, and,
since editing never erases a revision, an arrow pointing at the edit-history
dropdown where the original is still readable. The label and the failed
check carry that information to maintainers without broadcasting it.

**This is detection, not prevention, and the workflow says so in its own
header.** The text is public, and GitHub has already emailed it to every
watcher, before this workflow's first step even starts — a check that runs
after posting cannot undo either of those. Editing or deleting the flagged
text afterward reduces ongoing exposure; it does not erase it, because
GitHub keeps prior revisions of an edited issue or comment in that
item's own edit-history dropdown. The only point where this is actually
preventable is before posting: the "never post this" list at the top of
every issue and pull request template
(`.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md`), and
running `scripts/check-conversation-safety.mjs` by hand against a draft
before it goes anywhere near the GitHub API.

## The commit-message gate

`check-public-safety.mjs` scans the git tree; `check-artifact-safety.mjs`
scans the packed tarball; `check-conversation-safety.mjs` scans issue,
comment and pull-request-description text after it posts. None of the three
ever reads a commit **message** — message text is neither tree content nor a
record in GitHub's conversation database, and no amount of tightening any of
them reaches it. `scripts/check-commit-messages.mjs` is the gate for that
fourth surface, run in CI in FULL mode against the commit range of every pull
request. It applies no neutralize exceptions: a commit message never
legitimately needs to state private identity, so the strictest check is also
the simplest one to reason about.

It has a blind spot of its own, and a boundary beyond it that no gate here
covers.

The blind spot is the commit's **author header**. The gate scans message text
only. On a squash merge where the merging account is the pull request's
author, GitHub writes that account's public profile email into the resulting
commit's author metadata — a field this gate never opens, and which no gate
in this repository reads. That surface is not a corner case: measured across
the 630 commits reachable from `main`, 447 carry a non-noreply address in
their author header, against 8 carrying one in message text, and 436 of those
447 were written by GitHub's own web-side merge rather than by a local `git
commit`. The message-text finding is the one a gate can see, not the larger
one.

The boundary is that neither surface is populated by an author. GitHub
composes a squash commit's message server-side and appends a
`Co-authored-by:` trailer per contributor to the squashed branch, built from
each account's public profile email rather than from the address configured
on the commits being squashed. A repository whose every local and global git
identity is already the privacy-preserving forge noreply form still publishes
the profile address this way. That is how private identity reached this
repository's own commit messages, on the eight squash-merged dependency-bot
pull requests that carry it: machine-generated at merge time, after every
check had passed, with no commit yet existing for a gate to scan. **The exposure is created at the
merge button, not missed afterwards by a script.**

So the controls live where the choice is made rather than after it.
`governance/merge-policy.json` declares which merge methods this repository
permits into its default branch, and `scripts/check-merge-policy.mjs` fails
when the forge's live settings disagree. That is a drift alarm, not an
enforcement mechanism: merge methods live in GitHub's settings store, not in
this tree, and writing them needs an Administration-level credential no gate
here holds. The account-level "Keep my email addresses private" setting — the
only control that also covers the author header — cannot be asserted from
here at all, since observing it would mean naming a personal account in a
committed file, which is precisely what the identity denylist refuses. The
declaration records that as unassertable rather than implying coverage it
does not have.

A commit message is exactly as public and exactly as permanent as any file it
changes. Editing a later commit does not remove it; only a history rewrite
does, and a rewrite invalidates every existing clone, every merged pull
request's recorded SHAs, and the `reviewedCommit` bindings in
`governance/release-qualifications/`, which are sealed by design. See
[CONTRIBUTING.md](CONTRIBUTING.md) for what a maintainer checks before
clicking merge.

## The name-collision gate

`scripts/check-name-collision.mjs` guards a different failure mode entirely:
GitHub Packages namespaces npm packages by **owner account**, not by
repository. Publishing a name this org already owns under a different
repository does not fail — it silently appends a version to that package and
moves its `latest` dist-tag, with no error to signal the mistake. See
`docs/DECISIONS.md` for the full reasoning.

Foundry is the only repository under this owner authorized to publish
packages, but non-publishing account-control-plane repositories may coexist.
A gate that only runs when someone remembers a check is "probably
unnecessary" is not a gate, so the owner-wide collision check runs before
every publish regardless.
