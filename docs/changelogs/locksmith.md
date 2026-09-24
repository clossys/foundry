# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [0.2.9] - 2026-09-23

### Notes

- No packed content changed. This package's test suite changed as part of
  fixing leaking temp fixture directories (issue #1250), and its 0.2.7
  qualification record was already retained -- once a version's record is
  retained, any further change to that package, packed or not, requires a new
  version. Renumbered from 0.2.8: main has since shipped provider-token
  custody (issue #1212) as 0.2.8, ahead of this test-only bump
  (version-collision rule, issue #1187).

## [0.2.8] - 2026-09-22

### Added

- Provider-token custody (issue #1212): `defineProviderCustody`,
  `defineProviderCustodyManifest`, `evaluateProviderCustody`, and
  `providerCustodyOf` judge a value-free custody declaration for a
  Cloudflare, Vercel, or GitHub provider token -- owner, storage location
  (never this repository), scope, a required least-privilege justification,
  which workflow/job consumes it, and an optional rotation policy in the
  same shape `rotation.ts` already judges. A new closed `CustodyRung` type
  (`operator-interactive`, `scoped-environment-secret`, `federated-oidc`)
  names the three ways a provider token may be held. Locksmith still never
  reads, stores, or transmits a token value; it judges the declaration
  against the definition. New CLI `clossys-locksmith-provider-custody`
  reads one declaration document and reports `satisfied` / `violated` /
  `indeterminate` with exit codes `0` / `1` / `2`, mirroring
  `clossys-locksmith-credential`. `evaluateProviderCustody` shares
  `credential.ts`'s accessor-safe, prototype-pollution-resistant record and
  array reads (`readOwnDataRecord`, `hasOnlyFields`, exported from
  `credential.ts`) rather than duplicating a weaker check.
- Conformance rework (owner direction, issue #1187): `evaluateProviderCustody`'s
  findings now use the shared `findingShape` (`{ rule, severity, message,
  path? }`, new `ProviderCustodyFinding`/`ProviderCustodyReasonRule` types)
  the repository contract docs/contracts/check-output-envelope.json declares
  (that contract does not ship with this package) instead of a bare
  `ProviderCustodyReason[]` string array -- no local copy of the contract,
  and `verdict` was already the contract's own
  `satisfied`/`violated`/`indeterminate` vocabulary. New
  `providerCustodyReport(declaration, version)` builds the full envelope
  document (`{ package, version, verdict, summary, findings, nextAction? }`);
  the CLI's new `--json` flag prints it. A new contract-conformance test
  (`src/check-output-envelope.test.ts`, a dev-only test not shipped with
  this package) reads the contract file directly and validates real
  `providerCustodyReport` output against it. The accessor-safe,
  prototype-pollution-resistant hardening carries forward unchanged.

## [0.2.7] - 2026-09-22

### Changed

- `no-value-escapes.test.ts` now derives its verb-module set from `index.ts`'s
  own export statements instead of a hand-written array, so a new verb
  module (e.g. `controlled-key-rate.ts`) is covered automatically instead of
  silently going unchecked (#907).

## [0.2.6] - 2026-09-21

### Added

- Ships the packed Agent Skill in the tarball (`files` includes `skill`).

## [0.2.5] - 2026-09-18

### Added

- Documented installation against the public npm registry
  (`https://registry.npmjs.org`) and that installing needs no authentication.
- Stated the charter close condition in the README: independent consumer
  evidence of `controlled key rate`, computed by `assessControlledKeyRate()`.
  An empty evaluated set is indeterminate, never a perfect rate of 1.
  `summarizeRotationMetric` is not this rate.
- Declared `foundry.assessment` against a new mapped `locksmith-check` bin
  with `invocation: "single-json-input"`. Advisor remains the only required
  first-day role.
- `locksmith-check assessment.json`: prints the `controlled key rate` report
  and exits on the `0` / `1` / `2` ternary.

### Notes

- This does not claim the position is closed. Qualification of `0.2.5` is
  deferred under #833.

## [0.2.4] - 2026-09-16

### Note

- **0.2.3 was never published; this release supersedes it without repeating
  its work.** 0.2.3 (below) carried the four audit-pass-3 fixes for issue
  #897, and its qualification record
  (`governance/release-qualifications/clossys-locksmith-0.2.3.json`) was
  generated and retained. Before publication, this repository's
  contamination-class gate caught a dangling reference, in the 0.2.3
  changelog entry below, to a repository policy document that does not
  ship inside this package -- a citation only, no path string an outside
  reader could act on, but not resolvable from this package directory
  either. Fixing that reference is itself a change to packed content
  (`CHANGELOG.md` ships in the tarball), which moved the package tree the
  0.2.3 record was generated against. Qualification records are
  immutable -- each file path is introduced exactly once and is never
  corrected in place -- so the 0.2.3 record cannot be updated to match, and
  0.2.3 cannot be published. This release carries the same already-fixed
  source unchanged (the entry below no longer names that document) and
  exists solely to obtain a fresh, never-before-used record path.

## [0.2.3] - 2026-09-16

### Fixed

- **The README's "Hard boundaries" section claimed a package-wide
  value-free guarantee that only a 5-of-22-module test proves (audit pass 3
  of #897, finding A).** "No code path in this package reads, logs,
  prints, or transports a secret value" was stated unqualified, but
  `no-value-escapes.test.ts` only ever covered the five verb modules named
  in its own header -- `custody`, `rotation`, `revocation`, `distribution`,
  `credential` -- and explicitly forbids those five from importing
  `client.ts`, `adapters.ts`, or the Infisical subtree. The README's own
  first usage example contradicts the broad claim it later makes:
  `createSecretsClient(...).require()` returns a value, `infisical.get()`
  returns a value, and `run()` transports every project secret into a
  child process environment. For a credential package, an unqualified
  false safety claim is the "reader skips their own audit" hazard in its
  most direct form. The claim is now scoped to the five modules the test
  actually proves it for, with an explicit list of the entry points that do
  handle values.
- **The rotation "learn" bullet claimed a repeatedly-`unverifiable` key
  shows up in `summarizeRotationMetric`'s owner count the same way an
  unowned key does (finding B).** It does not:
  `unownedKeyCount` only ever counted `state === "unowned"`, so a set where
  every key is `unverifiable` reported `unownedKeyCount: 0`, silently
  losing the "could not observe" signal. Fixed by giving the metric a
  channel for that signal instead of only correcting the prose: `RotationMetric` gains a new
  `unverifiableKeyCount` field, and `summarizeRotationMetric` now counts
  `unverifiable` keys separately from unowned ones. This is an additive,
  non-breaking change to a public type (`RotationMetric` gains a required
  field; existing code that reads `p95AgeDays` / `unownedKeyCount` is
  unaffected, and any code that already spreads or serializes the full
  object gains one more key). The alternative -- narrowing the README's
  claim without changing the metric -- was rejected: this repository's
  package-lifecycle policy is explicit that "a thing that could not be
  observed must not grade identically to a thing observed and found fine,"
  and this package's own `RotationState` already keeps `unverifiable`
  distinct from every other state for exactly that reason; the metric
  should not reintroduce the collapse the state union was designed to
  prevent.
- **`dist/infisical/types.d.ts` referenced the ambient `NodeJS` namespace
  (`InfisicalRunOptions.env: NodeJS.ProcessEnv`,
  `InfisicalRunResult.signal: NodeJS.Signals`) despite `@types/node` being
  neither a dependency nor a peer, and the README's Requirements promising
  no runtime dependencies (finding C).** A consumer importing
  `@clossys/locksmith/infisical` with no `@types/node` installed and
  `skipLibCheck: false` failed to typecheck with `TS2503: Cannot find
  namespace 'NodeJS'`. Replaced both with structural types --
  `Record<string, string | undefined>` for `env` and `string | null` for
  `signal` -- which lose nothing: `process.env` already satisfies the
  former structurally, and every signal name Node reports is a string.
- **The installed bin `clossys-locksmith-credential` was undocumented in
  the README, and `src/cli.ts`'s header comment still described
  `infisical/cli.ts` as "the only bin this package ships" (finding D).**
  Added a `clossys-locksmith-credential` CLI section to the README
  (usage, exit codes, and what it does and does not do), and reworded the
  comment to describe the package's two-bin state accurately instead of
  the pre-0.2.2 one.

## [0.2.2] - 2026-09-14

### Added

- **A CLI for `evaluateCredential`, the installed executable
  `clossys-locksmith-credential` (issue #849, #850).** `evaluateCredential`
  and `defineCredentialEvidence` (`./credential.ts`) already mapped
  satisfied/violated/indeterminate credential lifecycle evidence to exit
  codes 0/1/2, but no caller could reach that machinery except by importing
  the library directly — the package's only existing bin
  (`infisical/cli.ts`) relays an unrelated subprocess's own exit code and
  never touches it. The new command reads one caller-assembled JSON evidence
  document and reports the verdict unchanged: it mints, fetches, and rotates
  nothing, and talks to no provider. Like the CLI split this catalogue
  already uses elsewhere, `src/bin.ts` is the thin installed entry point and
  `src/cli.ts` exports a port-injected `main(argv, port)` that is testable
  without touching a real filesystem or process.

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

### Added

- **A second `bin` name, `clossys-secrets-infisical`.** It points at the same
  entry point as the existing one, so both names now install and behave
  identically. The previous name carried a producer identity this catalogue no
  longer publishes under, and a command on a consumer's `PATH` is the one
  surface where that is not merely cosmetic.

### Deprecated

- **The `vespene-secrets-infisical` bin name.** It is still installed and
  still works; it is deprecated as of this entry and will be **removed one
  release cycle after this deprecation ships**. Renaming it in place would
  have deleted a command consumers may already have wired into their own CI,
  which is a breaking change, not a rename — so both names ship together for
  a cycle and callers migrate on their own schedule. Migration is a
  one-for-one substitution: every command, flag, exit code, and output is
  unchanged.

### Changed

- `--help` output and CLI error prefixes now name `clossys-secrets-infisical`.
  Invoking the deprecated name still works and still prints this usage text;
  the name it prints is the one callers should move to.
- The catalogue's own scope transition is now described without naming the
  producer account this catalogue no longer publishes under. History is
  unchanged; only the way the retired scope is referred to is.


## [0.1.8] - 2026-09-02

### Fixed

- Declared `bin` targets without a leading `./`. npm rejected the dotted
  form as an invalid script name and **removed the entry entirely** on
  publish, so the Infisical CLI bin would not have been installed
  by a consumer of the previous release.

### Changed

- Named Clossys as copyright holder in `LICENSE` and as `author` in the
  package manifest, so every package in the catalogue attributes identically.


## [0.1.7] - 2026-08-31

### Changed

- Prepared a bounded trusted-publisher patch source for provenance after the owner-present first publication and anonymous registry verification. This change does not publish the package or claim provenance.

## [0.1.6] - 2026-08-31

### Added

- Added the Infisical CLI's `qualify` command, an offline readiness operation
  that compares a strict value-free version-1 catalog with a strict
  names-only availability snapshot. It exits `0` when every required catalog
  name is present, `1` when a required name is missing, and `2` for malformed
  input. The operation reads only those two files: it does not accept provider
  configuration, read credentials, perform network access, or print a secret
  value.

## [0.1.5] - 2026-08-30

### Added

- Added a value-free credential lifecycle contract that distinguishes
  provider-created ephemeral job credentials from manually rotatable secrets.
  Ephemeral evidence validates provider, scope, job lifetime, scoped use, and
  expiry-at-job-end semantics without inventing a rotation timestamp. Manual
  evidence keeps repository-secret metadata separate from owner-controlled
  token provenance, so `updatedAt` alone remains indeterminate. Results retain
  the closed `satisfied` / `violated` / `indeterminate` and `0` / `1` / `2`
  behavior. Scope evidence is dense, sorted, unique, and limited to an explicit
  GitHub permission vocabulary; expiry evidence distinguishes unknown from an
  explicit false assertion; and every unexpected own key, including symbols,
  is rejected without being echoed. This is a contract addition only; no
  consumer adoption is claimed.

## [0.1.4] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.1.3] - 2026-08-21

### Changed

- **The changelog is now shipped in the published package (#400).** This file
  was written and maintained but was absent from `package.json`'s `files` array,
  so it never reached the tarball. A consumer installing this package could not
  read what a breaking upgrade breaks without leaving the registry and finding
  the source repository. Adding it to `files` is the whole fix; no runtime code
  changed in this release.

## [0.1.2] - 2026-08-19

### Changed

- **`prepublishOnly` now runs the name-collision check before building.** A hand-run `npm publish` from this package's directory previously built and published without `check-name-collision.mjs` ever executing — npm only runs `prepublishOnly` for a directory-type publish, and this manifest declared just `npm run build`. See [issue #273](https://github.com/clossys/foundry/issues/273). No runtime behavior changed.

## [0.1.1] - Unreleased

### Documentation

- **README states a consuming plane's credential-inventory loop-close
  condition (issue #285's acceptance criterion), and links issue #326 for
  the fuller lifecycle scope this slice does not yet claim.** Closes when
  the declared inventory accounts for every live credential and none reads
  `unverifiable` without an explicit opt-out; reopens on any credential
  observed in use but never declared. No code change.

## [0.1.0] - Unreleased

Renamed from the previous scope's `secrets`, which never published a release.
Resolution was one verb of five; this package now owns the other four —
custody, rotation, revocation, and distribution — end to end, alongside the
resolution contracts unchanged.

### Added

- Key custody: a value-free manifest of who owns each declared key and where
  it lives (`defineKeyCustody`, `custodyOf`, `unownedKeys`).
- Key rotation: an explicit four-state result — `current` / `stale` /
  `unowned` / `unverifiable` — so a rotation the system cannot observe is
  never reported as fine (`evaluateRotation`, `rotationQueue`,
  `summarizeRotationMetric`, `sameDigest`).
- Key revocation: a pointer to upstream revocation authority and a
  value-free record of a revocation, with no code path that performs a
  revocation itself (`defineRevocationPath`, `recordRevocation`,
  `isRevoked`, `latestRevocation`).
- A distribution manifest declaring which principal may resolve which name
  (`defineDistributionManifest`, `mayResolve`, `principalsFor`, `keysFor`).
- Initial provider-neutral client and adapter contracts.
- Late-bound environment and mutable in-memory test adapters.
- Async and synchronous resolution with safe, value-free errors.
- Value-free secret catalog types and a frozen catalog authoring helper.
- Infisical v4 API integration at the `./infisical` subpath with injected
  configuration, access-token and OIDC authentication, value-free readiness,
  child-process injection, and a provider-specific CLI that never prints
  secret values.
- Separately constructed, policy-gated Infisical replacement with optional
  verification and no unsafe automatic rollback.
