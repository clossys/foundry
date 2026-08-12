# Decisions

The identity decisions below are made, not placeholders, so a future reader
doesn't have to reconstruct the reasoning from git history.

## 1. The publishing scope — `@vespeneventures`

**Status:** set in [`package-scope.json`](../package-scope.json).

`vespeneventures` is a GitHub organization created specifically to own this
repository and its packages, with no relationship to any other package
published anywhere else. That's not a config choice, it's structural: because
this org owns nothing else, there is nothing for a package name here to
collide with.

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
  literally true, and remains an option later. Moving there is a config
  change, not a rewrite:
  - register `@vespeneventures` on npmjs (a separate, independent namespace
    from GitHub Packages — owning the org name on GitHub does not reserve it
    on npmjs),
  - an npm automation token with publish rights, stored as the `NPM_TOKEN`
    repository secret (npmjs, not GitHub Packages, at that point),
  - add `publishConfig.access: "public"` to each package (npmjs defaults
    scoped packages to private; GitHub Packages has no equivalent flag),
  - update `package-scope.json.registry` to `https://registry.npmjs.org` and
    re-run `set-scope.mjs`.
  - Version *history* does not carry over — the two registries are entirely
    separate systems. Existing GitHub Packages versions can stay published
    (harmless) or be deprecated pointing at the new home; installers just drop
    the `@vespeneventures:registry=...` line from their `.npmrc` and reinstall.

### Why the name-collision gate runs before every publish, unconditionally

GitHub Packages namespaces npm packages by **owner account**, not by
repository. Publishing a name an account already owns under a *different*
repository does not fail — it silently appends a version to that existing
package and moves its `latest` dist-tag. The failure is silent at publish
time, which is exactly the kind of mistake that's cheap to prevent and
expensive to notice after the fact.

This org exists as a dedicated, single-purpose identity specifically so there
is nothing else under this owner for a package name to collide with — but
`scripts/check-name-collision.mjs` still runs before every publish
regardless, because a gate that only runs when someone remembers it's
"probably fine" isn't a gate. See `docs/PUBLISHING.md` for what it checks and
why it's ordered first among the gates.

## 3. The GitHub organization — a new, dedicated org

**Status:** `vespeneventures`, created specifically for this purpose and
nothing else.

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

## Settled

**Author attribution — keep a real name in the `"author"` field.** A real
author name is conventional in open source, and the MIT licence requires a
named copyright holder to be a valid grant. The gate's `neutralize` list is
path-scoped to `package.json`, where that field actually lives — this
document deliberately does not repeat the literal value, since a doc file is
not one of the neutralized paths and would fail the same gate it describes.
