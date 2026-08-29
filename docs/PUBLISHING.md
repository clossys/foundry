# Publishing a package

This is a checklist rather than prose because the failure mode — publishing
something that should have stayed private — is not reversible. Anything
pushed to a public remote should be assumed cached and indexed even if
deleted minutes later.

One package, `@vespeneventures/contract`, was published from this
repository and has since been removed from the codebase and current registry
(see [docs/DECISIONS.md](DECISIONS.md) for why). Its historical name must not
be reused for a different package, even though the deleted package now returns
`404`. Everything below is the general process for adding and
publishing a new package here, not a complete registry inventory.

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

For a dependent package, the final proof is an isolated install of the exact
tarball that was scanned and selected for publication, after its sibling
runtime packages are present in the configured registry.
`@vespeneventures/controller`'s own `./release` subpath supports that proof
with `packRoundTrip`'s explicit `tarballPath` and `registry` options. The
registry token is supplied by the caller for child npm processes only; it is
never inherited from ambient configuration or retained in a kept debug
directory. The default round trip intentionally remains an unauthenticated
public-registry proof.

`@vespeneventures/controller` is also a consumer-facing CLI (as
`@vespeneventures/governance` was before issue #282). Before publishing it,
verify an isolated
private-registry installation can import its public API and run
`foundry-governance` against a valid lifecycle document. It is read-only:
package preflight is used only by the producer that intends to publish;
ordinary consuming workspaces run its lifecycle check without any registry
write.

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

Before a future upload, Publish requires
`governance/release-qualifications/<package>-<version>.json` to validate as
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

This is release qualification only. It does not claim real consumer adoption,
provider truth, independent grounding, or closure; a provider-specific review
reference is evidence, not workflow authority. Any changed tarball byte fails
the digest join and requires a re-pack and new qualification.

Advisor 0.1.3, Starter 0.1.2, and Controller 0.8.20 have deliberately limited
**post-publication bootstrap** records. Each retains the actual registry tuple
and package-owned current-direct evidence while giving unsupported archetypes
and lifecycle dimensions explicit policy-owned dispositions. Their timing is
rejected in pre-publication mode; they do not retroactively say that any of
these releases was gated before publication.

Its registry-backed replay is retained post-publication evidence only, not a
retroactive gate, adoption, grounding, or release clearance.

### Release target selection

[`governance/release-catalog.json`](../governance/release-catalog.json) is a
fail-closed allowlist for the publish target. Its default target is the
existing `@vespeneventures` GitHub Packages lane and therefore preserves the
current automatic release behavior. It is not a second source of truth for
the current scope or registry: those remain in `package-scope.json`.

The catalogue also records one **planned** `clossys-npmjs-precutover` target,
limited to `advisor`, `starter`, and `controller`. Recording that target does
not change the scope, registry, package names, versions, workflow defaults, or
publish anything. A later, separately reviewed cutover must explicitly select
that target and make `package-scope.json` match its scope and registry. Until
then, selection fails rather than treating a scope switch as permission to
publish the entire workspace. Manual dispatch, visibility reporting, and
automatic discovery all use the same control.

For an **existing package name**, merging a new `package.json` version to
`main` publishes that version automatically. Push discovery selects a version
that is absent from the registry and serializes releases through the
workflow's `publish` concurrency group. Source-only changes do not publish:
release them only with a version change.

A **new package name is never selected by push discovery**. Its first
publication requires an explicit Actions → **Publish** `workflow_dispatch`,
with the package directory under `packages/`. The dispatch is single-package
and the workflow is serialized: dispatch one package, wait for the run to
finish, then dispatch the next. GitHub keeps only one pending run in the
`publish` concurrency group; dispatching several in quick succession can evict
a pending run as `cancelled` (see issue #416).

For a first publication, run the dispatch twice, in order:

1. Set `dry_run: true`, leave `visibility_only: false` and `verify_only:
   false`, and inspect the successful run. This proves the gates, packed
   tarball, fixed candidate-qualification runner, and npm's publish path with
   `--dry-run`; it does **not** upload a version, prove that the registry now
   serves the tarball, or establish package visibility.
2. After the dry run succeeds, dispatch the same package with `dry_run: false`
   and wait for completion. This is the mutating upload; the workflow's
   post-publish digest comparison proves that the registry serves the bytes it
   uploaded. A successful real publish still does **not** prove that the
   package is public.

Actions → **Publish** also supports `verify_only: true` to qualify an
already-published tarball without uploading a duplicate or changing package
visibility. `visibility_only` defaults to `false`. When set, the workflow's
`visibility` job does **not** change anything — it only *reports* the package's
current GitHub Packages visibility and prints the settings URL where an owner
can change it. There is no REST endpoint for changing a GitHub Packages npm
package's visibility; see [Package visibility](#package-visibility) below
for why, and for the real manual step.

The workflow re-runs every gate in FULL mode — including name collision and
artifact safety — builds, tests, packs and prints one tarball. **The real
order of operations, in full, is:**

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
   tarball with `--dry-run`; an automatic version release publishes that same
   path with provenance. Either way, step 2 already had to pass first.
4. After a real publish, the workflow re-fetches that exact `name@version`
   from the registry and compares its digest with the uploaded tarball — proof
   that the registry *stored and now serves back* those same bytes, which is
   the one thing step 2 cannot prove no matter how thorough it is (it never
   touches the registry). It does **not** re-run the install-and-import proof
   against those bytes for an ordinary publish: byte identity plus step 2's
   proof against the identical local bytes already cover that; a second
   install-and-import check against bytes already proven identical would be a
   duplicate with no distinct purpose.
5. `verify_only` is the one path that still runs the fixed qualification runner
   against the fetched, already-published tarball — it exists specifically to qualify a
   version *already in the registry*, independent of whatever the current
   checkout contains (for example a version published before step 2 existed
   in this workflow, or as the "real consumer qualification" step
   [Package visibility](#package-visibility) asks for). There is no
   pre-publish check that could have already covered that case.

The workflow maps only the declared package scope to GitHub Packages, leaving
unscoped runtime dependencies on npmjs throughout verification.

### Why the name-collision check runs first, always

GitHub Packages namespaces npm packages by **owner account**, not by
repository. Publishing a name the account already owns under a *different*
repository does not fail — it silently appends a version to that existing
package and moves its `latest` dist-tag, with nothing to signal the mistake
at publish time.

Foundry is the only repository under this owner authorized to publish
packages. Non-publishing account-control-plane repositories may coexist, so
the owner-wide check still runs: the failure mode is silent and hard to undo
cleanly.

### Installing during W1D

There is no supported new-namespace install yet. The source manifests are
prepared for `@clossys` on public npm, but W1D deliberately publishes nothing.
An install command becomes current guidance only after W1E records the exact
registry-served identity, digest, and public-access result.

No npm token belongs in a consumer `.npmrc` for a public package. The expected
post-W1E shape is ordinary credential-free npm resolution, but the repository
must not claim that path works before the registry does.

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
`retired` status in `docs/contracts/package-lifecycle.json`; the live package
registry is exactly the file's nineteen `published` entries. There are no
current `deprecated` lifecycle entries and
`docs/contracts/package-retention.json` is intentionally empty. Do not
republish, copy, reuse, or select a retired name for a new integration.

The manual **Deprecate legacy packages** workflow remains a historical
read-only capability check. GitHub Packages currently rejects `npm deprecate`
metadata writes, and no retired name is a candidate for that mutation. The
lifecycle records and their historical decision/migration references preserve
the prior recuts without asserting that the retired artifacts remain live.

## 7. The public npm registry: historical cancellation, conditionally superseded

**Status: historical cancellation.** This section records the previous
decision, which remains the live operating rule until
[DECISIONS.md 18](DECISIONS.md#18-producer-owned-catalogue-distribution-cutover)
has passed its stated gates. Decision 18 replaces it only through its finite,
producer-owned transfer and whole-catalogue recut; it does not restore the old
runbook or permit a package-by-package migration.

Earlier revisions of this document carried a ten-step, owner-only runbook
for moving the canonical install source to `https://registry.npmjs.org`.
That migration is cancelled — see
[issue #213](https://github.com/vespeneventures/foundry/issues/213), which
supersedes the migration issue (#194) and the credentialless acceptance
criteria in its umbrella program (#196); both are closed as not planned.
The runbook is deliberately not preserved here: a detailed, ordered,
ready-to-run procedure sitting under a "cancelled" heading is an
attractive nuisance, and the single most consequential step in it was
irreversible.

### What the decision actually turned on

The first step was verifying and, if unclaimed, **claiming
`@vespeneventures` on npmjs**. GitHub organization ownership and an npm
scope are entirely separate namespaces, so owning the org name here
reserves nothing there. Claiming it is a first-come registration on a
shared public namespace: there is no supported way to return a name to
unclaimed, and a dispute over one goes through npm support rather than
anything this repository controls. Every subsequent step — trusted
publishing, the registry config change, `publishConfig.access` — was
recoverable. That one was not.

What the migration bought was a credential-free `npm install` for a reader
holding no credential and no relationship to this org. No such reader was
waiting. Every actual consumer authenticates through a plane that already
holds package credentials. Paying an irreversible cost up front for a
hypothetical adopter is the trade
[`CONTRIBUTING.md`](../CONTRIBUTING.md)'s "Supported configurations: the
default answer is also no" exists to refuse.

### What remains true regardless

- [`package-scope.json`](../package-scope.json) is still the single file
  declaring both the scope and the registry, and
  `node scripts/set-registry.mjs --check` (`npm run check:registry`, CI job
  `registry drift`) still fails if any package's `publishConfig.registry`
  drifts from it. It keeps every current package agreeing on one answer;
  decision 18 requires its history-aware successor before a later
  whole-catalogue recut.
- `scripts/check-name-collision.mjs` still runs before every publish. Its
  reason is GitHub Packages' own owner-scoped namespace and the silent
  version-append failure that namespace allows — unrelated to which
  registry was canonical.
- The documented consumer path — this file's ["Installing from GitHub
  Packages"](#installing-from-github-packages) section and
  [`README.md`'s "Installing" section](../README.md#installing) — describes
  an authenticated install because that is what actually works today. It
  remains the current path until decision 18's evidence-gated cutover changes
  the single scope/registry declaration.

### Current cutover constraint

Until the complete decision 18 1D whole-catalogue recut passes, GitHub
Packages is the current sole publication and installation lane for this
source. During 1D, the complete current catalogue must move together: the
scope/registry declaration, every manifest and first-party dependency,
lockfile, imports, documentation, inactive repository-source and workflow
preparation, and registry-specific verification. Before that recut,
history-aware scope/registry machinery and regression gates must preserve
legacy lifecycle, retention, and decision identities. No candidate-namespace
package may be published before the complete 1D recut passes. Old-namespace
versions remain immutable legacy packages.

After that passed recut, 1E first publishes the Advisor + Starter + Controller
Trio in its fixed owner-present order. A later new-namespace package may
publish only after every one of its first-party runtime dependencies is already
published and verified in that same candidate namespace; the runtime graph
above, not workspace order, governs the rest of the catalogue.

## 8. Canonical registry qualification before cutover

Until decision 18's 1D recut passes, GitHub Packages is the canonical
publication and installation lane. Existing package names and versions remain
there; do not unpublish, delete, copy, or reuse them as part of consumer
adoption. The decision's distinct post-transfer public-npm procedure governs
only after that gate; it does not relax any of this source's current checks.

For every package whose lifecycle status is `published`:

1. Run the package preflight in FULL public-safety mode before proposing any
   new version. The preflight must inspect the exact packed tarball and complete
   the owner-wide name-collision query.
2. Let the protected `npm-publish` environment gate the serial publish job.
   The job-scoped `GITHUB_TOKEN` uploads the exact tarball that passed the
   pre-publish checks; no consumer credential participates in publication.
3. Require the workflow's authenticated clean install and public-export smoke
   test against the selected tarball before upload. After upload, require the
   registry digest comparison; use `verify_only` to qualify an older existing
   registry version without publishing a duplicate.
4. Record the package's lifecycle state and replacement guidance in
   `docs/contracts/package-lifecycle.json`. The current registry is exactly
   its `published` entries; retired historical names are not installable
   migration artifacts or new adoption targets.

Consumers separately prove an authenticated install of each exact package they
adopt. They own their registry mapping, credential reference, lockfile, and
public-export or CLI smoke test. Foundry records no token value, account path,
or consumer-specific configuration. See [ADOPTION.md](ADOPTION.md) for the
capability and wiring ledger.

## Prerequisites held outside this repository

| Thing | Where | Notes |
| --- | --- | --- |
| Denylist | `~/.config/public-safety/denylist-foundry.json` locally; `PUBLIC_SAFETY_DENYLIST_B64` repository secret in CI | Never committed here — it names exactly what must not be public. Specific to this repository — never reuse a denylist file written for a different project. |
| Publish credential | Job-scoped `GITHUB_TOKEN` with workflow `packages: write` | Publishes packages associated with this repository; no stored publish token is used. |
| Package-index credential | `GH_PACKAGES_TOKEN` repository secret | Classic token with `read:packages`, used only by the pre-publish name-collision query across the owner namespace. |
| Consumer read credential | Consuming plane's credential system and process environment | Authenticates only that consumer's GitHub Packages reads. The value and its machine/CI injection never enter Foundry. |
