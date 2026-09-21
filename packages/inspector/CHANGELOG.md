# Changelog

All notable changes to `@clossys/inspector` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.2.8] - 2026-09-21

### Fixed

- Install section names `https://registry.npmjs.org` and states that
  installing requires no authentication. (#924)

## [0.2.7] - 2026-09-21

### Added

- Ships the packed Agent Skill in the tarball (`files` includes `skill`).

## [0.2.6] - 2026-09-19

### Changed

- `adm-zip` is pinned to the exact resolved version, `0.6.1`, replacing the
  `^0.6.0` range (#999). A caret range on a `0.x` dependency is minor-locked
  under semver rather than patch-only, so a fresh install could drift to a
  newer minor than the one this package's tarball inspection was built and
  tested against. The pin holds the dependency to the bytes already
  resolved in this repository's lockfile; no source changed.

### Notes

- This does not claim the position is closed. Qualification of `0.2.6` is
  deferred under #999.

## [0.2.5] - 2026-09-18

### Added

- Stated the charter close condition with the exact metric name `change
  escape rate`. Observer's `computeEscapeRate` computes that metric; this
  package does not. A green Inspector history is not a close.
- Declared `foundry.assessment` against a new mapped `inspector-check` bin
  with `invocation: "single-json-input"`, so first-day onboarding discovers
  this role's assessment surface from the installed manifest instead of
  inferring one. Advisor remains the only required first-day role.
- `inspector-check assessment.json`: wraps `verifyStandards()` for
  pre-landing rule satisfaction and exits on the `0` / `1` / `2` ternary.
  The existing `inspector --inputs` gate CLI remains; it is not the
  assessment surface. Output never includes `metric` or `rate`.

### Notes

- This does not claim the position is closed. Qualification of `0.2.5` is
  deferred under #833.

## [0.2.4] - 2026-09-17

### Fixed

- **A work-item reference naming another tracker was answered by this
  repository's object of the same number (#363).** `parseTaskReference`
  discarded the host of a URL-form reference and returned only `owner/name`,
  and `checkTaskRecord` compared that path against the caller's own
  `trackerScope`. A path is unique only within one tracker, so a URL naming
  the same owner and name on a DIFFERENT host compared equal to the caller's
  own repository: the caller then looked the number up in its own tracker and
  the check reported `satisfied`, having validated an object the author never
  referenced. Whether such a run passed or failed was a coincidence of what
  the local object of that number happened to be — an open issue with the
  right shape would have passed. Reproduced end to end before the fix: a
  reference to `https://<other-host>/<this owner>/<this name>/issues/73`, with
  this repository's own 73 resolving cleanly, exited 0 with `2 evaluated`.

  The parse now carries the host out (still pinning no vendor: it is read from
  the reference and compared only for equality), `TaskRecordObservation` gains
  an optional `trackerHost`, and the check compares host and scope before any
  lookup outcome is interpreted. A host-bearing reference is `indeterminate`
  when it names another host, and `indeterminate` when the caller stated no
  host of its own — because silence about the host is not agreement about it,
  and a default invented here would be this package deciding that an
  unfamiliar tracker is the familiar one.

  The qualified `owner/name#n` form was already handled correctly and still
  is; only the URL form carried the defect.

### Added

- **`item.lookupScope` / `item.lookupHost`: where a lookup was aimed, not just
  how it ended (#363).** An outcome on its own says nothing about what was
  examined, so a caller that strips a reference's `owner/name` prefix and
  queries its own repository instead reports an ordinary `resolved` for an
  unrelated object. Stated, the target is compared against the reference
  before the outcome is read: a mismatch is `indeterminate`
  (`item-lookup-target-mismatch`), never a verdict. Both fields are optional
  and every existing caller keeps its current behaviour by omitting them — but
  a caller whose credential genuinely reaches the named repository can now
  resolve a cross-repository reference by saying so, instead of being told
  forever that it is out of scope. A gate that can only ever refuse is one its
  consumers route around.
- Three declared reasons: `item-outside-tracker-host`,
  `item-tracker-host-unstated`, `item-lookup-target-mismatch`. Unreachable,
  private and non-existent all continue to land on `indeterminate` rather than
  on a finding — none of them is a fact about the change.

## [0.2.3] - 2026-09-16

### Fixed

- **A regression test's own comment overclaimed what it proves (post-merge
  review of #932, Finding B follow-up).** `gitleaks.artifact.test.ts`'s
  "genuinely platform-decisive" test claimed it "could not have been written
  without first fixing" Finding C (`resolveGitleaksRelease`/`KNOWN_RELEASES`
  having no platform dimension). That was false: the test built its
  `darwinUrl`/`linuxUrl` from hardcoded template strings and never called
  `resolveGitleaksRelease` at all, so with Finding C's exact bug
  reintroduced (`resolveGitleaksRelease` patched to ignore its
  `platform`/`arch` arguments and always resolve the linux/x64 entry), all 5
  tests in that file still passed — reproduced by making that edit,
  rebuilding, and rerunning the file. The real regression coverage for
  Finding C lives in `gitleaks.test.ts`'s "resolveGitleaksRelease" and
  "KNOWN_RELEASES integrity" suites, which fail (5 tests) under the same
  mutation. The test now asks the PACKED module's own `resolveGitleaksRelease`
  for the darwin/arm64 and linux/x64 entries, asserts they are distinct
  before doing anything else, and drives its fetch mock off the URLs those
  calls return rather than off hardcoded strings — genuinely sensitive to
  Finding C's defect class as shipped in the tarball, reproduced by the same
  mutation: with it applied, the two resolved entries collapse to the same
  object and the test now fails immediately, before the fetch mock even
  exists.
- **Two more dangling citations of Finding E's class, found on a
  whole-package audit against the extracted tarball (post-merge review of
  #932).** `src/secret-scan/attempt.ts` (packed 3x, as `.ts`/`.js`/`.d.ts`)
  cited "the vitest config header" for why this package's tests never spawn
  a process for real; `vitest.config.ts` is not shipped (`files` in
  `package.json` never lists it — the 0.2.2 CHANGELOG entry for Finding E
  already says so for the README instance it fixed there). Replaced with a
  self-contained explanation in the comment itself. Separately,
  `documents/caller-workflow.md` cited a "Re-derive, do not believe" section
  "below" that does not exist as a heading anywhere in the document — the
  text actually lives as a step comment inside the `decide` job's YAML later
  in the same file, not a linkable section. Reworded the citation to
  describe inline what the `decide` job does and to point at that step
  comment by name instead of an implied heading. A full audit of the
  extracted tarball across every shipped extension (not just `.md` —
  `check-contamination-classes.mjs` only matches `.md` paths, see #935)
  found no further instances of either class.

### Changed

- Updates the hardcoded `@clossys/inspector` version literal in
  `scripts/run-candidate-qualification.test.mjs` and retains a qualification
  record for 0.2.3 as a separate commit. No functional or behavioral change
  to the package itself beyond the two fixes above.

## [0.2.2] - 2026-09-16

### Fixed

- **The README's Install section named the wrong registry and told a
  consumer to create a credential it does not need (#924, audit pass 9 /
  #897 Finding A).** It said this package is published to GitHub Packages
  and that installing it requires the scope pointed at that registry plus
  an authenticated `NODE_AUTH_TOKEN`. Both were false: `publishConfig` has
  always named `registry.npmjs.org` with `access: public`, and installing
  this package needs no scope redirection and no authentication at all. A
  consumer who followed the old instructions would have gone and created a
  `read:packages`-scoped token this package never asked for and never
  checked. Proved against a packed tarball installed into a disposable
  consumer with an empty `--userconfig` and every ambient credential
  environment variable stripped: the install succeeds anonymous.
- **`KNOWN_RELEASES` had no platform dimension, so the documented
  `resolveGitleaksRelease` convenience path threw on every platform except
  linux/x64 (#301's second, previously unfixed, suggested fix).** On
  darwin/arm64 specifically, `resolveGitleaksRelease("8.30.1")` returned
  the linux/x64 entry's checksum regardless of the caller's actual
  platform, so a caller who resolved a checksum and passed it straight
  through to `downloadAndVerifyGitleaks` downloaded the correct (genuine,
  untampered, current) darwin/arm64 asset and then rejected it, 100% of the
  time, against a checksum recorded for a different platform's asset.
  `GitleaksRelease` now carries `platform` and `arch`, `KNOWN_RELEASES`
  carries one real, gitleaks-project-published checksum per platform/arch
  (verified both against `gitleaks_8.30.1_checksums.txt` and by hashing
  each asset directly), and `resolveGitleaksRelease` and
  `downloadAndVerifyGitleaks` are keyed on all three of version, platform,
  and arch. The checksum-mismatch error message no longer claims an asset
  "may have been tampered with or the release metadata is outdated" as the
  only two explanations — a platform-mismatched pin is neither, and the
  message now says so.
- **A test named as a platform control did not actually depend on
  platform.** `gitleaks.artifact.test.ts`'s "rejects substituted platform,
  version, and hash controls" case asserted that a `darwin/arm64` request
  against the linux checksum throws `Checksum verification failed` — true,
  but for the same reason any platform would have thrown against a fully
  fabricated hermetic fixture whose digest can never equal any pinned
  value. The only assertion in it actually sensitive to `platform` was the
  fetched-URL check. Split into a version/hash-control test (kept, already
  genuinely input-decisive) and a new test that is genuinely
  platform-decisive: the same expected checksum, resolved against two
  platforms whose mocked responses differ, verifies for the platform whose
  asset actually hashes to it and fails for the one whose asset does not —
  only possible to write honestly once the platform-dimension fix above
  landed.
- `checkTaskRecord`'s doc comment (packed in the `.d.ts`) said it evaluates
  a change's task record "against the consuming repository's policy"
  without saying which part of the record — a reader could take that as
  covering everything a task-record policy might require. It evaluates
  work-item *reference resolution* only: whether the change description
  names a work item in a shape that resolves. A body with the reference
  correct and every other required field left as an unfilled placeholder
  still reports `satisfied` against this check, because those fields are
  outside its vocabulary and always have been (#329's own cheaper,
  doc-only option; the module header and the README's own description of
  this check already stated the narrower scope correctly).
- The README's `defaultGitleaksExecutor` row cited "the hermetic-tests note
  below," which did not exist — the explanation lived only in
  `vitest.config.ts`, a file this package does not ship (`files` in
  `package.json` never listed it). Replaced the dangling citation with a
  self-contained explanation in the row itself.

## [0.2.1] - 2026-09-14

### Changed

- Patch version bump only, to obtain a fresh, never-before-used
  `governance/release-qualifications/` record path. The 0.2.0 qualification
  record added by #811 was orphaned when that pull request was squash-merged
  (#821) and had to be removed (#834); the immutability gate that protects
  already-introduced record paths (`check-candidate-qualification.mjs`'s
  single-introduction-commit invariant) means a valid record can never again
  be introduced at the `0.2.0` path, so this package moves to `0.2.1`
  purely to regain one. No functional or behavioral change.


## [0.2.0] - 2026-09-09

### Changed

- **BEHAVIOURAL: the gitleaks binary cache directory moved.** The default is
  now `$TMPDIR/clossys/secret-scan/gitleaks/`; it was previously the same
  path under a producer-account directory name this catalogue no longer
  publishes under. Consumers who never set `cacheDir` are unaffected beyond
  one extra download: the first scan after upgrading finds an empty cache and
  repopulates it. **A CI cache key or a mount that names the old directory
  literally will silently stop hitting** — it will not error, it will just
  miss every time. Update such a key to the new path, or pass `cacheDir`
  explicitly, which has always taken precedence and is unchanged.
- **BEHAVIOURAL: the per-scan gitleaks report scratch directory moved.** It is
  now created as `$TMPDIR/clossys-gitleaks-report-<random>/`, previously the
  same shape under the retired producer name. This directory is created and
  removed within a single scan and is not a public interface, so nothing that
  did not reach into it by name is affected.
- The changelog no longer names the producer account this catalogue no longer
  publishes under when describing the scope transition. History is unchanged;
  only the way the retired scope is referred to is.


## [0.1.21] - 2026-09-02

### Fixed

- Declared `bin` targets without a leading `./`. npm rejected the dotted
  form as an invalid script name and **removed the entry entirely** on
  publish, so `inspector` would not have been installed
  by a consumer of the previous release.

### Changed

- Named Clossys as copyright holder in `LICENSE` and as `author` in the
  package manifest, so every package in the catalogue attributes identically.


## [0.1.20] - 2026-09-02

### Changed

- Widened the `@clossys/controller` runtime dependency range from `~0.8.0` to `~0.9.0` to cover controller's 0.9.0 release. No other change.

## [0.1.19] - 2026-08-31

### Changed

- Prepared a bounded trusted-publisher patch source for provenance after the owner-present first publication and anonymous registry verification. This change does not publish the package or claim provenance.

## [0.1.18] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.1.17] - 2026-08-29

### Fixed

- Replaced the remaining task-reference punctuation and Markdown-delimiter
  regular expressions with explicit linear scans, including adversarial long
  token controls, so caller text cannot trigger polynomial backtracking.

## [0.1.16] - 2026-08-29

### Fixed

- Replaced the task-record parser's unbounded HTML-comment and reference-shape
  regular expressions with linear scans. Long caller-supplied descriptions and
  malformed references now retain the same verdict semantics without exposing
  Inspector to polynomial regular-expression backtracking.

## [0.1.15] - 2026-08-29

### Fixed

- Hardened Inspector's command-line Markdown table renderer so untrusted cell
  text escapes existing backslashes before pipe characters and normalizes all
  line endings without allowing a crafted value to create extra table cells or
  rows.

## [0.1.14] - 2026-08-21

### Added

- **Closes issue #283's last open acceptance criterion: the caller pattern is
  now verified under real Actions shell semantics.** `src/bin.actions-shell.test.ts`
  spawns the actual compiled `dist/bin.js` — the same dist path
  `.github/workflows/verify-standards.yml` and the caller-workflow template
  both invoke — through a real `bash -e` subprocess (the shell GitHub Actions
  runs a `run:` step under) and asserts all three exit states: `0`
  (satisfied), `1` (violated), and `2` (indeterminate). Previously only
  `src/cli.test.ts`'s in-memory-port coverage existed; it can assert `main`'s
  return value but cannot see what a real shell does to that value on the
  way to becoming a step's exit status.
- The suite also reproduces, under a real subprocess, the exact defect the
  workflow's own "DECIDE" step comment and `documents/caller-workflow.md`'s
  "On never piping the decision step" section describe in prose: piping the
  decisive command into another command under `bash -e` with no
  `pipefail` swallows a real `1` or `2` into a false `0`, and `set -o
  pipefail` alone restores the real status. Both are now backed by an
  assertion, not just a comment.

### Verified, not changed

- The documented caller pattern — redirect the decisive command's output to
  a file, capture its status with `|| status=$?`, `cat` the file, then `exit
  "$status"` — was confirmed correct for all three exit states under a real
  `bash -e` subprocess. No fix was needed to
  `.github/workflows/verify-standards.yml` or this package's own
  `documents/caller-workflow.md`: both already document the pattern this
  release's test now verifies.

## [0.1.13] - 2026-08-21

### Changed

- **The changelog is now shipped in the published package (#400).** This file
  was written and maintained but was absent from `package.json`'s `files` array,
  so it never reached the tarball. A consumer installing this package could not
  read what a breaking upgrade breaks without leaving the registry and finding
  the source repository. Adding it to `files` is the whole fix; no runtime code
  changed in this release.

## [0.1.12] - 2026-08-20

### Changed

- **Stays exhaustive against `@clossys/controller@0.8.0`'s two new
  `ReviewFindingRule` values (issue #391).** `checkReviewEvidence`'s
  `RULE_CLASS` is a total `Record` over that union specifically so an
  upstream rule addition is a compile error here, not a silent default;
  `"check-completed-at"` and `"required-check-indeterminate"` are now
  classified `"evaluability"` — the same class as `"pagination-incomplete"`,
  since both mean nothing about the change's checks has been established in
  either direction — and `evaluabilityReason` reports
  `"evidence-incomplete"` for `"required-check-indeterminate"`, the same
  reason `"pagination-incomplete"` already reports, rather than the generic
  `"evidence-malformed"`. No behavior changes for any existing caller: these
  rules cannot occur before this dependency bump. Depends on
  `@clossys/controller@~0.8.0`.

## [0.1.11] - 2026-08-19

### Changed

- **Documented the fork-accepting caller shape.** `documents/caller-workflow.md` gained a second worked example — a two-workflow split (collect / decide) for a consuming repository that accepts pull requests from forks. See [issue #272](https://github.com/clossys/foundry/issues/272). No code changed.

## [0.1.10] - 2026-08-19

### Changed

- **`prepublishOnly` now runs the name-collision check before building.** A hand-run `npm publish` from this package's directory previously built and published without `check-name-collision.mjs` ever executing — npm only runs `prepublishOnly` for a directory-type publish, and this manifest declared just `npm run build`. See [issue #273](https://github.com/clossys/foundry/issues/273). No runtime behavior changed.

## [0.1.9] - Unreleased

### Fixed

- **The task-record label matcher no longer matches mid-sentence prose or
  captures a value across a line break (#332).** It previously matched a
  configured label (`Closes`, `Fixes`, `Resolves`, …) case-insensitively
  anywhere in a change description, so `...already fixes for every other
  caller` matched `fixes` and extracted the next word, `for`. Worse, a
  Markdown heading such as `* **Bug Fixes**` — the kind an automated
  reviewer commonly appends to a description — matched `Fixes` and then
  captured the `*` opening the following bullet line, reporting a real
  `violated` verdict against a description that had a valid record. The
  matcher now requires a label to sit at the start of one of the
  description's lines, behind nothing but optional Markdown decoration
  (list/blockquote/heading markers, emphasis, a code-span backtick) —
  never behind a real word — with its value on that same line. Regions
  fenced in HTML comments (`<!-- ... -->`), which is how generated
  sections are commonly delimited, are skipped entirely before matching.
  A description that genuinely lacks a task record is still reported as
  `violated`; this change is extraction precision only.

## [0.1.8] - Unreleased

### Changed

- **Widened the `@clossys/controller` dependency range from `~0.6.0`
  to `~0.7.0`** to cover controller's new
  `repositoryProfileValidationCoverage` export under `./repository` (#309),
  which reports which of `validateRepositoryProfile`'s schema-version-gated
  checks actually ran. This package does not use
  `@clossys/controller/repository`, so nothing here changes
  behaviorally.

## [0.1.7] - Unreleased

### Changed

- Widened the `@clossys/controller` dependency range from `~0.5.0`
  to `~0.6.0` to cover controller's new custom-axis mechanism for
  `runRepositoryProfileCheck` (`RepositoryProfileRunInput.customAxes`,
  #324). This package does not use `@clossys/controller/repository`,
  so nothing here changes behaviorally.

## [0.1.6] - Unreleased

### Changed

- Widened the `@clossys/controller` dependency range from `~0.4.0`
  to `~0.5.0` to cover controller's new repository-profile runner
  (`runRepositoryProfileCheck` / `repository-profile-check`, #321). This
  package does not use `@clossys/controller/repository`, so nothing
  here changes behaviorally.

## [0.1.5] - Unreleased

### Added

- `downloadAndVerifyGitleaks` now refuses, before any network call, a
  `options.sha256` that is missing, malformed (not 64 lowercase hex
  characters), or one of two known-degenerate digests: the SHA-256 of
  **empty input** and the all-zero digest. `KNOWN_RELEASES` validates every
  one of its own entries against the same rule at import time, so a future
  entry carrying a placeholder throws immediately for every consumer rather
  than shipping quietly (see 0.1.1's own note on how the first one did).
  New exports: `isWellFormedSha256`, `isKnownDegenerateSha256`,
  `assertUsableSha256`, `EMPTY_INPUT_SHA256`, `ALL_ZERO_SHA256`.

  This closes a real gap 0.1.1 left open: `downloadAndVerifyGitleaks`
  already failed closed on a checksum *mismatch* against a downloaded
  asset, but a degenerate pin was never rejected as a category — only ever
  caught (or not) by whatever the download happened to return. A pin
  carrying the empty-input digest specifically could have spuriously
  *verified* a zero-byte response (a stalled proxy, a misconfigured mirror,
  or an attacker able to serve no content but not real content) instead of
  catching one, which is precisely the failure a checksum pin exists to
  catch. It is now rejected outright, before any download is even
  attempted — reported as a thrown exception, the same "could not
  evaluate" signal this repository's other gates report as exit `2`, not
  as a verified mismatch (`1`) and never as success (`0`).

  21 new hermetic tests cover this directly: the predicate functions in
  isolation, `downloadAndVerifyGitleaks` rejecting seven unusable
  `options.sha256` shapes (empty-input digest, its uppercase form,
  all-zero digest, empty string, missing, too short, non-hex) without ever
  calling `fetch`, and `KNOWN_RELEASES`'s own entries checked against the
  same predicate the runtime guard uses — not just the one specific value
  0.1.1 already pinned.

## [0.1.4] - Unreleased

### Changed

- Widened the `@clossys/controller` dependency range from `~0.3.0`
  to `~0.4.0` to cover controller's settled canonical declaration location
  and requirement-id grammar (#315, #316). This package does not use
  `@clossys/controller/repository`, so nothing here changes
  behaviorally.

## [0.1.3] - Unreleased

### Changed

- Widened the `@clossys/controller` dependency range from `~0.2.0`
  to `~0.3.0` to track controller's own minor bump (a new canonical
  `liveStateSurface` export under `./conventions`; see
  `@clossys/controller`'s own changelog). No API change here.

## [0.1.2] - Unreleased

### Changed

- Widened the `@clossys/controller` dependency range from `~0.1.0`
  to `~0.2.0` to track controller's own minor bump (its skill-registry
  `scope` enum is now closed to `account`/`repo`/`third-party`; see
  `@clossys/controller`'s own changelog). No API change here.

## [0.1.1] - 2026-08-18

### Fixed

- `KNOWN_RELEASES` carried the SHA-256 of **empty input**
  (`e3b0c442...b7852b855`) as gitleaks 8.30.1's checksum. It is now the real
  digest, `551f6fc8...3f2470eb`, verified two ways: against the gitleaks
  project's own `gitleaks_8.30.1_checksums.txt`, and by hashing the
  8,230,402-byte asset directly.

  **This could not have admitted a bad binary.** `downloadAndVerifyGitleaks`
  verifies against the *caller's* `options.sha256`, never this table, and a
  real tarball never hashes to the empty digest — so the failure mode was a
  guaranteed, unexplained verification failure for any caller passing
  `resolveGitleaksRelease(v).sha256` straight through, plus a reader seeing a
  value that looked revalidated and was not.

  The table's own comment already said to revalidate every entry before the
  first real consumer. Nothing enforced that, so nothing did it, and 0.1.0
  shipped the placeholder. Four hermetic tests now assert the table is not the
  empty digest, matches the published checksum exactly, is a well-formed
  lowercase hex digest, and names the exact asset its version and platform
  imply — so the same omission cannot recur silently.

## [0.1.0] - 2026-08-18

### Added

New package (#283, part of the #281 recut). `inspector` absorbs
`verify-standards` (`0.1.2`) and `secret-scan` (`0.1.0`, zero consumers) —
one job that was two packages. See the package README's "Composition"
section for why, and its "Metric" and "Loop" sections for what this gate is
measured against and by whom.

- Everything `verify-standards` `0.1.2` shipped, carried forward whole:
  four checks (`checkSecretScan`, `checkTaskRecord`, `checkReviewEvidence`,
  `checkPolicyDrift`), the `verifyStandards` orchestrator and its
  `indeterminate`-dominant fold, the `0`/`1`/`2` exit contract with no flag
  that can turn a `2` into a `0`, the `MINIMUM_SAFE_VERSION` staleness floor,
  and `documents/caller-workflow.md`'s pipeline-free decide step and
  `edited`-inclusive trigger (both from #278/#290). `src/task-record.ts`'s
  word-boundary label guard and its shaped-candidate preference tier are
  unmodified — see that file's own comments for why each is load-bearing.
- Everything `secret-scan` `0.1.0` shipped, carried forward as the
  `./secret-scan` subpath: verified `gitleaks` binary download, checksum,
  extraction, and caching (`downloadAndVerifyGitleaks`,
  `getCachedGitleaksPath`, `resolveGitleaksRelease`, `getPlatformArch`,
  `getAssetName`, `getKnownVersions`), with the same exported shape.
- **New:** `attemptGitleaksScan` and `defaultGitleaksExecutor`, in
  `./secret-scan`. This is the actual wiring #283 asked for — a caller can
  now run gitleaks through this package and get a `SecretScanObservation`
  translated from its report, rather than every caller hand-writing that
  translation around a binary from somewhere else. `checkSecretScan` itself
  is unmodified: it still evaluates a record of an attempt from any source,
  and the attested path keeps working exactly as it did in `verify-standards`
  for a caller who scans by other means.
- The `inspector` executable (renamed from `verify-standards`; see "Notes"
  below) and its `--inputs` / `--checks` / `--minimum-version` /
  `--declared-range` / `--format` flags, unchanged in behaviour.

### Fixed

- **`downloadAndVerifyGitleaks` verified the wrong checksum.** It accepted
  `options.sha256` — a required field — and then silently ignored it,
  verifying against this package's own bundled `KNOWN_RELEASES` value
  instead. A caller who explicitly stated a checksum, including one
  deliberately different from the bundled value, had no way to know their
  value was never consulted. `expectedSha256` is now `options.sha256`;
  `resolveGitleaksRelease` remains available for a caller who wants this
  package's own recorded value to pass in, exactly as the README's usage
  example already showed — the README's claim was more accurate than the
  code. `release` continues to gate which *versions* this package will
  attempt at all; it no longer gates what *content* is trusted for one. This
  package's own `KNOWN_RELEASES` entry for `8.30.1` carries a placeholder
  checksum (visibly documented in `src/secret-scan/gitleaks.ts` and the
  README) that has not been revalidated against gitleaks' own published
  release checksums; this fix removes it from the verification path
  entirely, so its own staleness can no longer produce a false `verified:
  true`.

### Notes

- No exit-code semantics changed anywhere in the judge. `0` satisfied, `1`
  violated, `2` could-not-evaluate, and nothing here converts a `2` into a
  `0`.
- The CLI binary is renamed `verify-standards` → `inspector`, matching the
  package name. `documents/caller-workflow.md` is updated throughout: job
  id/name, concurrency group, decide-step name, artifact name, and the
  `--declared-range` example's `devDependencies` lookup key. A consuming
  repository that copied the old template must update its own workflow to
  match; nothing here does that automatically, the same way `verify-standards`
  0.1.1 could not retroactively fix a workflow file a consumer had already
  copied.
- **`MINIMUM_SAFE_VERSION` stays `0.1.0`**, unchanged from `verify-standards`'
  own floor. The floor exists for a released build that reported a passing
  verdict it should not have; a rename and a file move did not do that. What
  the rename *does* affect, which the floor mechanism cannot: a caller
  pinned to the previous scope's `verify-standards` cannot resolve
  `@clossys/inspector` through `npm`'s normal update path at all —
  it is a new package name, not a new version of the old one — so the
  version-range half of the staleness-floor check (`--declared-range`) has
  no path to warn that caller the way it would warn a caller merely behind
  on `verify-standards` releases. Left for a maintainer to decide in the
  pull request that introduces this package, rather than assumed here either
  way.
- Hermetic-tests coverage on the `./secret-scan` subpath is substantially
  deeper than `secret-scan` `0.1.0` shipped with: that package's own
  checksum-mismatch test was a stub ("skipped as it requires more complex
  mocking") and its download-success path had no test at all. Both are now
  exercised with an injected `fetch` and a real, locally-built `.tar.gz`
  fixture — no network call in any test, per this package's hermetic-tests
  rule.
