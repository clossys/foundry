# Changelog

All notable changes to this package are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).


## 0.1.12 - 2026-09-24

- The changelog is no longer included in the package; it now lives in the public repository, linked from the README.
- Remove the duplicated "How we work together" and "One question at a time"
sections from this package's packed skill (`skill/SKILL.md`).
`@clossys/launcher` injects the shared conversation contract when it
composes a skill for a consumer, so the packed skill no longer carries its
own byte-identical copy (#1182).

## [0.1.11] - 2026-09-22

### Notes

- No packed content changed. This package's test suite changed as part of
  fixing leaking temp fixture directories (issue #1250), and its 0.1.10
  qualification record was already retained -- once a version's record is
  retained, any further change to that package, packed or not, requires a new
  version.

## [0.1.10] - 2026-09-21

### Added

- Ships the packed Agent Skill in the tarball (`files` includes `skill`).

## [0.1.9] - 2026-09-19

### Fixed

- **`bouncer-check authority-reconciliation` now attributes the unreconciled
  surface line to the failing provider (#1000).** The line printed
  `Unreconciled grant surface: N` with no reference to which provider of
  record failed, so in a multi-owner setup — one gate run covering every
  owner's grants — a single provider's revocations surfaced as an
  unattributed count the reader had to correlate against the finding lines
  below it. When the surface is non-zero, the line now names the failing
  side: `Unreconciled grant surface: 2 (providers: provider-a, provider-b).`,
  taking each unreconciled finding's `providerId` — the consumer-authored,
  host-owned reference the finding lines already print; a singular
  `(provider: …)` form is used when exactly one provider failed, and the line
  is unchanged when the surface is zero. No credential material is ever
  printed: `providerId` is an opaque host-owned reference by schema. Exit
  codes are unchanged, including `2` for unverifiable.

## [0.1.8] - 2026-09-18

### Added

- Documented installation against the public npm registry
  (`https://registry.npmjs.org`) and that installing needs no authentication.
- Stated the charter close condition in the README: independent consumer
  evidence of `unreconciled grant rate`, computed by
  `assessUnreconciledGrantRate()`. An empty evaluated set is indeterminate,
  never a perfect rate of 0. `checkAuthorityReconciliation` still reports
  unreconciled grant surface as a count; that count is not this rate.
  Unverifiable observations stay unevaluated. Grant expiry is not this
  metric.
- Declared `foundry.assessment` against a new mapped `bouncer-rate-check`
  bin with `invocation: "single-json-input"`. `bouncer-check` remains the
  three-gate CLI and is not the assessment surface. Advisor remains the
  only required first-day role.
- `bouncer-rate-check assessment.json`: prints the `unreconciled grant rate`
  report and exits on the `0` / `1` / `2` ternary.

### Notes

- This does not claim the position is closed. Qualification of `0.1.8` is
  deferred under #833.

## [0.1.7] - 2026-09-16

### Fixed

- **The 0.1.6 entry below overstated one of its own findings.** It said
  `verify.ts`'s stale citation of `auth-clerk.test.ts` pointed at a file
  that "never existed in this repository at all." That is false, and this
  repository's own history contradicts it:

  ```
  $ git log --all --full-history --diff-filter=A --name-only -- '*auth-clerk.test.ts'
  579b5d8 Add consolidated auth package (#103)
  packages/auth/src/providers/clerk/auth-clerk.test.ts
  $ git log --all --full-history --diff-filter=D --oneline -- packages/auth/src/providers/clerk/auth-clerk.test.ts
  9bd1137 Retire superseded donor packages (#536)
  ```

  The file was real: it lived at
  `packages/auth/src/providers/clerk/auth-clerk.test.ts` in the `auth`
  donor package, added by #103, and was deleted by #536 when the donor
  packages were retired. `verify.ts`'s comment cited it correctly at the
  time it was written — the citation rotted only because a later,
  cross-package retirement removed its referent, with nothing in CI
  positioned to notice a doc comment in one package going stale because
  of a commit to a different package. That makes the defect systemic — a
  retirement with no mechanism to find what it orphans elsewhere in the
  repository — rather than the carelessness the 0.1.6 wording implied.
  Per this repository's own package-lifecycle policy ("derived from
  evidence, never declared"), this is a forward correction: the 0.1.6
  entry below is left as originally written, and this entry records the
  accurate account instead of rewriting it in place.
- **Four remaining bare citations of files outside this package's own
  publishable boundary, in `src/internal/peer-version.ts`.** The 0.1.6 fix
  deliberately kept one citation of repo-root
  `scripts/check-workspace-links.mjs` in this file's header comment,
  because the header discloses inline, in the same paragraph, that
  `scripts/` is outside every package's `files` allowlist and so does not
  ship — the unavailability is the sentence's own subject, not a
  disclaimer bolted on afterward. That reasoning does not extend to four
  other sites in the same file that named the same script, or its sibling
  `check-workspace-links.test.mjs`, bare and without the header's nearby
  disclosure: a reader arriving 75–160 lines below the header has no way
  to connect the two. Each of the four now either carries the
  does-not-ship qualifier at its own site or is reworded so it no longer
  points a reader at a path they cannot open; the header citation itself
  is unchanged, since the reasoning for keeping it still holds.
- **A 0.1.4 changelog bullet named an unshipped test file bare.** The
  0.1.4 "Added" entry below opened with
  `` `internal/peer-guard-coverage.test.ts`, deriving its subpath set
  from… `` — naming the file with no note that it does not ship, unlike
  the self-describing 0.1.5 and 0.1.6 mentions of the same file. The
  bullet now states directly that the file is excluded from both the
  TypeScript build and the packed tarball.

## [0.1.6] - 2026-09-16

### Fixed

- **A shipped citation pointed at a file no consumer receives.** 0.1.5
  removed three dangling citations of a repository-root decisions log by
  path (see the 0.1.5 note below) but, in the same rewrite, introduced a
  citation of the identical class: `src/index.ts`, `src/providers/clerk/web/client.tsx`,
  `src/providers/clerk/web/proxy.ts`, and `README.md` all named
  `internal/peer-guard-coverage.test.ts` by path. That file is excluded
  from the TypeScript build (`tsconfig.json`'s
  `"**/*.test.ts"`/`"**/*.test.tsx"` excludes) and from the packed tarball
  (`package.json`'s `files` allowlist negates `src/**/*.test.ts`), yet the
  citation survived into `dist/index.js`, `dist/index.d.ts`,
  `dist/providers/clerk/web/client.js`, `.../client.d.ts`,
  `.../proxy.js`, `.../proxy.d.ts`, and the shipped `README.md`, because
  `tsc` preserves comments. A consumer reading any of those shipped files
  was pointed at a path that does not exist in anything they can install.
  `scripts/check-contamination-classes.mjs`'s CLASS 1 check did not catch
  this because it only matches `.md` paths (tracked separately as #935;
  out of scope for this fix). Auditing the rest of the package (against
  the actual packed tarball, not just the `files` array) turned up the
  same class in six more places — `src/schema.ts`, `src/cli.ts` (two
  citations), `src/providers/clerk/verify.ts`,
  `src/internal/peer-version.ts`, and
  `src/providers/clerk/web/server-routes.tsx` — each naming a sibling
  `*.test.ts`/`*.test.tsx` file that does not ship either. One of those,
  `src/providers/clerk/verify.ts`, cited a file
  (`auth-clerk.test.ts`) that never existed in this repository at all;
  the real, non-shipping test for that module is `verify.test.ts`. Every
  one of these doc comments explained genuinely subtle guarded-peer
  behavior worth keeping, so each citation is rewritten to describe what
  is verified — confirmed directly by this package's own internal test
  suite — without naming a path the reader cannot open, rather than
  deleted outright.

## [0.1.5] - 2026-09-16

### Note

- **0.1.4 was never published; this release supersedes it without repeating
  its work.** 0.1.4 (below) carried the actual #889 fix — the `next` guard
  in `proxy.ts` and the corrected coverage claims — and its qualification
  record (`governance/release-qualifications/clossys-bouncer-0.1.4.json`)
  was generated and retained, binding candidate `packageTreeSha1
  294f33ab7b064a5f0aebe6a62d17a550fbf7ebb7` (tarball sha256
  `79ba339e1d5c188ad7640b47487b6322b54dc65a75d5a594471d55e8a9d89f07`).
  Before publication, CI's `prose quality` gate (`check-contamination-classes.mjs`)
  caught three CLASS 1 findings — `src/internal/peer-guard-coverage.test.ts`,
  `src/providers/clerk/web/client.tsx`, and `src/providers/clerk/web/proxy.ts`
  each cited a repository-root decisions log by path, a reference that does
  not ship with the published package and that a reader of the installed
  package cannot open. That correction touched files inside `packages/bouncer/`,
  moving the package tree and leaving the retained 0.1.4 record qualified
  against a tree that no longer exists. Qualification records are
  immutable — each file path is introduced exactly once and is never
  corrected in place — so the 0.1.4 record cannot be updated to match, and
  0.1.4 cannot be published. This release reuses the already-fixed source
  unchanged and exists solely to obtain a fresh, never-before-used record
  path. See #889.

## [0.1.4] - 2026-09-16

### Fixed

- **Three entry points accepted an incompatible `@clerk/nextjs` or `next`
  silently instead of naming it (#889).** `./providers/clerk/web/proxy`
  imported both `next/server` and `@clerk/nextjs/server` unconditionally
  with no `assertPeerVersion` guard for either; `./providers/clerk/web`
  and its `/client` alias imported `@clerk/nextjs` unconditionally,
  guarding only `react`. An installed-but-incompatible peer at any of
  these three entry points previously surfaced as whatever `next` or
  `@clerk/nextjs` themselves happened to crash on, with nothing naming a
  version range as the cause. `./providers/clerk/web/proxy` now guards
  `next` the same way `./providers/clerk/web/server` already did, reading
  the installed version from `next/package.json` — `next` declares no
  `exports` field of its own, so that subpath resolves as an ordinary JSON
  import, with no `node:fs` involved and no risk to an edge-runtime
  bundle (confirmed with `esbuild --platform=browser`).
- **A comment in `client.tsx` claimed `@clerk/nextjs` was "guarded instead
  from `server-routes.tsx`."** It was not: `./providers/clerk/web` and its
  `/client` alias never import `server-routes.tsx` at all (confirmed by
  reading their own `export … from` statements), so that claim was false
  on the day it was written, not merely stale. The comment is corrected.
- **`README.md`, `src/index.ts`, and both `dist/` copies claimed every
  Clerk web entry point "guards its own optional peer with
  `assertPeerVersion`."** True for three of five; false for
  `./providers/clerk/web`, `/client`, and `/proxy`'s `@clerk/nextjs`
  import specifically. Corrected to state precisely which peers are
  range-guarded at which entry points, and why `@clerk/nextjs` cannot be:
  its own `exports` map declares no `./package.json` subpath (confirmed:
  `require("@clerk/nextjs/package.json")` throws
  `ERR_PACKAGE_PATH_NOT_EXPORTED` against the real installed 7.9.1), and
  its public surface exports no version constant of any kind — a
  permanent constraint of that peer's own published shape, not a gap in
  this package's effort. `@clerk/nextjs`'s presence is still guarded: the
  unconditional import already throws Node's own named
  `ERR_MODULE_NOT_FOUND` if it is absent.
- **The README's absent-vs-out-of-range sentence described unreachable
  behavior.** Every guarded call site sits behind a static ESM import, so
  an absent peer throws Node's own module-resolution error before
  `assertPeerVersion`'s "not installed" message can ever run — the guard's
  real job is the installed-but-incompatible case. Corrected.

### Added

- `internal/peer-guard-coverage.test.ts` — a test file excluded from both
  the TypeScript build and the packed tarball, so it does not ship with
  this package — deriving its subpath set from `package.json`'s own
  `exports` map (never a hand-written list) and checking each subpath's
  BUILT `dist/` import graph, not `src/`. It either confirms a co-located
  `assertPeerVersion` call for every optional peer a subpath's compiled
  output imports, or requires a named, bidirectionally-checked exception —
  `@clerk/nextjs` at `./providers/clerk/web`, `/client`, and `/proxy`
  today, for the reason above. This is the enumerate-and-confirm test
  #889 itself named as missing.

## [0.1.3] - 2026-09-02

### Fixed

- Declared `bin` targets without a leading `./`. npm rejected the dotted
  form as an invalid script name and **removed the entry entirely** on
  publish, so `bouncer-check` would not have been installed
  by a consumer of the previous release.

### Changed

- Named Clossys as copyright holder in `LICENSE` and as `author` in the
  package manifest, so every package in the catalogue attributes identically.


## [0.1.2] - 2026-08-31

### Changed

- Prepared a bounded trusted-publisher patch source for provenance after the owner-present first publication and anonymous registry verification. This change does not publish the package or claim provenance.

## [0.1.1] - 2026-08-30

### Changed

- Updated the package's public repository, issue-tracker, and homepage metadata to the canonical Foundry repository. This change is not a publication or qualification claim.

## [0.1.0] - 2026-08-22

First release. This package is the bouncer role: everything about who you
are, what you can do, and how that changes over time.

This changelog starts here rather than carrying the donor's history, which
cites decisions and issues that would mean nothing — or the wrong thing —
to a reader who arrives at this package first.

### Added

- **A three-state runtime verdict.** `evaluateGrant` returns `authorized`,
  `denied`, or `unverifiable`. The third is not a flavour of the second:
  fold "the provider did not answer" into `denied` and every provider
  outage becomes a mass revocation, fold it into `authorized` and the same
  outage becomes a silent blanket grant.
- **A grant schema in which a session proves nothing.** `Grant` carries an
  optional `sessionId` that no checker ever reads as evidence, because the
  defect this package exists for is a well-formed session outliving the
  authority behind it by an hour.
- **A provider observation whose reachability is a field, not an
  inference.** "The provider says nothing is backed" and "the provider did
  not answer" produce an identical empty list, so `ProviderAssertion`
  carries `reachability` explicitly and the validator refuses a record
  whose two halves disagree, in both directions.
- Three gates, all reachable from the single `bouncer-check` bin:
  `authority-reconciliation`, `delegation-ceiling`, and
  `provider-contract`. Each dispatches on `argv[0]` matching exactly —
  never on `basename(process.argv[1])`, which would see `cli.js` and
  silently run the wrong command wherever a gate is invoked by compiled
  path.
- The `0` / `1` / `2` exit contract, with `2` reachable on every gate by
  more than one route — an unreadable or invalid record store, an empty
  record set, a provider that could not be reached, a provider shape that
  was never supplied, and no gate selected at all — and each route tested.
  A bare `bouncer-check` exits `2` with its usage on **stderr**: nothing
  was selected, so nothing was checked. Only an explicitly requested
  `--help` exits `0`.
- **An `./agent` subpath** for delegated machine actors: lifecycle
  classification, a fail-closed tool-scope guard, and a monetary-authority
  guard, all provider- and framework-neutral.
- **Provider adapters isolated behind `./providers/*`.** The Clerk adapter
  ships as `./providers/clerk` plus `./providers/clerk/web`, `/web/client`,
  `/web/server`, and `/web/proxy`, split so importing the edge-safe proxy
  entry never pulls `next/headers`, `next/navigation`, React, or client
  components. The root imports none of them.
- `assertPeerVersion`, ported rather than shared, guarding every optional
  peer at import time. An absent peer and an out-of-range peer throw
  different messages; an installed version the guard cannot parse is
  treated as indeterminate and warns rather than blocking a build.
- **The published tarball carries this changelog.** `files` includes
  `CHANGELOG.md`: a consumer reading the installed package should not have
  to leave it to find out what changed.

### Design notes

- **An unreachable provider exits `2`, never `0` and never `1`.** A
  comparison that did not happen is not a comparison that passed, and it is
  not a denial either — the two have different corrections. Inside a single
  run, indeterminate wins over violated: a caller handed "1, here are the
  findings" reasonably reads it as "and there are no others", and when a
  provider was unreachable there may well be.
- **A machine actor's spend ceiling has three distinguishable states.** A
  number is a declared ceiling, `null` is "no monetary surface", and ABSENT
  is nobody having decided. The schema keeps absent absent through
  validation rather than collapsing it to `null`, because collapsing it
  would delete the finding before the checker ever ran. There is an opt-out
  for a deliberate `null` — `unlimitedSpendIsDeclared` — and none at all
  for absent: you cannot declare deliberate a question nobody asked.
- **The gate and the runtime disagree about `null`, on purpose.**
  `assertAgentMonetaryAuthority` reads it as unlimited amount authority and
  proceeds, which is right at the moment of a call. `checkDelegationCeiling`
  reports it, which is right at review. Different times, different
  questions.
- **An under-declared actor validates and is reported; it is not a parse
  error.** `toolScope` and `responsibleHumanId` are optional in the gate's
  schema and required by the runtime context type, so an actor that answers
  to nobody produces a nameable finding rather than an anonymous "the file
  was malformed".
- **`provider-contract` is checked in both directions.** An adapter reading
  a field the provider dropped and a provider emitting an event the adapter
  ignores are two different silences, and only one of them is visible from
  either side alone.
- **No provider schema is ever fetched.** A gate needing network access,
  credentials and a per-provider client could not run in the offline,
  hermetic position where a gate belongs. Transcription is the consumer's
  job; keeping the transcription honest is the gate's.

### Not included

- No roles, tiers, entitlements, ceilings, currencies, providers, or
  policies of our own. No role vocabulary and no jurisdiction logic. Every
  declaration is authored by the consumer.
- Storage and audit are host-supplied ports and no implementation of either
  ships here. This package writes nothing and stores nothing.
- No person-attributable record is written into this repository.
  `actorId`, `subjectId`, and `responsibleHumanId` are opaque host-owned
  references carrying no email, name, phone number, address, or IP — and
  actor and subject are never merged into one identifier.
