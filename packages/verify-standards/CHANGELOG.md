# Changelog

All notable changes to `@vespeneventures/verify-standards` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-08-18

### Fixed

- **The label pattern in `extractTaskReferenceCandidates` had no word
  boundary.** A configured label matched as a bare substring anywhere it
  occurred, including embedded inside a longer, unrelated word — `Refs`
  matched the `refs` hiding inside `Prefs`. The label is now guarded on both
  sides by `(?<!\w)` / `(?!\w)`. Plain `\b` cannot be used for this: a
  caller's label may itself end in a non-word character (this package's own
  tests exercise `"Ticket (id)"`), and `\b` requires a word/non-word
  transition at that exact edge, which a label ending in `)` immediately
  followed by `:` can never produce — it would have silently broken a label
  that legitimately matches. The lookaround guards only inspect the
  character on the *other* side of the boundary, so they hold regardless of
  what the label itself starts or ends with.
- **`extractTaskReferenceText` still let a wrong-but-shaped candidate win.**
  0.1.1 fixed the earlier "first match wins" behavior by preferring any
  reference-*shaped* candidate — but a bare number is shaped, and it is the
  one reference shape that ordinary prose can produce by coincidence:
  "…that Refs 2024 baseline…" matches a configured label `Refs` exactly as
  cleanly as a real `Refs #12` written elsewhere in the same description,
  and `2024` parses exactly as cleanly as `12` does. The word-boundary fix
  above does not close this on its own — `Refs` in that sentence is already
  a correctly-bounded, standalone word, and boundary-guarding it changes
  nothing about the match. A shaped candidate that is not a bare naked
  number (a qualified `owner/name#12`, a tracker URL, or any number written
  with its `#`) is now preferred over one that is; a naked number is never
  discarded and is still returned — shaped, then unshaped — when it is the
  only thing the description contains, so this cannot manufacture "no
  reference" out of a description that names one, even ambiguously.

### Notes

- No exit-code semantics changed. `0` satisfied, `1` violated, `2`
  could-not-evaluate, and nothing here converts a `2` into a `0`.
- Unlike 0.1.1's parser fixes, this release's `extractTaskReferenceText` fix
  can change which candidate a description resolves to — the earlier
  "shaped wins" rule could resolve a change against the wrong tracked item
  when prose happened to contain a configured label next to a number.
  Whether that reaches a caller as a false `0` depends on how the caller's
  own lookup step is wired to this package's extraction; callers with that
  concern should re-pull `0.1.2` rather than relying on the version floor,
  which this release does not raise.

## [0.1.1] - 2026-08-17

### Fixed

- **`documents/caller-workflow.md` shipped a fail-open decide step.** The
  template piped the CLI into `tee -a "$GITHUB_STEP_SUMMARY"`. GitHub Actions
  runs a `run:` block as `bash -e {0}` — `-e` is set, `-o pipefail` is not —
  and a pipeline's exit status is its last command's, so the step reported
  `tee`'s `0` and discarded the verdict. A `violated` (`1`) or
  `indeterminate` (`2`) run rendered its full report into the job summary
  while the step itself went green. Two consuming repositories ran that way
  before it was caught. The template now sets `pipefail` **and** keeps the
  decisive command out of any pipeline: it redirects to a file, captures the
  status, appends the summary afterwards, and ends with an explicit
  `exit "$status"`, so removing either guard alone does not silently
  reintroduce the hole. A new "On never piping the decision step" section
  states the rule for anyone adapting the template rather than copying it.
  This is the defect class the package exists to eliminate, shipped inside
  the package's own template, where every consumer inherits it.
- **The template's trigger omitted `edited`.** The task-record check reads
  the pull request description, so editing the description edits the check's
  own evidence: a change could pass and then have its work-item reference
  quietly removed, with nothing re-evaluating. Re-running the job does not
  close this — a re-run replays the original event payload and reads the old
  description. The template now declares
  `types: [opened, synchronize, reopened, edited]`.
- **`parseTaskReference` rejected a reference written in a Markdown code
  span.** A description is Markdown, and `` `Work item: #12` `` or
  `` Work item: `#12` `` is correct authoring; whitespace-split extraction
  left a backtick attached to the token and the anchored pattern then
  refused a reference that was plainly present, reporting
  `task-record-unparseable` against a change that had done nothing wrong.
  Code-span delimiters are now stripped before matching. `raw` still carries
  the text exactly as written, and a backticked non-reference is still
  refused.
- **`extractTaskReferenceText` let prose beat the real record, and only ever
  consulted the first configured label.** Labels are matched
  case-insensitively, so a sentence such as "there is no work item at all"
  matched, `at` was returned as the reference, and an actual `Work item: #12`
  further down the same description was never reached; a repository
  declaring more than one label got the same failure whenever prose matched
  the first one. Every label and every occurrence is now collected, and the
  first reference-*shaped* candidate wins. When none is shaped the first
  candidate is still returned, so a genuinely malformed reference is still
  reported as unparseable rather than being downgraded to "no reference
  given" — two different findings that must not collapse into one.

### Notes

- No exit-code semantics changed. `0` satisfied, `1` violated, `2`
  could-not-evaluate, and nothing here converts a `2` into a `0`. Each parser
  fix removes a *false* `1`; neither can manufacture a pass, because every
  candidate returned came out of the description and is still parsed and
  looked up on its own merits.
- `MINIMUM_SAFE_VERSION` is deliberately **not** raised. The floor exists for
  a released build that reported a passing verdict it should not have; the
  library never did that here. The one fail-open defect lived in a document
  a consumer copies into its own repository, which no version floor can
  observe or fix — a consumer that copied the old template must edit its own
  workflow, and raising the floor would only add noise without closing
  anything.

## [0.1.0] - 2026-08-17

### Added

- Initial release. One repository-standards gate, published as a package so a
  fix has a path to every consumer, invoked by a thin workflow each consuming
  repository keeps for itself.
- Four checks, each a pure function of caller-collected observations:
  `checkSecretScan`, `checkTaskRecord`, `checkReviewEvidence`, and
  `checkPolicyDrift`.
- `verifyStandards`, which runs the selected checks and folds their results
  `indeterminate`-first, and the `verify-standards` executable, which reads
  one caller-named inputs document and maps the folded verdict onto the
  `0` / `1` / `2` exit contract this repository's other gate CLIs already
  publish. No flag can turn a `2` into a `0`.
- Every check reports the `satisfied` / `violated` / `indeterminate` ternary
  from `@vespeneventures/governance/gates`, with each check's possible
  indeterminate reasons declared as one enumerated vocabulary in its own
  source rather than accumulating as ad hoc strings at call sites.
- A minimum-safe-version floor (`MINIMUM_SAFE_VERSION`, `checkVersionFloor`).
  A build below the floor fails as `2` rather than warning. Because a running
  build can only compare against the floor it shipped with, the floor also
  checks a second, independent fact — the version range the caller declared
  for this package — so a current build can tell a caller that its own range
  still admits a pre-floor build.
- `documents/caller-workflow.md`, the consumer-side half: the thin workflow a
  consuming repository adds, the inputs-document shape, and why collection
  stays on the caller's side of the boundary.

### Notes on what is deliberately absent

- No collection of any kind: no scanner is downloaded or run, no tracker is
  queried, no enforcement surface is read. That is what lets this package hold
  no credential, keeps its entry point synchronous, and leaves a re-checkable
  inputs document behind after every run.
- No account values — no owner, repository, label taxonomy, required context,
  or provider list. Requirements are opaque identifiers compared for equality.
