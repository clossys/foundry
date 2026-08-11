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
catalog ─┐
         ├─ gates ── release
policy ──┘       └───┘
```

`catalog` and `policy` are independent leaves and must each be available at
the exact compatible versions before `gates` is published. `release` follows
only after both `gates` and `policy` are available. A local workspace build is
not evidence that this graph is closed: workspace links can satisfy a package
that an external registry installer cannot obtain.

For a dependent package, the final proof is an isolated install of the exact
tarball that was scanned and selected for publication, after its sibling
runtime packages are present in the configured registry.
`@vespeneventures/release` supports that proof with `packRoundTrip`'s explicit
`tarballPath` and `registry` options. The registry token is supplied by the
caller for child npm processes only; it is never inherited from ambient
configuration or retained in a kept debug directory. The default round trip
intentionally remains an unauthenticated public-registry proof.

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

Actions → **Publish** → the package directory, `dry_run: true` first.
`make_public` defaults to `false` — leave it off; the package publishes
private, and going public is a separate, explicit decision made later (see
"Package visibility" below).

The workflow re-runs every gate in FULL mode — including name collision and
artifact safety — builds, tests, prints the tarball, and only then publishes
with provenance. Read the dry-run output, then run it again with
`dry_run: false`.

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
explicit access), even though this repository itself is public — that is
deliberate while this package set is still unproven with no real external
consumer, not a platform quirk to work around. The publish workflow's
`make_public` input, off by default, opts a specific package into public
visibility once that changes; leaving it off is what keeps a fresh publish
from becoming silently installable by a stranger. When `make_public` is
set, the workflow attempts an org-scoped API call to flip visibility and
warns rather than fails if it doesn't work — check
`https://github.com/orgs/vespeneventures/packages/npm/package/<name>/settings`
by hand if it does.

## Prerequisites held outside this repository

| Thing | Where | Notes |
| --- | --- | --- |
| Denylist | `~/.config/public-safety/denylist-foundry.json` locally; `PUBLIC_SAFETY_DENYLIST_B64` repository secret in CI | Never committed here — it names exactly what must not be public. Specific to this repository — never reuse a denylist file written for a different project. |
| Publish token | `NPM_TOKEN` repository secret (used as `NODE_AUTH_TOKEN`) | Needs `write:packages`/`read:packages` for the current GitHub Packages target, or npmjs publish rights if the registry moves — see `docs/DECISIONS.md` |
| Publish approval | `npm-publish` GitHub environment | Add required reviewers so a publish cannot run unattended |
