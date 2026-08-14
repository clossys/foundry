# Decisions

The identity decisions below are made, not placeholders, so a future reader
doesn't have to reconstruct the reasoning from git history.

## 1. The publishing scope — `@vespeneventures`

**Status:** set in [`package-scope.json`](../package-scope.json).

`vespeneventures` owns this repository's packages, with no relationship to a
package published by a different producer. Foundry is the only repository under
this owner authorized to publish packages. A private account-control-plane
repository may coexist, but it does not publish packages or weaken Foundry's
owner-wide name-collision gate.

Changing the scope, if it's ever needed, is still one command:

```bash
node scripts/set-scope.mjs --scope @yourscope
```

which rewrites every package name and every import in docs and doc comments,
and `node scripts/set-scope.mjs --check` runs in CI so a hand-edited package
name can't drift from the declaration.

## 2. The registry — GitHub Packages

**Status:** both the scope and the registry (`https://npm.pkg.github.com`) are
declared together in [`package-scope.json`](../package-scope.json) — one file,
one source of truth for both.

The trade-off, accepted deliberately rather than defaulted into:

- Installing needs a GitHub personal access token with `read:packages` — a
  GitHub Packages platform behavior that applies to every registry read
  regardless of visibility, not a permissions choice made here. Package
  visibility is a separate, per-package decision (see
  [docs/PUBLISHING.md](PUBLISHING.md#package-visibility)), not a consequence
  of the registry choice itself.
- Public npmjs would make "anyone can install this, no token required"
  literally true. It was planned, worked on, and then **cancelled** — see
  [issue #213](https://github.com/vespeneventures/foundry/issues/213), which
  supersedes the migration issue (#194) and the credentialless acceptance
  criteria in its umbrella program (#196). Both are closed as not planned.

  GitHub Packages is therefore the canonical adoption lane, not a staging
  step on the way somewhere else. Consumers authenticate through whichever
  plane owns their package credentials.

  The reasoning, since "we changed our mind" is not a reason: the first
  step of that migration was verifying and, if unclaimed, **claiming
  `@vespeneventures` on npmjs** — a first-come registration on a shared
  public namespace, with no supported way to return a name to unclaimed and
  no recourse for a dispute except npm support. Every later step was
  recoverable; that one was not. What it bought was credential-free install
  for a reader with no relationship to this org, and no such reader was
  waiting: every actual consumer already authenticates through a plane that
  holds package credentials. Paying an irreversible cost for a hypothetical
  adopter is exactly the trade this repository's own conventions tell it not
  to make — see `CONTRIBUTING.md`'s "Supported configurations: the default
  answer is also no."

  This is recorded rather than deleted because the question recurs. A reader
  who notices the token requirement will wonder whether it is an oversight;
  it is not, and the answer should be one link away rather than a
  rediscovery. The bar to revisit is the same one any speculative capability
  faces here: a real consumer that needs it, not one that might.

- Each consuming plane owns its scope mapping, token reference, and local or CI
  injection. Foundry documents the protocol but never stores consumer
  credentials or account-specific installation manifests.
- Publishing remains a separate protected lane. The workflow uses its
  job-scoped `GITHUB_TOKEN` for uploads and a read-only package-index
  credential for the owner-wide collision query; a consumer read credential
  is not a publish credential.
- Existing GitHub Packages names and versions remain published. They are not
  deleted, yanked, copied to a second registry, or reused for a different
  package.

### A standing property of that registry: optional peers install as required

**Status:** documented, not worked around. [Issue #226](https://github.com/vespeneventures/foundry/issues/226)
confirmed, with a control query, that the GitHub Packages packument omits
`peerDependenciesMeta` for every version it serves — `peerDependencies`
comes back complete, `peerDependenciesMeta` comes back empty, from the same
authenticated request. The tarball's own `package.json` is correct; the loss
happens when GitHub Packages assembles the metadata document an installer
actually reads, before any tarball is fetched.

This was always possible the moment #213 (above) made GitHub Packages the
canonical, non-transitional registry: it is a property of *this* registry,
not of publishing from this repository in general, and choosing this
registry means living with what it does and doesn't serve. While the
registry question was still open, a gap like this would have been a reason
to keep looking; settled, it is a consequence to record next to the choice
that produced it, not a reason to revisit #213 itself.

Six packages currently express optionality through `peerDependenciesMeta` —
`ui`, `auth`, `surface`, `consent`, `comms`, and `governance` — and all six
are affected identically: every consumer installing from this registry gets
every declared peer as a hard requirement, regardless of which subpath it
actually imports. The declarations themselves are not changing. They are
correct in the tarball, they are what a reader of the package's own
`package.json` sees, and they become correct for installers too the day
GitHub Packages starts serving the field. What changed instead is the
documentation: each affected package's README now states its own effective
install behaviour on this registry, and [docs/ADOPTION.md](ADOPTION.md)
records it where adoption expectations are set. See issue #226 for the full
evidence, the options considered, and why splitting packages or moving
peers into `dependencies` were not taken.

### Why the name-collision gate runs before every publish, unconditionally

GitHub Packages namespaces npm packages by **owner account**, not by
repository. Publishing a name an account already owns under a *different*
repository does not fail — it silently appends a version to that existing
package and moves its `latest` dist-tag. The failure is silent at publish
time, which is exactly the kind of mistake that's cheap to prevent and
expensive to notice after the fact.

Foundry is the only repository under this owner authorized to publish packages,
but non-publishing account-control-plane repositories may coexist.
`scripts/check-name-collision.mjs` still runs before every publish because a
gate that only runs when someone remembers it is "probably fine" is not a gate.
See `docs/PUBLISHING.md` for what it checks and why it is ordered first.

## 3. The GitHub organization — a new, dedicated org

**Status:** `vespeneventures`, the owner of Foundry's packages and public
neutral producer. Private, non-publishing account-control-plane repositories
may coexist under the same owner.

Every published package carries `repository`, `bugs`, and `homepage` URLs
pointing at its own repository, so the org name is unavoidably public
metadata — this is the org a reader is meant to see. The denylist for this
repository (see `SECURITY.md`) has no rule that matches this org's own name,
so no neutralize/exception entry is needed for it to describe itself.

## 4. Deleting the `contract` metadata schema

**Status:** removed. `@vespeneventures/contract` and the `contract` block
it defined — previously required in every package's `package.json` — no
longer exist in this repository.

`contract` asked every package to self-report six fields in a block inside
its own `package.json`, and validated that block's shape. An audit found
that all six fields were mechanically derivable from data already present
in the same `package.json`: the real `dependencies` and `peerDependencies`
fields, the package's own directory, its own name. The block was applied to
144 packages by a script that made zero judgment calls — it filled in the
same six fields the same mechanical way everywhere — and across all 144
packages, `contract`'s own validation produced zero findings.

Zero findings from 144 mechanically-generated blocks is not evidence the
packages were sound. It is evidence the check was validating its own
output. A gate that is satisfied by deriving its answers from the exact
thing it is checking is a tautology — it can never fail, and a check that
can never fail is not a check.

The fix was not a stricter schema. It was deleting the schema and computing
every one of its questions from data that was always real: whether a
package's dependency actually resolves is now answered by reading its own
`dependencies`/`peerDependencies`, not a separately-maintained declaration
of the same fact. `@vespeneventures/catalog` answers exactly that question,
from exactly that data — see its README. Every package remaining in this
repository shares the same thesis: a check runs against what is actually on
disk or actually installed, never against what a manifest claims about
itself.

A previously-published version, `@vespeneventures/contract@0.1.0`, still
exists on the registry — see [docs/PUBLISHING.md](PUBLISHING.md) for why a
published name can never be reused, deleted from the tree or not.

## 5. Deleting `web-charts` and `web-storage`

**Status:** removed. Both packages previously published from this
repository have been deleted from the tree.

They are removed for now, not retired as a judgment about their design —
they may be recreated later. Their removal is a scope decision, not a
finding about the mechanism the remaining four packages exist to enforce.

---

## 6. Retiring `domain-model`

**Status:** retired from the registry after the supported consumers migrated
to `@vespeneventures/domain@0.2.0`.

The original package name was retained temporarily only as a compatibility
re-export. It has now been removed from this repository and the registry; it
is not republished. The lifecycle record retains the replacement and migration
evidence so historical package state remains auditable without leaving an
installable compatibility surface.

---

## 7. Consolidating `tokens` and `voice`

**Status:** `@vespeneventures/tokens` and `@vespeneventures/voice` are
deprecated registry artifacts. Their source packages were consolidated into
`@vespeneventures/ui` and `@vespeneventures/copy`, respectively, on
2026-08-11.

The former packages remain published while consumers migrate, because a
registry release cannot be safely erased from the history an installer may
already resolve. New work uses the replacement packages and their focused
subpaths: `@vespeneventures/ui` for tokens and styles, and
`@vespeneventures/copy` or `@vespeneventures/copy/voice` for the voice
contract. The consumer migration checklist in
[docs/PIPELINE.md](PIPELINE.md#consumer-integration-checklist) is the durable
handoff; no compatibility re-export is retained in this workspace.

---

## 8. Consolidating package-process surfaces under `governance`

**Status:** the supported package-process surface is
`@vespeneventures/governance@^0.2.0`. Its `./catalog`, `./gates`,
`./release`, `./repository`, and `./review` subpaths own the corresponding
public contracts and CLIs.

`@vespeneventures/catalog`, `@vespeneventures/gates`,
`@vespeneventures/release`, `@vespeneventures/repository`, and
`@vespeneventures/review` remain as deprecated compatibility packages while
consumers migrate. They preserve their existing root imports, the review
GitHub subpath, and the `foundry-check`, `repository-check`, and
`review-check` command names by delegating to the matching governance
subpath. They are registry migration artifacts, not additional supported
package choices.

This keeps package lifecycle, discovery, gates, release proof, repository
profiles, and review evidence in one package-process ownership boundary while
preserving installed-consumer compatibility. The legacy names must not be
unpublished or reused; their retirement requires the documented consumer
migration and later lifecycle evidence.

---

## Settled

**Author attribution — keep a real name in the `"author"` field.** A real
author name is conventional in open source, and the MIT licence requires a
named copyright holder to be a valid grant. The gate's `neutralize` list is
path-scoped to `package.json`, where that field actually lives — this
document deliberately does not repeat the literal value, since a doc file is
not one of the neutralized paths and would fail the same gate it describes.
