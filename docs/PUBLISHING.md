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

## 4. Write the furniture

- [ ] `README.md` — installation, usage, full API table, requirements,
      licence. Verify every claim against the source; a README is not
      evidence. `check-readme-parity.mjs` catches the export-drift and
      wrong-package-name classes of this mechanically, but not a wrong
      return type or a misdescribed behavior — that still needs a human read.
- [ ] `CHANGELOG.md` — fresh, starting at the package's real `0.1.0`, Keep a
      Changelog format.

## 5. Verify

```bash
npm run check                              # scope, gate regression, safety, readme, contamination, typecheck, tests
node scripts/preflight-package.mjs packages/<name> --require-denylist
```

`preflight-package.mjs` is the single command that must pass before a publish
is even proposed. It runs, in this order: name collision (the only failure
that can damage something *other* than this package — see below), denylist
quality, gate regression, tree safety, and artifact safety (the actual packed
tarball, not the tree).

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
versioned record without rewriting or replacing the first-publication evidence.
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
registry. The source tree contains nineteen packages, but the active release
target retains `advisor`, `starter`, and `controller` as a sealed ordered
prefix, then carries the reviewed append-only allowlist for Strategist, Writer,
and Designer. It never accepts `all`, reordering, duplication, or replacement
of the first Trio. A later package needs both its reviewed catalogue entry and
a separately introduced immutable package-neutral publication record. That
record joins qualification path/digest, candidate source/manifest/tarball, the
catalogue bytes from that record's introduction commit plus its continuing
current allowlist membership, anonymous served-byte proof, and owner-present
publication time/evidence reference. This v1 record does not claim trusted
publisher provenance.
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
   is published.** A failure here stops the job: `npm publish` never
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
   There is no
   pre-publish check that could have already covered that case.

When W1E activates the public npm publisher, reads of `@clossys` packages are
expected to be credentialless. Publication trust and credentials remain a
producer concern; a consumer token or private registry mapping must not be
introduced for public-package reads.

### The first public cohort

The first `@clossys` release is one closed pre-publication cohort: `advisor`,
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

The first identity of each Trio member is an owner-present, interactive npm
publication. It is not an npm trusted-publisher run: npm cannot bind a trusted
publisher to a package identity that does not exist yet. The owner signs in to
the public registry, enters npm's 2FA challenge at the terminal, and keeps the
same reviewed tarball for publication and verification. Never put an OTP, npm
token, or registry credential in a command, workflow, issue, or artifact.

Run this handoff once per package, strictly in this order:

```text
advisor -> npm publish <advisor-tarball> --access public --registry=https://registry.npmjs.org
           STOP; anonymously verify @clossys/advisor@<version>, served digest, and public access
starter -> npm publish <starter-tarball> --access public --registry=https://registry.npmjs.org
           STOP; anonymously verify @clossys/starter@<version>, served digest, and public access
controller -> npm publish <controller-tarball> --access public --registry=https://registry.npmjs.org
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

### Why the name-collision check runs first, always

Public npm scope ownership and existing package names must be checked before
W1E performs any first publication. The collision gate therefore remains
mandatory even though W1D cannot upload. Its GitHub Packages owner-account
checks are retained only for immutable predecessor evidence; W1E must prove
the corresponding public npm namespace facts for `@clossys` before enabling
the new lane.

### Installing after the first W1E cohort

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

The manual **Deprecate legacy packages** workflow remains a historical
read-only capability check. GitHub Packages currently rejects `npm deprecate`
metadata writes, and no retired name is a candidate for that mutation. The
lifecycle records and their historical decision/migration references preserve
the prior recuts without asserting that the retired artifacts remain live.

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

W1E, not W1D, owns the first `@clossys` public npm publications. The
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
| Public npm consumer read | None | Current `@clossys` reads are anonymous. A consumer token or private-registry mapping is neither required nor supported. |
| Predecessor GitHub Packages credentials | Historical consumer environments only | They explain immutable `@vespeneventures` evidence and must not be copied into current `@clossys` instructions or used as a fallback lane. |
