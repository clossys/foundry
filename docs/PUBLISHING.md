# Publishing a package

This is a checklist rather than prose because the failure mode — publishing
something that should have stayed private — is not reversible. Anything
pushed to a public remote should be assumed cached and indexed even if
deleted minutes later.

One predecessor package, `@vespeneventures/contract`, was published from this
repository and has since been removed from the codebase and predecessor
registry (see [docs/DECISIONS.md](DECISIONS.md) for why). This is immutable
historical evidence, not a current package or install instruction. Its name
must not be reused for a different package, even though it now returns `404`.
Everything below describes source eligibility during W1D and the separate W1E
publication boundary, not a complete registry inventory.

---

## 0. Is the package eligible?

A public package whose dependency is private is broken for everyone outside.
**Any published set must be closed under its dependencies.**

- [ ] Zero internal runtime dependencies, or every internal dependency is
      already published here.
- [ ] No `workspace:*` or `catalog:` protocols anywhere in `package.json` —
      neither resolves for a normal external installer. Pin real semver
      ranges.
- [ ] The licence is MIT and matches the repository `LICENSE`.
- [ ] A role package or explicit executable-tooling package ships a runnable
      `bin`. A temporary compatibility
      package may instead declare `shipsNoGate` in
      `docs/contracts/package-evidence.json` with a reason and an issue tracking
      the gate or retirement work. See
      [DECISIONS.md 11](DECISIONS.md#11-a-gate-behind-a-bin-or-a-declared-primitive).
      An undeclared absent `bin` is indistinguishable from one nobody
      remembered to build — `npm run check:package-evidence` fails on exactly
      that, so this box is checked mechanically rather than on trust.

### Runtime dependency order

Publication order follows the runtime graph, not filesystem order or the
order packages happen to appear in a workspace:

```
builder ── controller
inspector ── controller
publisher ── controller
publisher ── designer
publisher ── writer
```

These are the complete first-party runtime edges in the current manifests:
the package on the left requires the package on the right. Every other
current package has no first-party runtime dependency. `controller` lists
`advisor` only as a development dependency; Advisor-before-Controller is
engagement sequencing for the representative Trio, not a manifest edge.
Advisor's connector, sponsor identity, evidence store, and any repository or
provider adapters remain consumer-owned.

This graph is publication order. It is not the first-wave productization <!-- facts-gate:ignore -->
order. Writer and designer sit before publisher here because publisher cannot
publish without them; they do not jump the operating-control queue when the
remaining work is "make each package honestly installable and closed-loop."
That sequence — catalogue integrity, Advisor, Starter, Controller, operating
control, agreements, then expression, with publisher before influencer — is
[`docs/FIRST-WAVE.md`](FIRST-WAVE.md) and
[`docs/contracts/first-wave-sequence.json`](contracts/first-wave-sequence.json).

`controller` (issue #282 — formerly three separate packages: `governance`,
`conventions`, and `policy`) owns the catalog, composition, gates, release,
repository, review, conventions, and policy subpaths, with no runtime
dependency of its own. The former standalone names (`governance`, `policy`,
`catalog`, `gates`, `release`, `repository`, and `review`) are historical
retired package identities, not current wrappers or integration targets. A
local workspace build is not evidence that this graph is closed: workspace
links can satisfy a package that an external registry installer cannot obtain.

For a dependent package, W1E's final proof is an isolated install of the exact
tarball scanned and selected for publication, after its sibling runtime
packages are present and verified in public npm. The current
`@clossys/controller` source `./release` subpath supports that future proof
with `packRoundTrip`'s explicit `tarballPath` and `registry` options. Public
npm reads are credentialless; no consumer token is inherited from ambient
configuration or retained in a debug directory.

`@clossys/controller` also contains consumer-facing CLIs. W1E must verify that
an isolated public npm installation can import its API and run
`foundry-governance` against a valid lifecycle document before describing the
artifact as installable. During W1D these are source and tarball checks only.
The predecessor `@vespeneventures/controller` and standalone
`@vespeneventures/governance` names are historical evidence, not alternative
installation paths.

### Singular authority convergence

Where a candidate package declares `foundry.singularAuthority`, a producer
simulated-consumer run must keep that authority to one resolved version or
record a bounded disposition. Use Controller's installed
`singular-authority-check` on the frozen npm v2/v3 or bounded pnpm v9 lock,
with caller-supplied declarations collected from the exact candidate manifests.
The result must retain exact resolved versions and introducing dependency edges.
An out-of-range target says the installed depender needs a compatibility-range
release; an override is indeterminate until executable compatibility proof;
and an explicitly isolated non-authoritative helper is a disposition, not a
single-authority claim. This is a graph check only. It does not substitute for
the exact-candidate simulated-consumer qualification record, real consumer
adoption, grounding, or closure.

Because pnpm v9 snapshots retain resolved transitive targets but not every
depender's declared range, target qualification supplies caller-retained exact
dependency constraints bound to parsed snapshot edges. An unmatched or
conflicting constraint, or a non-helper authority edge without an effective
range, is indeterminate; it never becomes a compatibility pass.

## 1. Copy the source — and only the source

- [ ] Copy `src/`, `tsconfig.json`, and the test config. Nothing else.
- [ ] **Do not copy `dist/`.** Build output can embed resolved local paths
      and other detail from wherever it was compiled. Build it fresh here
      instead.
- [ ] **Do not copy `CLAUDE.md`, `AGENTS.md`, or `CHANGELOG.md`.** These tend
      to be the single largest contamination source in a staged tree —
      excluding them plus `dist/` typically removes the majority of findings
      before any prose scrubbing even starts.

## 2. Scrub prose

Run the gate immediately, before writing anything new:

```bash
node scripts/check-public-safety.mjs packages/<name>
```

Findings on a first pass tend to be almost entirely in prose — doc comments
and README text describing internal systems by name, rather than in the
executable code itself. The count drops fast once you know the shape of what
to strip. Rewrite each comment to describe the general problem the code
solves rather than the internal situation that prompted it. The result is
usually better documentation for an outside reader.

Watch for the quieter cases the denylist cannot catch — none of these produce
a gate finding on their own, which is why two more scripts exist specifically
for them (see below):

- References to internal file names and internal packages without their
  scope prefix — no denylist rule matches these, and they are meaningless to
  an outside reader.
- Statistics about the private codebase's shape (a count of files or repos
  something "appears across"). Not a secret in the identity sense, but it
  discloses scale and topology of something not meant to be public knowledge.
- A "proving consumer" section naming the internal package that first
  adopted this one.
- Pointers to internal-only docs (a doc comment citing a private
  architecture doc by path — a real file, but not one that ships in the
  public repo). Inline the guidance instead of citing a doc the reader can't
  open.
- **Functional code, not just prose, that encodes an internal convention.**
  A component rendering with an internal, cross-codebase tagging attribute
  (something shaped like `data-xx-...`) is meaningless to an outside reader
  and reveals an internal naming scheme. No denylist rule catches an
  attribute name; this needs a human read to notice it's a convention rather
  than a one-off, then renaming it to something self-explanatory that still
  serves the same purpose (e.g. a stable selector) for an outside reader.
- **A dependency on private runtime state with no public equivalent.** Code
  that silently relies on CSS custom properties, feature flags, or config a
  private package normally supplies will break or render wrong for anyone
  installing the public package alone. The fix is a documented fallback at
  every call site (e.g. `var(--x, <default>)`), plus a README section
  documenting them. **This is the sharpest general lesson: check whether the
  code silently depends on something you decided not to publish — that's a
  missing dependency, not a string, so nothing that greps for text will ever
  find it.**

Two scripts operationalize the harder-to-catch classes above and run in CI on
every pull request, unconditionally (they read everything from the tree
itself, never the denylist):

```bash
node scripts/check-contamination-classes.mjs packages/<name>
node scripts/check-readme-parity.mjs packages/<name>
```

`check-contamination-classes` reads the files the package actually **ships**
— the `npm pack` file list, not the working tree — and asks of every citation
in them whether a reader who installed the package could open it. Add
`--include-built` after a build to scan `dist/` too, which is what
`preflight-package.mjs` does; `tsc` preserves comments, so a citation written
in a source comment is also sitting in the `.d.ts` a consumer reads. A
citation that says inline that its referent does not ship (`"this package's
own (unshipped) test suite"`) is not reported — that is the house convention
for a reference that is deliberately outside the tarball, and it exists so
nobody needs a suppression comment.

That convention covers exactly one case: a path that is **real but not in the
tarball**. It does not cover a path that is tracked nowhere at any commit,
which is a reader being sent somewhere that does not exist, and no wording in
a source file excuses it — not `"no longer exists"`, not `"was deleted"`, not
anything else. The one place prose can record such a path is a `CHANGELOG`
entry describing the citation it just removed, and even there the wording has
to be in the same sentence as the path. If you hit this in source, the fix is
to correct the citation or drop it; if it cannot be fixed in the change you are
making, it needs an entry in `governance/known-dangling-citations.json`, which
is reviewed in a diff and is itself a finding once it stops matching anything.

`check-readme-parity` catches two specific, previously-real defects: an export
that exists in `src/index.ts` but is undocumented in the README (added in the
same commit as a feature, with nothing forcing the README to keep up), and a
README `import` example written against the wrong package name (this
happened for real after a rename — every copy-pasteable example was broken as
written; `npm install` got the right tarball, the following `import` line
404'd).

## 3. Write the manifest

- [ ] `name` uses the declared scope; `node scripts/set-scope.mjs` owns it.
- [ ] `version` starts at `0.1.0`. A package earns `1.0.0` once it has a
      real external consumer and a settled public API — starting below
      `1.0` is an honest signal that neither is true yet, not a defect to
      rush past.
- [ ] `files` lists `dist`, `src` (with test files excluded via a `!` entry),
      `README.md`, `LICENSE` — shipping `src` alongside `dist` costs little
      and lets a consumer's tooling (source maps, "go to definition") reach
      real source instead of compiled output.
- [ ] `publishConfig.registry` matches exactly what `package-scope.json.registry`
      declares. The safety gate enforces this structurally — a mismatch fails
      the gate, not just a review.
- [ ] `repository.directory` points at this package.
- [ ] `LICENSE` copied into the package directory — a tarball without one is
      not usefully MIT licensed.
- [ ] **A new `exports` subpath on a package that also declares
      `peerDependenciesMeta`** (Controller, Bouncer, Designer, Publisher today)
      needs a measured row added to `OPTIONAL_PEER_POLICY` in
      `scripts/lib/packed-consumer-readiness.mjs` for every optional peer —
      `npm run check:packed-consumer -- --package <name>` names exactly which
      one is missing, and that table's own header comment says how to measure
      it. **Never** `governance/public-npm-aggregate-canary.json`: that file
      is frozen, immutable measurement of already-published tarballs
      (`docs/DECISIONS.md` entry 26), and its own `optional-peer-manifest`
      rule stops asking anything of a package once its version has moved past
      what a frozen row measured — which every unpublished new subpath has.

## 4. Write the furniture

- [ ] `README.md` — installation, usage, full API table, requirements,
      licence. Verify every claim against the source; a README is not
      evidence. `check-readme-parity.mjs` catches the export-drift and
      wrong-package-name classes of this mechanically, but not a wrong
      return type or a misdescribed behavior — that still needs a human read.
- [ ] `CHANGELOG.md` — fresh, starting at the package's real `0.1.0`, Keep a
      Changelog format.

### Releasing a version bump after the first publish (issue #1255)

A pull request that changes an already-published package's packed content
does not bump that package's `version` itself. Add a
`.changesets/<slug>.md` file instead (format and validation:
`scripts/collect-changesets.mjs`), naming the package's `packages/<dir>`
directory and a `patch`/`minor`/`major` bump level, with the summary that
will become the `CHANGELOG.md` line. `scripts/check-release-readiness.mjs`
accepts a pending changeset as an alternative to a same-PR version bump.

A periodic or on-demand release PR (`node scripts/apply-release-changesets.mjs`,
`.github/workflows/release-pr.yml`) applies every pending changeset: it
bumps each named package once (the highest level any of its changesets
named), writes the `CHANGELOG.md` entry, regenerates `package-lock.json`,
and deletes the changesets it applied. `scripts/check-release-pr-shape.mjs`
is the gate that keeps this the only legitimate way a package's version
moves going forward: a version change with no consumed, matching changeset
and no matching `CHANGELOG.md` entry is refused as "a version change
outside a release PR."

Qualification stays exactly where it was: one retained record per released
version (`governance/release-qualifications/`), never per pull request —
a release PR bumping several packages at once still needs one qualification
per package version it produced, unaffected by how many changesets fed it.

## 5. Verify

```bash
npm run check                              # scope, gate regression, safety, readme, contamination, typecheck, tests
node scripts/preflight-package.mjs packages/<name> --require-denylist
```

`preflight-package.mjs` is the single command that must pass before a publish
is even proposed. It runs, in this order: name collision (the only failure <!-- facts-gate:ignore -->
that can damage something *other* than this package — see below), denylist
quality, gate regression, tree safety, and artifact safety (the actual packed
tarball, not the tree).

The denylist may be selected explicitly with `--denylist <file>`; preflight
forwards that same policy to denylist quality, tree safety, and artifact safety.
This prevents a same-named file for another repository from being selected on
a shared machine. Without the flag, the gates use `PUBLIC_SAFETY_DENYLIST`; with
`--require-denylist`, an unselected or unreadable policy fails closed.

**What `npm run preflight` does *not* run: consumer qualification.** Artifact safety
(`scripts/check-artifact-safety.mjs`) packs the tarball for real and scans its
*contents* — forbidden files, credential-shaped strings, private identity,
structural defects such as a missing `LICENSE` — but it never installs the
tarball or imports a single declared export. The older manual install-and-import
proof remains a separate, genuinely distinct check (`packRoundTrip`, see
[`packages/controller/src/release/pack-round-trip.ts`](../packages/controller/src/release/pack-round-trip.ts)),
and it does not run as part of `preflight-package.mjs` at all.

A local command for that proof now exists (issue #377):
`foundry-governance preflight <lifecycle-file> <package-dir> [root]` (see
`packages/controller`'s own README) runs `preflightGovernedPackage`, which
calls `packRoundTrip` itself. It is a genuinely separate command, though —
running it is a manual, additional step, not something `npm run preflight`
runs for you. **Wiring `packRoundTrip` into `preflight-package.mjs` itself,
so the ordinary preflight sequence above covers it automatically, is still
tracked as separate, future work.** The publish workflow instead runs the
package-neutral fixed candidate-qualification runner described below. That
automatic gate covers the exact declared export/bin/adversarial surface without
claiming that it invoked Controller's package-owned `packRoundTrip` helper.

- [ ] Safety gate reports **FULL** mode and `PASS`. A `PASS (partial)` is not
      a clearance — it means identity checks never ran.
- [ ] `npm pack --dry-run` (or the artifact-safety gate, which packs for
      real) contents are exactly what you intended. This is the last look at
      the thing that actually ships.
- [ ] For every package with a first-party runtime dependency, its
      already-published runtime siblings have passed an explicit
      private-registry round trip against the exact tarball selected for
      publication. Do not replace this with a local tarball dependency or a
      workspace link; either would hide the graph closure being proven.

## 6. Publish

### Exact-candidate qualification

Before a future upload, Publish requires a namespace-qualified current record
under `governance/release-qualifications/clossys-<package>-<version>.json` to validate as
**pre-publication** evidence for the exact package version, policy-owned
package tree, root resolution, adapter and fixture joins, and SHA-1/SHA-256/
SHA-512 tarball bytes. Publish packs once, scans that exact file, runs the root
fixed-operation runner against it, and compares the fresh canonical transcript
to the retained record before dry-run or upload. It never executes stored
record commands. Producer policy, rather than a record, owns unsupported
archetypes and dimensions; the runner proves the required install surface,
native `0`/`1`/`2` outcomes, matched control, and restoration evidence.
New qualifications retain transcript v3. Runtime exports named by the packed
manifest's closed `foundryReleaseVerification.next` rows are excluded from raw
Node imports and instead resolved in their declared client, server, or proxy
context by one real isolated Next build. The transcript records one framework
observation per export, counts the framework exports and the single shared
build separately, and rejects stale, duplicate, undeclared, or empty context
rows. A packed `react-server` export condition remains a separate audited
runtime branch: v3 records an ordinary import and an explicit
`node --conditions=react-server` import with condition-bearing identities, and
counts the latter as a closed subset of runtime imports. Retained v1 and v2
transcripts remain immutable and valid under their original closed schemas.

An already-public trusted release whose qualification was immutable before the
protected publish source changed may use the separate closed **v3 replay**
record only when both root `package.json` and `package-lock.json` hashes
drifted and every package-owned join still matches exactly. It is not a waiver
for a changed package, policy, adapter, fixture, archetype, dimension, manifest,
or tarball. The record retains qualification roots and publication-source roots
in different fields, proves strict ancestry `qualification introduction < source
< publication record`, and binds successful qualification and publish jobs,
the exact GitHub artifact ID/archive digest, fresh raw and canonical transcript
digests, candidate hashes, and anonymous npm signature/attestation evidence.
An overall workflow conclusion is never substituted for the successful publish
job; a later verification failure remains visible. V1 and v2 cannot opt into
this path and retain their original closed semantics.

A candidate review binds its reviewed commit. Before squash, the PR tail may
change only its versioned record; at publish, content joins and fresh tarball
evidence are squash-safe and do not require `main` to equal the reviewed SHA.
Final provider review remains separate evidence, not workflow authority. The
trusted PR-side qualification workflow is deferred until the protected base
contains this runner, so untrusted PR code never receives publish credentials.

Qualification records are append-only by exact version. Each retained record
must still match the blob from its own single introduction commit. A closed
publication record continues to select the qualifications it originally bound
by their exact retained paths and digests; it does not require the directory to
contain only one version of each package. A later release therefore adds a new
versioned record without rewriting or replacing the first-publication evidence. <!-- facts-gate:ignore -->
The exact predecessor record paths present at the immutable publication-transition
base retain their schema and introduction-time policy joins; their retained,
introduction, and transition-base blobs must agree and they may never be touched
after introduction. Validation therefore does not require a predecessor's
historical reviewed commit to remain reachable.
Its introduction is a direct, single-parent child of the reviewed candidate
commit, and that introduction changes exactly the jointly retained new
qualification records. Their content joins are measured at the reviewed
commit; their retained bytes must remain their introduction blobs, with no
later touch, including a rewrite followed by restoration.

This is release qualification only. It does not claim real consumer adoption,
provider truth, independent grounding, or closure; a provider-specific review
reference is evidence, not workflow authority. Any changed tarball byte fails
the digest join and requires a re-pack and new qualification.

The retained Advisor 0.1.3, Starter 0.1.2, Controller 0.8.20, and Controller
0.8.21 **post-publication bootstrap** records describe immutable
`@vespeneventures` GitHub Packages predecessor releases. Each retains the
actual predecessor registry tuple and package-owned current-direct evidence
while giving unsupported archetypes and lifecycle dimensions explicit
policy-owned dispositions. Their timing is rejected in pre-publication mode;
they do not qualify an `@clossys` release or authorize the old publication
lane.

Its registry-backed replay is retained post-publication evidence only, not a
retroactive gate, adoption, grounding, or release clearance.

### The qualification runtime is pinned exactly, and your machine may not be it

`scripts/lib/release-runtime.mjs` pins the exact runtime that release
qualification must run on: `RELEASE_RUNTIME` is Node `v24.19.0`, npm
`11.17.0`, and zlib `1.3.2.1-motley-3246f1b`. `scripts/run-candidate-
qualification.mjs` asserts all three before it packs anything and refuses
closed, rather than producing a record, on any mismatch.

This is a separate requirement from root `package.json`'s `engines.node:
">=20"`, and the two are not in tension: `engines` states the floor a
*consumer* of a published package needs to run it, while the qualification
pin states the exact toolchain a *producer* must use to generate a record
that proves something. A qualification record binds exact tarball bytes —
`tsc` output and gzip compression both vary with the toolchain that
produced them — so "close enough" would prove the bytes a different
runtime produced, not the bytes actually being qualified. This is also why
the pin must never be relaxed: loosening it to accept whatever runtime
happens to be at hand would turn the record from proof of exact artifact
bytes into a record of some other, unspecified bytes, silently.

**A developer machine that doesn't match this exact tuple cannot produce a
record at all** — `run-candidate-qualification.mjs` fails closed before
packing rather than emitting one on a different toolchain. The normal path
onto the pinned runtime is `.github/workflows/qualify-candidate.yml`,
dispatched by:

```bash
gh workflow run qualify-candidate.yml -f package=<pkg>
```

(pass `-f version=<version>` only to qualify something other than the
checked-out ref's current manifest version). The workflow runs on the pinned
`actions/setup-node` runtime, produces and retains the qualification record,
then pushes a `claude/qualify-<pkg>-<version>` branch carrying it. GitHub
Actions' own token cannot open a pull request against this repository, so the
workflow pushes the branch and stops; a maintainer opens the PR for that
branch by hand.

**Until a retained record exists,** a package version that has already
merged to `main` ahead of one carries an acknowledged, issue-referenced
deferral file at `governance/release-qualification-deferrals/<package>@<version>.json`
(enforced by `scripts/check-qualification-record-required.mjs`). A deferral
acknowledges a merge, never a publication — the version it names may not be
published before its record exists, and the entry itself goes stale (and
fails the gate) the instant a matching record is retained, so it is a
countdown, not a standing exemption.

### Once a version's record is retained, any change to that package needs a new version

This is the ordering rule, stated plainly because it is not obvious from
either gate's own name: **once a version's qualification record is retained,
any further change to that package — packed or not — requires a new
version.** Practically, that means fixing a test *before* generating a
record, never after.

The rule follows from two things that are both true and that neither gate
alone states together. `scripts/check-release-readiness.mjs` compares packed
content only — a test file excluded by `files` moving is invisible to it, by
design (devDependencies and non-shipped files are exactly what that gate is
right to ignore for the bump question it asks). `scripts/check-qualification-
record-present.mjs` compares `candidate.packageTreeSha1` against the whole
package directory, tests included, by equally deliberate design — see that
script's own header for the prior incident (a record whose manifest digest
still matched while its tree digest had silently drifted) that makes
narrowing the tree hash to packed files only unsafe. A record is immutable
once introduced, so a tree that has moved past it can never be reconciled;
the version it was retained for can only be skipped.

This cost a real version. `@clossys/architect@0.1.7` was bumped and had a
retained, matching record. A follow-up pull request then fixed a test so it
stopped mutating the real `dist/cli.js` in place — a test-only edit, correctly
excluded from packed content, so `check-release-readiness.mjs` correctly
reported no bump required. That same edit moved `packages/architect/`'s tree,
and the 0.1.7 record — bound to the tree as it stood before the fix — went
stale the moment the fix landed. 0.1.7 could never be published again; 0.1.8
carries the same fix instead. See issue #920 for the full incident.

`check-release-readiness.mjs` now consults the retained record for a
package's CURRENT version whenever its own packed-content diff would
otherwise report "no bump required," and says so explicitly when the two
disagree — "no bump required for packed content, but the retained record for
`<version>` is now stale; publishing requires a bump" — rather than reporting
the permissive half alone. It does not weaken either gate: a stale record is
still exactly what `check-qualification-record-present.mjs` alone would find
at publish dispatch; this only means a pull request sees the same answer
before merge, not only at the point an approval would otherwise be spent on a
run that cannot succeed.

### The retained record's tarball must reproduce

A qualification record binds exact tarball bytes and can never be rewritten,
so a record bound to bytes no clean build produces makes that version
permanently unpublishable. Two versions were lost that way and had to be
skipped rather than fixed.

Nothing in the tree can detect it. `dist/` is gitignored, so
`packageTreeSha1` — and every other join computed from git — is blind to
exactly the content that dominates a tarball, since `dist` is the first <!-- facts-gate:ignore -->
entry in almost every package's `files` array. The record reads PRESENT and
not-stale against every pull-request check right up to the real publish,
where `validate-candidate-publish.mjs` refuses it correctly and far too
late.

Two ordinary things produce it, neither of them a mistake:

- `tsc` never deletes an output whose source has gone away. Delete or rename
  a source file, rebuild, and its `.js`, `.d.ts` and both `.map` files stay
  in `dist/` forever — and pack.
- An artifact carried across a rebase is a clean build of a *different*
  commit.

`scripts/generate-qualification-record.mjs` therefore proves reproducibility
before it writes anything: it removes every `packages/*/dist`, rebuilds,
re-packs the candidate, and refuses unless the result is byte-identical to
the tarball it was handed. There is no flag to skip it. Because gzip bytes
are a function of the runtime that produced them, this can only be attempted
on the pinned release runtime below; off it, the generator reports
indeterminate rather than a mismatch it cannot attribute.

To ask the same question earlier, while the answer is still free:

```bash
npm run verify:artifact-reproducible -- packages/<name>
```

That is destructive in the same way and for the same reason: it removes every
`packages/*/dist` and rebuilds, because there is no honest way to answer
without doing so.

### Replay runtime invariant

The credential-free `qualify` job and OIDC `publish` job both use the pinned
official `actions/setup-node` runtime: Node `v24.19.0`, bundled npm `11.17.0`,
and zlib `1.3.2.1-motley-3246f1b`. Each job asserts all three exact values before any
npm install, pack, or publish operation. A mismatch fails closed; it may not
reuse an ambient runner runtime or mutate the exact qualified tarball handoff.
This invariant was added after failed workflow run `33329284276` exposed that
replaying a release path requires an explicit runtime tuple.

### Release target selection

[`governance/release-catalog.json`](../governance/release-catalog.json) is the
fail-closed source catalogue. After W1D its active target is `clossys-npmjs`,
and `package-scope.json` binds the same `@clossys` scope and public npm
registry. The active release target closes over all twenty-one publishable
source manifests in a reviewed dependency order: the sealed Advisor, Starter,
Controller prefix remains first; Builder and Inspector follow Controller; and
Publisher follows Controller, Writer, and Designer. It never accepts `all`, a
partial source inventory, reordering, duplication, or replacement of the first <!-- facts-gate:ignore -->
Trio. Catalogue membership is not qualification: to be eligible, a package
must also have a required current-direct adapter with explicit 0/1/2 behavior.
A blocked policy entry remains ineligible even when it appears in the catalogue;
the current policy requires runnable adapters for all twenty-one packages. Each
release also needs a separately
introduced immutable package-neutral publication record. That record joins
qualification path/digest, candidate source/manifest/tarball, the
catalogue bytes from that record's introduction commit plus its continuing
current allowlist membership and anonymous served-byte proof. The legacy v1
form records owner-present publication time/evidence only. The append-only v2
trusted-publisher form additionally binds the exact npm attestation, reviewed
workflow/ref/event/source/run/builder provenance, and the registry-served
bytes. A package may have later records at distinct versions; each record is
uniquely bound to its exact `name@version`. These later records do not alter
the immutable first-publication Trio evidence.

Catalogue closure does not make all twenty-one records producible in parallel:
Publisher's current-direct run remains deferred until its required Writer and
Designer versions are public and verified. A local sibling tarball or
workspace link is diagnostic only and cannot substitute for that
registry-backed dependency proof.
This is a source-state declaration only. During W1D no `@clossys` package was
published or supported for installation. W1E subsequently published and
anonymously verified the owner-present first Trio identities, then published
and verified the current trusted-publisher releases: Advisor 0.1.5, Starter
0.1.4, and Controller 0.8.23. The current releases carry npm provenance and
served-byte parity evidence.

The publish workflow is active only through its reviewed, protected publish
path. Every future release still needs a fresh exact candidate qualification,
FULL safety and artifact checks, immutable review evidence, anonymous
packument/tarball verification, and—when published through trusted
publishing—provenance verification. A version change is source preparation
until those release facts exist.

The catalogue's GitHub Packages target and the workflow behavior associated
with it are retained as immutable predecessor history. They explain how the
`@vespeneventures` records were produced; they are not current commands,
fallbacks, or authority to upload another predecessor version.

When W1E activates the workflow, it must re-run every gate in FULL mode —
including name collision and artifact safety — build, test, pack, and retain
one tarball. The disabled W1D workflow cannot perform these publication steps.
**The required W1E order of operations is:**

1. Pack exactly one tarball (the same bytes get inspected, round-tripped, and
   published — never a second, separate `npm pack`).
2. **The fixed candidate-qualification runner installs that exact tarball into
   a genuinely isolated directory, covers every declared export target, and
   invokes every declared bin plus its fixed adversarial cases — before anything
   is published. Framework-bound runtime exports are covered by the one
   manifest-declared real framework build rather than a context-invalid raw
   Node import.** A failure here stops the job: `npm publish` never
   runs, and nothing reaches the registry. This is the fix for the ordering
   defect issue #191 describes — this check used to run
   only *after* `npm publish`, where a registry version is already immutable
   and a failure (real or a false positive in the checker itself) can only be
   reported, never prevented.
3. A manual dry run exercises npm's own publish command against that exact
   tarball with `--dry-run`; only a later explicitly authorized, owner-present
   W1E run may publish that same path as a first identity. That interactive
   first publication does not claim provenance. A later bounded patch release
   through the proven trusted-publisher path supplies provenance evidence.
   Either way, step 2 must pass first.
4. After a real publish, the workflow re-fetches that exact `name@version`
   from the registry and compares its digest with the uploaded tarball — proof
   that the registry *stored and now serves back* those same bytes, which is
   the one thing step 2 cannot prove no matter how thorough it is (it never
   touches the registry). It does **not** re-run the install-and-import proof
   against those bytes for an ordinary publish: byte identity plus step 2's
   proof against the identical local bytes already cover that; a second
   install-and-import check against bytes already proven identical would be a
   duplicate with no distinct purpose.
5. W1E's `verify_only` path anonymously fetches the exact public npm tarball
   and retains a closed proof of the packument URL, served tarball URL, public
   access, SHA-1/SHA-256/SHA-512/integrity tuple, packed manifest digest, and
   raw tarball size before its runner uses those bytes. It runs the fixed qualification runner
   against the fetched, already-published tarball — it exists specifically to qualify a
   version *already in the registry*, independent of whatever the current
   checkout contains (for example a version published before step 2 existed
   in this workflow, or as a later registry-served consumer qualification).
   The `qualify` job then runs `validate-candidate-publish.mjs` in bootstrap
   mode against the retained qualification record, using current-worktree
   joins while binding the fresh transcript and exact registry tarball bytes.
   There is no
   pre-publish check that could have already covered that case.

When W1E activates the public npm publisher, reads of `@clossys` packages are
expected to be credentialless. Publication trust and credentials remain a
producer concern; a consumer token or private registry mapping must not be
introduced for public-package reads.

### The first public cohort <!-- facts-gate:ignore -->

The first `@clossys` release is one closed pre-publication cohort: `advisor`, <!-- facts-gate:ignore -->
then `starter`, then `controller`. Its namespace-qualified records join an
immutable `clossys-npmjs-trio` cohort record by raw-byte SHA-256, exact public
registry tuple, and each candidate's SHA-1/SHA-256/SHA-512 tarball tuple. A
partial attempt is not silently retried as a cohort: it must be recorded in
the immutable quarantine record with the completed ordered prefix and next
failed member. The retained cohort and qualification records now bind the
exact first Trio identities and their anonymously served bytes. They prove
publication and public access only; they do not prove consumer adoption,
independent grounding, or closure.

The retained Trio records authorize one sealed control-tail correction from
protected base `9760d6b63ce9347aa528b5ba3625b924c792f9a2`. Its immutable authorization
record binds the exact retained cohort and qualification records, the complete
ordered correction path set, and the SHA-256 of every authorized file. The
authorization must be introduced atomically with those exact bytes and cannot
authorize a later rewrite, an unrelated tail path, or any other cohort. This is
a one-time reachability repair for the already-retained records, not a general
exception to immutable qualification evidence. After it lands, only the exact
closed partial-failure quarantine described above may extend that sealed tail.

### Owner-present first publication, then OIDC

The first identity of each Trio member is an owner-present, interactive npm <!-- facts-gate:ignore -->
publication. It is not an npm trusted-publisher run: npm cannot bind a trusted
publisher to a package identity that does not exist yet. The owner signs in to
the public registry, enters npm's 2FA challenge at the terminal, and keeps the
same reviewed tarball for publication and verification. Never put an OTP, npm
token, or registry credential in a command, workflow, issue, or artifact.

Run this handoff once per package, strictly in this order. The owner-present
wrapper accepts the qualified tarball only as immutable input; it extracts that
candidate into private staging, FULL-scans the staged package, re-packs `.`
with lifecycle scripts disabled, and requires SHA-1/SHA-256/SHA-512 equality
before the one interactive upload. The actual upload is always `npm publish .`
from that clean staging directory. Never publish a tarball, URL, package
specifier, OTP, token, or provenance flag directly.

```text
advisor -> node scripts/publish-qualified-directory.mjs --package advisor --candidate <advisor-candidate.tgz> --record <advisor-qualification.json>
           STOP; anonymously verify @clossys/advisor@<version>, served digest, and public access
starter -> node scripts/publish-qualified-directory.mjs --package starter --candidate <starter-candidate.tgz> --record <starter-qualification.json>
           STOP; anonymously verify @clossys/starter@<version>, served digest, and public access
controller -> node scripts/publish-qualified-directory.mjs --package controller --candidate <controller-candidate.tgz> --record <controller-qualification.json>
             STOP; anonymously verify @clossys/controller@<version>, served digest, and public access
```

At each stop, compare the anonymous packument and fetched tarball with the
reviewed candidate's name, version, `dist.integrity`, SHA-1/SHA-256/SHA-512,
packed manifest, and raw size. A failed publish or verification stops the
handoff before the next member. Quarantine the completed ordered prefix,
record every immutable published identity and disposition, invalidate the
unpublished candidates, and never delete, overwrite, or reuse a published
version. A correction is a new forward version that re-enters qualification
with the whole cohort from one exact source head.

Only after all three first identities passed those stops was npm trusted
publishing configured for each package. The protected `npm-publish` path then
published the bounded current releases with npm provenance and served-byte
parity. The workflow uses Node `>=22.14` and npm `>=11.5.1`, grants
`id-token: write` only to the upload job, runs in the protected environment,
and has no npm or GitHub publish token environment.

Provider state was value-free verified for each current Trio package:
Publishing access is **Require two-factor authentication and disallow tokens**.
That setting removes the alternate granular bypass-2FA token path after the
trusted replacement has proved it works.

### Automating this handoff: one owner action for the whole backlog (issue #1227)

`publish.yml` publishes one package per manual dispatch, and every package
below still needs an owner-present, interactive first publication (npm cannot
bind a trusted publisher to a package identity that does not exist yet — see
"Owner-present first publication, then OIDC" above). With a growing
qualification backlog (issue #948), running the handoff below by hand, once
per row, does not scale. `npm run publish:plan` and
`npm run publish:qualified-set` automate it without weakening any gate:

```text
npm run publish:plan
```

lists every non-private package, whether it would publish, and why the rest
would not — "on npm already", "route publish workflow", and "qualification
record missing/stale" are kept as distinct reasons, never collapsed into one
generic "not eligible". It reads only; it packs nothing and publishes
nothing. The table two rows above is a point-in-time snapshot and drifts as
versions bump — `npm run publish:plan` derives the same question live, from
the current tree and the current registry state, every time it runs.

**The laptop path is for a package's first publish only.** `npm run
publish:qualified-set -- --publish` never uploads a package whose npm
identity already exists on the registry, even at a different version — npm
cannot bind a trusted publisher to an identity that does not exist yet, so an
owner-present local `npm publish` is the only way to create that FIRST <!-- facts-gate:ignore -->
identity, and the only case it may legitimately handle. Every later version <!-- facts-gate:ignore -->
of an already-published package is reported with status
`route-publish-workflow` and the exact dispatch to run instead:

```text
gh workflow run publish.yml --ref main -f package=<pkg> -f dry_run=false -f verify_only=false
```

That is `publish.yml`'s protected `npm-publish` OIDC lane — the same
required-reviewer environment approval every other update already goes
through — and it is the only path that can attach npm provenance to a <!-- facts-gate:ignore -->
version. Only a package's very first identity, before any trusted publisher
exists for it, takes the local `--publish` path below.

```text
npm run publish:qualified-set -- --publish
```

runs the owner-present publish loop: for every eligible package (a genuinely
first-ever identity, never an update to an already-existing one), in
dependency order, it runs the exact sequence below — `preflight-package.mjs`,
a clean `dist/` rebuild (delete then rebuild, so a leftover `dist/`'s stale
file modes from an earlier `npm ci` bin-link can never survive into the
packed tarball — issue #1286), a fresh `npm pack`, a fresh
`run-candidate-qualification.mjs` transcript, `validate-candidate-publish.mjs
--mode prepublish`, then `publish-qualified-directory.mjs --mode
owner-present` — the same gates `publish.yml`'s own `qualify` and `publish`
jobs run for an OIDC upload, with an owner-present interactive `npm publish .`
(one npm authentication/2FA prompt per package) in place of the OIDC upload
only a package that already has a first identity can use. A failure in one
package (preflight, the clean rebuild, packing, fresh qualification,
prepublish validation, or the publish itself) stops only that package; every
other eligible package is still attempted, and the final summary names every
outcome. It requires `PUBLIC_SAFETY_DENYLIST` (or `--denylist <path>`) and
the exact pinned release runtime (Node `v24.19.0`, npm `11.17.0`) — see
`scripts/lib/release-runtime.mjs` — and refuses to run without either. See
`scripts/publish-qualified-set.mjs`'s own header for the full gate-by-gate
mapping and for why this is an owner-present loop rather than a
`workflow_dispatch` fan-out.

Neither command replaces the per-row stop-and-verify discipline below: after
each publish, still anonymously verify the exact published identity before
moving on. Neither runs `record-later-publication.mjs` — see
`scripts/publish-qualified-set.mjs`'s header for why that stays a separate,
optional, hand-run step.

### Hands-free publishing after the first identity (issue #1256)

Two things this repository already had, now connected automatically:

- **Auto-qualify.** `.github/workflows/auto-qualify.yml` runs on every push
  to `main`. It runs `node scripts/select-unqualified-packages.mjs` (a thin
  filter over `npm run publish:plan`'s own report, kept to genuinely
  *missing* records — never a stale one, which needs a new version instead,
  never a re-dispatch of the same one) and dispatches
  `qualify-candidate.yml` once per package it finds. That workflow already
  produced and retained records, and already pushed a branch and opened a
  pull request itself once this repository's "Actions may create pull
  requests" setting was on (see the owner decision linked at the top of
  this document) — nothing about the qualification path itself changed.
- **Trusted publishing.** `publish.yml`'s `publish` job already runs
  `scripts/publish-qualified-directory.mjs --mode oidc`, already carries
  `id-token: write` and the `npm-publish` environment gate, and already
  runs on the pinned release runtime — see "Owner-present first
  publication, then OIDC" above for the full path and the `npm >=11.5.1`
  requirement it already states (the pinned release runtime, npm
  `11.17.0`, is well above that floor). There is no separate OIDC lane to
  add here.

**What is still an owner action, once per package**, exactly as already
documented above and unchanged by either workflow: the first identity is
still an owner-present publication (`npm run publish:qualified-set -- --publish`,
or the per-row handoff above), because npm cannot bind a trusted publisher
to a package identity that does not exist yet. Only after that first
publish can the owner connect that package's npm trusted publisher (GitHub
Actions, this repository, `publish.yml`, the `npm-publish` environment) on
npmjs.com — the same one-time step "Owner-present first publication, then
OIDC" already describes for the Trio, now applying to every package as its
own first identity publishes.

### Current retained-candidate first-publication handoff

The Trio section above is closed historical evidence. It neither publishes nor
authorizes a first identity for another package. The following are the current
retained candidates, not registry facts: each still needs its own
owner-present first publication and anonymous public-registry verification.

| order | retained candidate | exact qualification record |
| --- | --- | --- |
| 1 | `@clossys/writer@0.3.2` | `governance/release-qualifications/clossys-writer-0.3.2.json` |
| 2 | `@clossys/designer@0.2.4` | `governance/release-qualifications/clossys-designer-0.2.4.json` |
| 3 | `@clossys/architect@0.1.2` | `governance/release-qualifications/clossys-architect-0.1.2.json` |
| 4 | `@clossys/bouncer@0.1.1` | `governance/release-qualifications/clossys-bouncer-0.1.1.json` |
| 5 | `@clossys/butler@0.1.1` | `governance/release-qualifications/clossys-butler-0.1.1.json` |
| 6 | `@clossys/giver@0.1.2` | `governance/release-qualifications/clossys-giver-0.1.2.json` |
| 7 | `@clossys/influencer@0.1.2` | `governance/release-qualifications/clossys-influencer-0.1.2.json` |
| 8 | `@clossys/integrator@0.6.2` | `governance/release-qualifications/clossys-integrator-0.6.2.json` |
| 9 | `@clossys/keeper@0.1.2` | `governance/release-qualifications/clossys-keeper-0.1.2.json` |
| 10 | `@clossys/locksmith@0.1.6` | `governance/release-qualifications/clossys-locksmith-0.1.6.json` |
| 11 | `@clossys/messenger@0.1.2` | `governance/release-qualifications/clossys-messenger-0.1.2.json` |
| 12 | `@clossys/observer@0.2.3` | `governance/release-qualifications/clossys-observer-0.2.3.json` |
| 13 | `@clossys/builder@0.7.3` | `governance/release-qualifications/clossys-builder-0.7.3.json` |
| 14 | `@clossys/inspector@0.1.18` | `governance/release-qualifications/clossys-inspector-0.1.18.json` |

The ordering preserves the runtime graph: Builder and Inspector wait for the
already-public Controller, and Publisher remains outside this list until
Writer and Designer are public and verified. Before every row, re-run the
required FULL preflight and exact-candidate validation; a retained record does
not excuse a changed byte, a stale review, or a failed gate.

Each first identity is an interactive owner action and requires the owner's
npm authentication and 2FA response. From the repository root, pass only the
retained candidate tarball named by the matching record to the existing
qualified-directory wrapper:

```text
writer     -> node scripts/publish-qualified-directory.mjs --package writer --candidate <writer-0.3.2-qualified-candidate.tgz> --record governance/release-qualifications/clossys-writer-0.3.2.json
designer   -> node scripts/publish-qualified-directory.mjs --package designer --candidate <designer-0.2.4-qualified-candidate.tgz> --record governance/release-qualifications/clossys-designer-0.2.4.json
architect  -> node scripts/publish-qualified-directory.mjs --package architect --candidate <architect-0.1.2-qualified-candidate.tgz> --record governance/release-qualifications/clossys-architect-0.1.2.json
bouncer    -> node scripts/publish-qualified-directory.mjs --package bouncer --candidate <bouncer-0.1.1-qualified-candidate.tgz> --record governance/release-qualifications/clossys-bouncer-0.1.1.json
butler     -> node scripts/publish-qualified-directory.mjs --package butler --candidate <butler-0.1.1-qualified-candidate.tgz> --record governance/release-qualifications/clossys-butler-0.1.1.json
giver      -> node scripts/publish-qualified-directory.mjs --package giver --candidate <giver-0.1.2-qualified-candidate.tgz> --record governance/release-qualifications/clossys-giver-0.1.2.json
influencer -> node scripts/publish-qualified-directory.mjs --package influencer --candidate <influencer-0.1.2-qualified-candidate.tgz> --record governance/release-qualifications/clossys-influencer-0.1.2.json
integrator -> node scripts/publish-qualified-directory.mjs --package integrator --candidate <integrator-0.6.2-qualified-candidate.tgz> --record governance/release-qualifications/clossys-integrator-0.6.2.json
keeper     -> node scripts/publish-qualified-directory.mjs --package keeper --candidate <keeper-0.1.2-qualified-candidate.tgz> --record governance/release-qualifications/clossys-keeper-0.1.2.json
locksmith  -> node scripts/publish-qualified-directory.mjs --package locksmith --candidate <locksmith-0.1.6-qualified-candidate.tgz> --record governance/release-qualifications/clossys-locksmith-0.1.6.json
messenger  -> node scripts/publish-qualified-directory.mjs --package messenger --candidate <messenger-0.1.2-qualified-candidate.tgz> --record governance/release-qualifications/clossys-messenger-0.1.2.json
observer   -> node scripts/publish-qualified-directory.mjs --package observer --candidate <observer-0.2.3-qualified-candidate.tgz> --record governance/release-qualifications/clossys-observer-0.2.3.json
builder    -> node scripts/publish-qualified-directory.mjs --package builder --candidate <builder-0.7.3-qualified-candidate.tgz> --record governance/release-qualifications/clossys-builder-0.7.3.json
inspector  -> node scripts/publish-qualified-directory.mjs --package inspector --candidate <inspector-0.1.18-qualified-candidate.tgz> --record governance/release-qualifications/clossys-inspector-0.1.18.json
```

The wrapper makes a private staging directory, FULL-scans its unpacked
contents, re-packs it with lifecycle scripts disabled, and requires the
SHA-1/SHA-256/SHA-512 tuple to match before it runs the one interactive
`npm publish .` command. Do not replace it with a tarball, URL, package
specifier, token, OTP, or a workflow upload flag.

Before each wrapper invocation, run the mandatory preflight sequence against
the exact candidate, produce a fresh credentialless transcript, and retain
both outputs:

```text
node scripts/preflight-package.mjs packages/<name> --require-denylist
node scripts/run-candidate-qualification.mjs --package <name> --tarball <candidate.tgz> --output <fresh-transcript.json>
node scripts/validate-candidate-publish.mjs --package <name> --tarball <candidate.tgz> --transcript <fresh-transcript.json> --mode prepublish
```

The transcript passed to `validate-candidate-publish.mjs` must be this fresh
file from the immediately preceding credentialless run; the embedded
transcript in a retained qualification record is not a substitute.

After the owner upload completes, perform the anonymous served-byte
verification described below and save its exact `registry-proof.json` outside
the repository. Then create the one retained publication record with the
credentialless recorder. A trusted-publisher publication uses the closed v2
record; an owner-present publication uses the same recorder and the legacy
owner evidence shape accepted by the validator:

```text
node scripts/record-later-publication.mjs \
  --package <name> \
  --qualification governance/release-qualifications/clossys-<name>-<version>.json \
  --candidate <candidate.tgz> \
  --proof <registry-proof.json> \
  --publication <publication-evidence.json>
```

The v3 replay path additionally requires both regular, non-symlink inputs;
supplying only one fails, while omitting both continues to select the ordinary
v1/v2 path:

```text
  --artifact-archive <qualified-candidate.zip> \
  --replay-evidence <run-and-artifact-id.json>
```

The archive is the source of the fresh transcript and candidate tarball — a
separate locally generated transcript is not accepted. The anonymous registry
proof remains a separate `--proof` input or is fetched by the recorder's
ordinary `--fetch` path, and must exactly join those candidate bytes. The
recorder computes the archive digest, validates its exact contents against the
qualification and served artifact, credential-freely re-reads the named GitHub
run/jobs/artifact metadata, and performs its own isolated public npm install
plus `npm audit signatures --include-attestations` verification against the
exact source and served artifact before retaining the closed identities and
SHA-256 digests.

`publication-evidence.json` is a closed object. For trusted publication it
must contain `mode: "trusted-publisher"`, the canonical publication time and
run reference, plus the exact workflow provenance; for an owner-present first
publication it contains `mode: "owner-present"`, the canonical publication
time, and an HTTPS reference without provenance. Use `--fetch` in place of
`--candidate` and `--proof` when the recorder should obtain both artifacts
anonymously from public npm. The recorder writes only
`governance/release-publications/later/<name>-<version>.json`, refuses an
existing path (including a symlink), and self-validates the retained bytes.
Run `npm run check:later-publications` after creation and review that one-file
change before proceeding to the next package. Never put credentials in either
evidence file.

**Stop after every row.** Anonymously fetch the exact public
`@clossys/<package>@<version>` packument and tarball, then compare its name,
version, public access, `dist.integrity`, SHA-1/SHA-256/SHA-512, packed
manifest, and raw size with the reviewed candidate. Do not start the next row
until that evidence is retained. These fourteen rows are independent
per-package transitions, not a shared quarantine: a completed and verified
row remains that package's individual immutable record, and an untouched
candidate remains qualified unless its bytes, source, or retained evidence
change.

If an upload or its verification fails or is uncertain, stop. Query the
anonymous registry for that exact name and version before any retry. If it is
absent, create no publication record and require renewed owner authorization
before retrying. If that exact version is visibly served, retain its individual
publication record only after the required anonymous served-byte verification;
the already verified prefix remains valid as individual records. A published
version is never deleted, unpublished, overwritten, or reused; a defect moves
forward through a newly qualified version.

Only after a package's first identity and anonymous served-byte verification
are complete may its owner configure that package's npm trusted publisher and
the restrictive **Require two-factor authentication and disallow tokens**
setting. A later bounded patch through the protected `npm-publish` OIDC path
should not need npm terminal 2FA once that trust is configured, but it can
still pause for the required GitHub protected-environment reviewer. Neither
the retained publication record nor the source successor establishes that
provider configuration; its current state is recorded below.

`@clossys/publisher@0.1.9` is quarantined and unpublished. Its immutable
qualification record remains retained for audit, but its candidate tarball was
packed outside the required release runtime, so the retained bytes cannot be
rewritten under the append-only qualification contract. No registry upload was
performed. The Publisher source has therefore advanced to `0.1.10` as the new
first-publication candidate. Writer and Designer passed anonymous served-byte
verification, Publisher 0.1.10 was packed and replayed with the pinned release
runtime, and its owner-present upload now has both an immutable qualification
record and an anonymous served-byte publication record. Publisher's npm
trusted publisher is now configured for `clossys/foundry` through
`publish.yml` and its `npm-publish` environment, with only `npm publish`
allowed; npm's restrictive **Require two-factor authentication and disallow
tokens** setting is checked. That configuration establishes publisher trust
only: it does not qualify, publish, or registry-verify `0.1.11`. The source has
advanced to that later protected OIDC successor, and it now has its own
immutable qualification record but no publication record. Do not prepare a
0.1.11 trusted-publisher/OIDC upload until its fresh exact-head candidate has
passed the required qualification and FULL release checks. After upload,
require anonymous registry and provenance verification before treating 0.1.11
as published.

### Why the name-collision check runs first, always

Public npm scope ownership and existing package names must be checked before
W1E performs any first publication. The collision gate therefore remains
mandatory even though W1D cannot upload. Its GitHub Packages owner-account
checks are retained only for immutable predecessor evidence; W1E must prove
the corresponding public npm namespace facts for `@clossys` before enabling
the new lane.

### Installing after the first W1E cohort <!-- facts-gate:ignore -->

The current Trio identities are supported through ordinary credential-free
public npm resolution: Advisor 0.1.5, Starter 0.1.4, and Controller 0.8.23.
Their registry-served identities, digests, anonymous public access, and npm
trusted-publisher provenance have been verified. The owner-present first
releases remain immutable historical evidence, not current installation pins.

No npm token belongs in a consumer `.npmrc` for a public package. Public npm
resolution is credential-free; publication trust remains producer-only.

### Public access and parity

Every W1D manifest declares `publishConfig.access: "public"`, and the release
catalogue binds that access to the one active npmjs target. This is source
policy, not registry evidence. W1E must still verify the served packument and
tarball for each first publication: exact name and version, public anonymous
access, and digest parity with the reviewed candidate. A missing package is
the expected W1D state, never a passing parity result.

The GitHub Packages visibility machinery remains only as historical evidence
for the immutable old namespace. It is not an npmjs visibility control and is
not activated for the recut source state.

### Historical compatibility-package retirements

The old `catalog`, `gates`, `release`, `repository`, `review`, `governance`,
and `policy` names are retired historical identities, not current wrappers or
installable migration paths. Their authoritative disposition is the
`retired` status in `docs/contracts/package-lifecycle.json`; its nineteen
`published` entries describe source lifecycle targets, not proof that an
`@clossys` artifact is already registry-served. There are no current
`deprecated` lifecycle entries and
`docs/contracts/package-retention.json` is intentionally empty. Do not
republish, copy, reuse, or select a retired name for a new integration.

The manual **Deprecate legacy packages** workflow targets retired NAMES, and
its derived plan is currently empty: no lifecycle entry is in the `deprecated`
state. Its header formerly described GitHub Packages rejecting `npm deprecate`
metadata writes — that predates the npmjs.org cutover recorded in
`package-scope.json`, and both the header and the workflow's authentication
have been corrected. The lifecycle records and their historical
decision/migration references preserve the prior recuts without asserting that
the retired artifacts remain live.

### Deprecating one live version

A package that is still current, with one broken version among good ones, is
not a retirement, and the lifecycle contract cannot express it — there is no
replacement NAME to point at, only a different version of the same package. The
manual **Deprecate registry version** workflow
(`.github/workflows/deprecate-registry-version.yml`) covers that case. It
resolves the version spec through npm itself, refuses a spec that matches no
version, applies the notice, and then re-reads the packument anonymously to
confirm the exact version carries it.

Two properties matter to anyone reviewing a dispatch:

* **It is reversible.** `npm deprecate <pkg>@<ver> ""` clears the notice, and
  dispatching with an empty message applies that by the same verified path. The
  blast radius of a mistake is "a wrong notice was public for a while", not the
  permanence that governs publication — which is why this workflow can be
  exercised for real rather than only reasoned about. The notice is still
  public the moment it lands, and clearing it later does not un-print it for
  anyone who installed in between.
* **Apply mode has no proven credential; dry-run is the supported path.** npm
  documents OIDC authentication as supporting `npm publish` and `npm stage
  publish` only; in the npm CLI the OIDC exchange (`lib/utils/oidc.js`) is
  required from `lib/commands/publish.js` alone, and `npm deprecate`
  authenticates against an existing token instead — so trusted publishing
  cannot authorize this mutation. The obvious substitute, a stored granular
  token, is **not known to work here**, and this repository's own recorded
  provider state argues that it does not: section 6 (*Owner-present first
  publication, then OIDC*) verified Publishing access as *Require two-factor
  authentication and disallow tokens*, which removes the
  granular bypass-2FA token path. Apply mode therefore fails closed by name,
  and that is the intended state rather than a gap awaiting a secret. Dry-run
  needs no credential at all and exercises everything up to the mutation,
  including the refusal on a no-match. Treat "can any credential deprecate a
  current `@clossys` version?" as an open question recorded in the
  prerequisites table, not as a setup step to work through.

A preflight exists because `npm deprecate` exits 0 when its spec matches
nothing. A typo would otherwise be indistinguishable from a successful
deprecation while the broken version stayed installable with no warning.

## 7. W1D source recut and immutable predecessor history

**Status: W1D source recut.** The complete source catalogue now uses the
`@clossys` scope and public npm registry declaration. Package manifests,
first-party dependency names, the lockfile, imports, documentation, catalogue,
and inactive workflow preparation move together. This state deliberately does
not publish a package and does not create a supported install path.

Earlier decisions and release records describe `@vespeneventures` packages on
GitHub Packages. Those names, versions, registry tuples, and authenticated
consumer instructions are immutable predecessor history. Do not unpublish,
delete, copy, reuse, or advance them as part of W1D or W1E. Historical text may
explain an evidence join, but it is never a current fallback command.

[`package-scope.json`](../package-scope.json) remains the single declaration of
the source scope and registry, and the registry-drift checks keep every current
manifest aligned with it. `governance/release-catalog.json` separately limits
which package keys a future target may select. Neither declaration is registry
evidence or permission to upload.

## 8. W1E publication and installation boundary

W1E, not W1D, owns the first `@clossys` public npm publications. The <!-- facts-gate:ignore -->
owner-present first identities and the provenance-bearing current Trio releases
are public and anonymously verified. Every current Trio package's
token-disallow setting is also value-free verified. For each selected package,
W1E requires:

1. run FULL public-safety and package preflight against the exact candidate;
2. retain exact candidate qualification, review, and tarball digest joins;
3. publish in dependency order without changing the reviewed bytes;
4. verify the public registry serves the exact name, version, and digest; and
5. prove an anonymous clean install and the package-owned export or CLI smoke
   test from the registry-served artifact.

The initial publication order is the Advisor, Starter, and Controller trio in
its fixed owner-present sequence. A later package may publish only after every
first-party runtime dependency it needs is already published and verified in
the `@clossys` namespace. The runtime graph, not workspace order, governs the
rest of the catalogue.

Public npm reads are credentialless. Consumers will own their exact version
pin, lockfile, and public-export or CLI evidence, but they must not add an npm
token or private-registry mapping for `@clossys`. Publication credentials and
provider trust remain producer-only W1E concerns. See [ADOPTION.md](ADOPTION.md)
for the capability and wiring ledger.

## Prerequisites held outside this repository

| Thing | Where | Notes |
| --- | --- | --- |
| Denylist | `~/.config/public-safety/denylist-foundry.json` locally; `PUBLIC_SAFETY_DENYLIST_B64` repository secret in CI | Never committed here — it names exactly what must not be public. Specific to this repository — never reuse a denylist file written for a different project. |
| W1E publish trust | Outside the W1D tree | Trusted publishing and the protected `npm-publish` path have proved the current Trio releases. Value-free provider evidence confirms each package-level token-disallow setting. No publish token or value is recorded here. |
| Registry deprecation credential | **None exists, and none should be created yet** — see *Deprecating one live version* in section 6 | Read ONLY by the two manual deprecation workflows, which fail closed by name in its absence. That is the current and intended state, not a gap awaiting a secret. npm's OIDC trusted-publishing exchange authorizes `npm publish` and `npm stage publish` only and cannot authorize `npm deprecate`, so those workflows have no credential-free path and publish.yml's posture is unchanged. The distinction is load-bearing, not pedantic: a repository secret resolves in every workflow and job here, so any job that simply omits `environment:` can read it with no reviewer approval — this repository already depends on that behaviour for `PUBLIC_SAFETY_DENYLIST_B64`, which `ci.yml` reads on `pull_request` with no environment declared. Stored as a repository secret, a same-repo PR branch could read this token and defeat the very `npm-publish` reviewer gate the deprecation workflows rely on. Only an environment secret is bound by that environment's protection rules. Whether any token can deprecate these packages is UNVERIFIED and contradicted by this repository's own evidence: section 6 (*Owner-present first publication, then OIDC*) records Publishing access as **Require two-factor authentication and disallow tokens**, and states that the setting "removes the alternate granular bypass-2FA token path" — the exact path such a token would use. A direct `npm deprecate` against a current `@clossys` version returned `E404` on the `PUT`, which is what npm returns for an unauthorized metadata write as well as for a package that is not there, so it neither confirms nor refutes the mechanism. Do not create the credential to find out. A granular token with scope write access is a standing, publish-capable credential; minting one to test a path the provider setting says is closed trades a real and permanent capability for an experiment. Dry-run needs no credential, is not given one, and exercises everything up to the mutation. No token value is recorded here. |
| Public npm consumer read | None | Current `@clossys` reads are anonymous. A consumer token or private-registry mapping is neither required nor supported. |
| Predecessor GitHub Packages credentials | Historical consumer environments only | They explain immutable `@vespeneventures` evidence and must not be copied into current `@clossys` instructions or used as a fallback lane. |
