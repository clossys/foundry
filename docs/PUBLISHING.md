# Publishing a package

This is a checklist rather than prose because the failure mode — publishing
something that should have stayed private — is not reversible. Anything
pushed to a public remote should be assumed cached and indexed even if
deleted minutes later.

One package, `@vespeneventures/contract`, was published from this
repository and has since been removed from the codebase (see
[docs/DECISIONS.md](DECISIONS.md) for why). Its name and every version it
published still exist on the registry — a published name can never be
reused for a different package, whether or not the original is still in
the tree. Everything below is the general process for adding and
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

### Runtime dependency order

Publication order follows the runtime graph, not filesystem order or the
order packages happen to appear in a workspace:

```
policy ── governance
```

`governance` owns its catalog, gates, release, repository, and review
subpaths; its only Foundry runtime sibling is `policy`. The former standalone
package names remain compatibility artifacts and must not be selected for new
consumer integrations. A local workspace build is not evidence that this
graph is closed: workspace links can satisfy a package that an external
registry installer cannot obtain.

For a dependent package, the final proof is an isolated install of the exact
tarball that was scanned and selected for publication, after its sibling
runtime packages are present in the configured registry.
`@vespeneventures/release` supports that proof with `packRoundTrip`'s explicit
`tarballPath` and `registry` options. The registry token is supplied by the
caller for child npm processes only; it is never inherited from ambient
configuration or retained in a kept debug directory. The default round trip
intentionally remains an unauthenticated public-registry proof.

`@vespeneventures/governance` is also a consumer-facing CLI. Before publishing
it, verify an isolated private-registry installation can import its public API
and run `foundry-governance` against a valid lifecycle document. Governance is
read-only: package preflight is used only by the producer that intends to
publish; ordinary consuming workspaces run its lifecycle check without any
registry write.

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

**What `npm run preflight` does *not* run: `packRoundTrip`.** Artifact safety
(`scripts/check-artifact-safety.mjs`) packs the tarball for real and scans its
*contents* — forbidden files, credential-shaped strings, private identity,
structural defects such as a missing `LICENSE` — but it never installs the
tarball or imports a single declared export. That install-and-import proof is
a separate, genuinely distinct check (`packRoundTrip`, see
[`packages/governance/src/release/pack-round-trip.ts`](../packages/governance/src/release/pack-round-trip.ts)),
and it does not run as part of `preflight-package.mjs` at all. This is a real
gap, not merely an enforcement gap: there is currently no local command that
proves a package installs and imports cleanly before you propose publishing
it. The only place that proof runs is inside the publish workflow itself (see
[6. Publish](#6-publish) below) — now *before* `npm publish`, but still not
reachable from a maintainer's own machine ahead of opening a pull request.
Closing that — wiring `packRoundTrip` into `preflight-package.mjs` itself — is
tracked as separate, future work; it is not part of what fixed the ordering
below.

- [ ] Safety gate reports **FULL** mode and `PASS`. A `PASS (partial)` is not
      a clearance — it means identity checks never ran.
- [ ] `npm pack --dry-run` (or the artifact-safety gate, which packs for
      real) contents are exactly what you intended. This is the last look at
      the thing that actually ships.
- [ ] For `gates` and `release`, their already-published runtime siblings
      have passed an explicit private-registry round trip against the exact
      tarball selected for publication. Do not replace this with a local
      tarball dependency or a workspace link; either would hide the graph
      closure being proven.

## 6. Publish

Merging a package's new `package.json` version to `main` publishes that
package automatically. The workflow selects only newly added package
manifests or manifests whose version changed, serializes releases, and runs
the full publication path against the merged commit. Source-only changes do
not publish: release them only with a version change.

Actions → **Publish** remains available for an explicit `dry_run: true`,
bootstrap publication of a version that predated this automation, and a
non-mutating `verify_only: true` qualification of an already-published
tarball. The latter fetches the exact registry version and runs the isolated
consumer proof without uploading a duplicate or changing package visibility.
`visibility_only` defaults to `false`. When set, the workflow's `visibility`
job does **not** change anything — it only *reports* the package's current
GitHub Packages visibility and prints the settings URL where an owner can
change it. There is no REST endpoint for changing a GitHub Packages npm
package's visibility; see [Package visibility](#package-visibility) below
for why, and for the real manual step.

The workflow re-runs every gate in FULL mode — including name collision and
artifact safety — builds, tests, packs and prints one tarball. **The real
order of operations, in full, is:**

1. Pack exactly one tarball (the same bytes get inspected, round-tripped, and
   published — never a second, separate `npm pack`).
2. **`packRoundTrip` installs that exact tarball into a genuinely isolated
   directory and imports every subpath its `exports` field declares — before
   anything is published.** A failure here stops the job: `npm publish` never
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
5. `verify_only` is the one path that still runs `packRoundTrip` against the
   fetched, already-published tarball — it exists specifically to qualify a
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

### Installing from GitHub Packages

Installing a package from here needs a GitHub personal access token with
`read:packages` scope — GitHub Packages requires authentication for every
install regardless of registry visibility. For a private package, the token
must also belong to an account with access granted. Add to the consuming
project's `.npmrc` (never commit a real one):

```
@vespeneventures:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GH_PACKAGES_TOKEN}
```

with `GH_PACKAGES_TOKEN` set in the environment. The consuming plane owns the
registry mapping, credential reference, and local or CI injection. Foundry
never stores the consumer's token value or account-specific installation
manifest. See `docs/DECISIONS.md` for why GitHub Packages is canonical.

### Package visibility

New packages publish **private** by default (visible only to accounts with
explicit access), even though this repository itself is public.

**There is no API to change a GitHub Packages npm package's visibility.**
This was verified directly against the real API: a `PATCH` to
`/orgs/{owner}/packages/npm/{name}` with `visibility=public` returns `404`
even with a full-permission PAT, while `GET` on that same path works fine.
Changing visibility is a web-UI-only operation; no token scope or workflow
permission makes it possible another way.

Once a package has passed a real consumer qualification, an owner makes it
public manually:

1. Visit `https://github.com/orgs/<org>/packages/npm/<name>/settings` — for
   a package owned by a personal account rather than an organization, GitHub
   exposes the equivalent settings page under that account's own packages
   tab instead.
2. Under **Danger Zone**, change the package's visibility to Public.

Dispatching **Publish** with its package directory and `visibility_only:
true` runs the workflow's `visibility` job as a convenience, but that job
only *reports* the package's current visibility (a `GET` call) and prints
the settings URL above — it never attempts to change anything, because
there is nothing it could call to do so.

#### The automated visibility gate

The manual `visibility_only` report above only runs when someone remembers
to ask for it. `scripts/check-package-visibility.mjs` is the gate that does
not depend on that: it compares every "published"
[`docs/contracts/package-lifecycle.json`](contracts/package-lifecycle.json)
entry's declared intent — recorded separately in
[`docs/contracts/package-visibility.json`](contracts/package-visibility.json),
since `package-lifecycle.json`'s schema is owned by the published
`@vespeneventures/governance` package and a new field there would force a
version bump for what is really repository-tooling metadata — against the
package's real GitHub Packages visibility, and fails when they disagree.
This is the gate that would have caught `@vespeneventures/ui` sitting
private across 12 published versions.

It runs in two places, never as part of local `npm run check` (it needs a
live `read:packages` token, which ordinary local development and fork CI
should never be required to hold):

- `.github/workflows/publish.yml`'s `visibility-check` job, immediately
  after a real publish — catching a bad default the moment it is created.
- `.github/workflows/package-visibility.yml`, on a daily schedule —
  catching drift that happens with no publish at all (for example a manual
  mistake in GitHub's own web UI).

Like the `visibility_only` report above, it only ever detects and reports.
There is no API to change a package's visibility, so a finding here still
ends at the manual step described earlier in this section.

One property of it is worth stating, because it is the difference between a
gate and a green light. GitHub answers `404` — not `403` — for a package the
caller cannot see, so that it never leaks a private package's existence to
someone without access. "Never published" and "published, but invisible to
this credential" are therefore the same response, and no per-package check
can separate them. A `GH_PACKAGES_TOKEN` rotated to one missing
`read:packages` would otherwise produce a daily green check asserting every
package is public, having never actually seen the registry — the exact
shape of failure this gate exists to prevent, wearing the gate's own badge.
So when *every* declared package comes back `404`, the run exits `2`
(could-not-run) rather than `0`. A single real answer anywhere is enough to
trust the remaining `404`s as genuine.

### Deprecating compatibility packages

The old `catalog`, `gates`, `release`, `repository`, and `review` names are
published compatibility wrappers, not new integration targets. After their
replacement version has passed registry qualification, migrate to the
corresponding `@vespeneventures/governance` subpath. Do not unpublish these
names: the compatibility wrapper remains the migration path.

GitHub Packages currently rejects `npm deprecate` metadata writes for this
registry (including explicit versions with the job-scoped `packages: write`
token). The manual **Deprecate legacy packages** workflow is retained for
read-only plan verification, but do not use its `apply` mode unless GitHub
Packages documents and demonstrates support. Lifecycle records and these
wrapper READMEs are the authoritative migration notices in the meantime.

## 7. The public npm registry: considered, cancelled

**Status: cancelled — this is a recorded decision, not a pending task.**
Every package here publishes to GitHub Packages, and that is the canonical
adoption lane. Nothing in this section is work waiting to be picked up.

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
  drifts from it. That gate matters *more* under a settled registry than it
  did under a pending migration — it is what keeps twenty packages agreeing
  on one answer.
- `scripts/check-name-collision.mjs` still runs before every publish. Its
  reason is GitHub Packages' own owner-scoped namespace and the silent
  version-append failure that namespace allows — unrelated to which
  registry was canonical.
- The documented consumer path — this file's ["Installing from GitHub
  Packages"](#installing-from-github-packages) section and
  [`README.md`'s "Installing" section](../README.md#installing) — describes
  an authenticated install because that is what actually works. It no
  longer describes an intended end state, because there is no longer a
  different one pending.

### If this is ever revisited

The bar is the one any speculative capability faces here: a real consumer
that needs it, not one that might. Reopening would mean a fresh decision
recorded in [`docs/DECISIONS.md`](DECISIONS.md#2-the-registry--github-packages),
and a runbook rewritten against whatever npm's publishing and trusted-publisher
surface looks like then — not this one restored from git history.

## 8. Canonical registry qualification

GitHub Packages is the canonical publication and installation lane. Existing
package names and versions remain there; do not unpublish, delete, copy, or
reuse them as part of consumer adoption.

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
   `docs/contracts/package-lifecycle.json`. Deprecated compatibility names
   remain installable migration artifacts and are not new adoption targets.

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
