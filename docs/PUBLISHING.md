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
artifact safety — builds, tests, packs and prints one tarball. A manual dry
run exercises npm's own publish command against that exact tarball with
`--dry-run`; an automatic version release publishes that same path with
provenance. A real publish then re-fetches that exact
`name@version`, compares its digest with the uploaded tarball, and installs
the registry copy in an isolated consumer that imports every declared export.
The workflow maps only the declared package scope to GitHub Packages, leaving
unscoped runtime dependencies on npmjs throughout verification.

### Why the name-collision check runs first, always

GitHub Packages namespaces npm packages by **owner account**, not by
repository. Publishing a name the account already owns under a *different*
repository does not fail — it silently appends a version to that existing
package and moves its `latest` dist-tag, with nothing to signal the mistake
at publish time.

`vespeneventures` was created specifically to own this repository and
nothing else, so this should never legitimately fire here — but the failure
mode is silent and hard to undo cleanly, which is exactly why the check runs
unconditionally rather than being trusted to "obviously not apply."

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

with `GH_PACKAGES_TOKEN` set in the environment. See `docs/DECISIONS.md` for
why GitHub Packages was chosen anyway, and what moving to public npmjs
later would cost (a config change, not a rewrite).

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

## 7. Migrating to the public npm registry

**Status: not started.** Every package here still publishes to GitHub
Packages, which requires a `read:packages` token to install even for a
publicly visible package version — including for a consumer with no other
relationship to this org. That is tracked as issue #194 (P0 in the
credentialless-adoption program, issue #196): distribution, not any package
API, is what currently blocks a clean install for a consumer holding no
credential at all.

This section is the ordered runbook a repository owner follows to move the
canonical install source from GitHub Packages to the public npm registry
(`https://registry.npmjs.org`). It exists so that migration is a checklist,
not a rediscovery — the same reason the rest of this document is a
checklist rather than prose. **Nothing in this repository can perform step
1 or step 2 below.** Both happen on npm's own infrastructure, outside any
CI job or script this repository runs, and both require an npm account
with real authority over the destination namespace. An automated agent
must never attempt them; they are listed here so a human owner has the
exact steps in one place, in order.

Reversibility is called out explicitly at each step, because the failure
mode this whole document exists to avoid — publishing something that
cannot be taken back — applies to this migration too, not only to a single
package's first release.

1. **Verify control of the `@vespeneventures` scope on the public npm
   registry.** ⚠️ **Effectively irreversible.** GitHub organization
   ownership and an npm scope are entirely separate namespaces — owning
   `github.com/vespeneventures` does not reserve `@vespeneventures` on
   `npmjs.com`, the same way this repository's own
   [`docs/DECISIONS.md`](DECISIONS.md#2-the-registry--github-packages)
   already notes. If the scope is unclaimed, claiming it (via an npm
   organization or user account with billing/ownership control) is a
   first-come registration on a shared public namespace: once registered,
   there is no supported way to hand it back to "unclaimed," and a
   dispute over an already-registered name goes through npm support, not
   through anything this repository controls. If the scope is already
   claimed by someone else, this migration cannot proceed under the
   `@vespeneventures` name at all — see the compatibility requirement in
   issue #194 for the fallback (another scope, or another npm-compatible
   public registry proving the same credential-free contract).
2. **Configure npm trusted publishing (OIDC) for this repository's
   `publish.yml` workflow**, on npm's package/organization settings page,
   for every package name that will publish from here. Trusted publishing
   binds a specific GitHub repository and workflow file as an authorized
   publisher for a specific npm package, so `npm publish` can authenticate
   using the job's own short-lived GitHub Actions OIDC token instead of a
   stored long-lived npm token — no `NPM_TOKEN` secret is created or
   stored in this repository at any point. This repository's
   `publish.yml` already declares `permissions: id-token: write` for npm
   provenance, which is the same permission trusted publishing consumes;
   no new workflow permission is required for this step, only the
   publisher-trust registration on npm's side. ⚠️ **Recoverable but
   security-sensitive**: the trust relationship can be edited or revoked
   from npm's settings at any time, but while it is active, any workflow
   run matching the trusted repository and file can publish under that
   package name — review `publish.yml`'s `publish` job (in particular its
   `environment: npm-publish` protected-environment gate) before trusting
   it, the same review this repository already applies to the job-scoped
   `GITHUB_TOKEN` it uses today.
3. **Point the single declared registry at npm**, once steps 1–2 are
   confirmed:
   ```bash
   node scripts/set-registry.mjs --registry https://registry.npmjs.org
   ```
   This is a plain, git-recoverable edit: it rewrites
   `package-scope.json.registry` and every non-private
   `packages/*/package.json`'s `publishConfig.registry` in place (see
   `scripts/set-registry.mjs`'s own header), and
   `node scripts/set-registry.mjs --check` (`npm run check:registry`) then
   confirms nothing drifted. Nothing on any registry changes yet.
4. **Add `publishConfig.access: "public"` to every package that will
   publish to npm.** npmjs defaults a *scoped* package to private on first
   publish; GitHub Packages has no equivalent flag, which is why no
   package here declares this today. Because this edits
   `packages/*/package.json`, each touched package's packed content has
   changed and needs its own version bump — the `release readiness` gate
   (`node scripts/check-release-readiness.mjs`) enforces this the same way
   it enforces any other manifest change; see this repository's own
   versioning conventions (prefer a patch bump, and widen every
   dependent's declared range — 0.x semver is minor-locked both for `^`
   and `~`) before touching more than one package's `package.json` in the
   same change. Recoverable: a git revert undoes it before anything is
   published.
5. **Update `publish.yml`'s authentication step** to use npm trusted
   publishing instead of the job-scoped `GITHUB_TOKEN` it authenticates
   with today (that token only ever worked because the destination was
   GitHub's own Packages registry — it authenticates to nothing on
   npmjs). Keep every gate that already runs before publish unchanged:
   name collision, denylist-backed safety (FULL mode, required), README
   parity, contamination classes, artifact safety on the packed tarball,
   and the pack-then-publish-that-exact-tarball ordering. Recoverable in
   this repository; not yet reversible once it has actually published (see
   step 7).
6. **Review, do not blindly reuse, every registry-specific check** issue
   #194 calls out by name before it runs against npm for real:
   - `scripts/check-name-collision.mjs` queries GitHub's own
     owner-scoped Packages API (`gh api /orgs/{owner}/packages/npm/...`)
     to catch GitHub Packages' specific "same owner, different repo"
     silent-append failure mode. npmjs collision semantics are different —
     a name already published on npmjs is rejected outright with `403`,
     not silently appended to — so this script's *purpose* (never publish
     a name registered to something else) still applies, but its
     *mechanism* (which API it queries) needs a destination-registry
     equivalent before it can be trusted here.
   - The provenance and pack/round-trip verification `publish.yml` already
     runs (`packRoundTrip`, the tarball digest re-check, the isolated
     consumer import) is registry-agnostic in shape — it takes a registry
     URL and auth token as caller-supplied config — but has only ever
     been exercised against GitHub Packages in this repository. Prove it
     against npm with a `workflow_dispatch` dry run (see below) before
     trusting it on a real publish.
   - The `visibility` job and its "no API for this" finding are entirely
     GitHub-Packages-specific (GitHub Packages defaults new packages
     private with no visibility-change API). npmjs's own
     `publishConfig.access: "public"` (step 4) is the equivalent lever
     there and needs no separate reporting job.
7. **Publish for real, starting from the runtime dependency order this
   document already declares** (`policy` → `governance`, then each
   dependent only after its runtime siblings are live on npm — see
   [Runtime dependency order](#runtime-dependency-order) above), using a
   `workflow_dispatch` **dry run** (`dry_run: true`) first for each
   package to exercise the whole path — including step 6's reviewed
   gates — without publishing anything. ⚠️ **A real publish (`dry_run:
   false` or a version-bump push) is irreversible**: npm forbids
   republishing the same `name@version` once published, and unpublishing
   is restricted to a short window and does not free the version number
   again. This is the step nothing before it can be undone after.
8. **Prove the credential-free contract for real**, in a fresh temporary
   `HOME`/`npm_config_userconfig` with no `.npmrc` copied in and every
   npm/GitHub token environment variable absent:
   ```bash
   npm install @vespeneventures/<package>@<version>
   ```
   should succeed from the default registry with nothing else configured,
   for every package published in step 7, and the resulting
   `package-lock.json` should contain no `npm.pkg.github.com` URL for any
   `@vespeneventures/*` tarball. This is the actual acceptance evidence
   issue #194 asks for — a green `check:registry` gate proves internal
   consistency, never a live credential-free install.
9. **Decide the fate of the existing GitHub Packages versions**, and
   record the decision in this document. They cannot be moved — the two
   registries are entirely separate systems, so no version history carries
   over (`docs/DECISIONS.md` already states this) — and per issue #194's
   explicit non-goals, no existing GitHub Packages version is deleted or
   yanked as part of this migration. The realistic choices are: leave
   GitHub Packages published and undocumented (a consumer with an existing
   `.npmrc` keeps resolving there, unaffected, but it is no longer the
   path this repository tests or documents), or mark it deprecated once
   GitHub Packages actually supports a `npm deprecate` metadata write for
   this registry (as of this writing it does not — see [Deprecating
   compatibility packages](#deprecating-compatibility-packages) above for
   the same limitation already hit for the legacy compatibility package
   names).
10. **Update the documented and tested consumer path** — this file's
    ["Installing from GitHub Packages"](#installing-from-github-packages)
    section and [`README.md`'s "Installing"
    section](../README.md#installing) — to describe the npm install as the
    normal, working path, not a pending one, only after step 8's
    credential-free transcript actually exists. Until then, both documents
    describe the *intended* end state and say so explicitly; claiming it
    early is the same false-clearance mistake `AGENTS.md` and this
    document already warn against for a partial safety scan (**"A partial
    pass is not a clearance"**) — applied here to installation instead of
    to identity scanning.

## Prerequisites held outside this repository

| Thing | Where | Notes |
| --- | --- | --- |
| Denylist | `~/.config/public-safety/denylist-foundry.json` locally; `PUBLIC_SAFETY_DENYLIST_B64` repository secret in CI | Never committed here — it names exactly what must not be public. Specific to this repository — never reuse a denylist file written for a different project. |
| Publish credential | Job-scoped `GITHUB_TOKEN` with workflow `packages: write` | Publishes packages associated with this repository; no stored publish token is used. |
| Package-index credential | `GH_PACKAGES_TOKEN` repository secret | Classic token with `read:packages`, used only by the pre-publish name-collision query across the owner namespace. |
