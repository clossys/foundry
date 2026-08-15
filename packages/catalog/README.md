# @vespeneventures/catalog

> **Deprecated compatibility package.** New integrations import
> `@vespeneventures/governance/catalog`. This package preserves the same root
> API while existing consumers migrate.

Walks a workspace's `packages/` directory and answers the questions no
single package's own manifest can: what packages actually exist on disk,
whether their real internal dependencies actually resolve, and whether the
dependency graph they form has cycles — computed entirely from each
package's own real `dependencies`/`peerDependencies`, never from a separate
block a package merely declares about itself.

```bash
npm install @vespeneventures/catalog
```

## The gather / judge split

This package is two pure halves, on purpose:

- **`buildCatalog` gathers.** It walks disk, parses JSON, and records what
  is there — the full `package.json` for every package found, verbatim. It
  never judges anything.
- **`evaluateCatalog` judges**, over data `buildCatalog` already gathered.
  Every dependency-graph question it answers reads `dependencies` and
  `peerDependencies` straight off each entry's stored manifest.

Nothing in `evaluateCatalog` touches the filesystem. `buildCatalog` stores
each entry's full parsed `package.json` so that `evaluateCatalog` never
needs to go back to disk to see `dependencies`, `peerDependencies`, or
anything else a manifest carries.

The one place this split needed sharpening: a directory `buildCatalog`
cannot read, or a manifest it cannot read or make sense of, is not nothing —
it is real signal that the catalog might be incomplete. `buildCatalog` still
never judges that signal; it records it as plain data, in `Catalog.skipped`,
and never throws. `evaluateCatalog` is what decides a skip is worth a
finding — see the `skipped:*` rule below.

## Usage

```ts
import { buildCatalog, evaluateCatalog } from "@vespeneventures/catalog";

const catalog = buildCatalog(process.cwd());
const findings = evaluateCatalog(catalog, { scope: "@your-scope" });

for (const f of findings) {
  console.error(`[${f.severity}] ${f.rule}${f.package ? ` (${f.package})` : ""}: ${f.message}`);
}
if (findings.some((f) => f.severity === "error")) process.exitCode = 1;
```

## What a catalog entry looks like

```jsonc
{
  "name": "@your-scope/widgets",
  "version": "0.1.0",
  "dir": "packages/widgets",
  "private": false,
  "packageJson": { /* the full parsed package.json this entry was read from */ }
}
```

## API

| Export | Kind | Purpose |
| --- | --- | --- |
| `buildCatalog(root, options?)` | function | Walks `<root>/<packagesDir>` (default `"packages"`) recursively, as deep as `options.maxDepth` allows, and returns a `Catalog`. A directory containing a `package.json` is a package and is not descended into further; anything else is walked deeper. Pure data gathering — never throws. Always resolves from `root`, never `process.cwd()`. Anything it could not read, or could not turn into a usable entry, is recorded into `Catalog.skipped` rather than silently dropped. |
| `evaluateCatalog(catalog, options?)` | function | Runs every rule below over an already-built `Catalog`, including one finding per `catalog.skipped` entry. Returns a `CatalogFinding[]`; empty means clean. Does no I/O. Never throws, on any stored shape. |
| `internalDependencyNamesOf(entry, scope?)` | function | The names of `entry`'s own `dependencies` + `peerDependencies` (merged, deduplicated) that count as internal — every such name when `scope` is omitted, or only the ones starting with `"<scope>/"` when one is given. Reads directly off `entry.packageJson`; total over any stored shape (a `dependencies`/`peerDependencies` that isn't a plain object contributes no names). |
| `closureOf(catalog, name, scope?)` | function | The internal-dependency closure of one entry, excluding itself: every package transitively reachable via real `dependencies`/`peerDependencies` (filtered by `scope`), split into `reachable` (found in the catalog) and `missing` (referenced but not found). Safe against cycles. Returns `{ reachable: [], missing: [] }` for a name not in the catalog. |
| `findByName(catalog, name)` | function | The single `CatalogEntry` with this `name`, or `undefined`. When `name` is shared by 2+ entries (see `duplicate-name`), this returns the first one found in `catalog.entries` order — a deterministic but arbitrary pick. |
| `Catalog` | type | `{ root: string; entries: CatalogEntry[]; skipped: CatalogSkip[] }` — `root` is the resolved absolute path `buildCatalog` was called with. `skipped` is everything `buildCatalog` looked at but could not turn into a `CatalogEntry`; empty when nothing was skipped. |
| `CatalogEntry` | type | One package: `name`, `version`, `dir` (relative to `Catalog.root`), `private`, `packageJson` (the full parsed manifest). |
| `CatalogFinding` | type | One thing `evaluateCatalog` found: `rule`, `severity`, `message`, optional `package` and `path`. |
| `CatalogSkip` | type | One path `buildCatalog` could not turn into a `CatalogEntry`: `path` (repo-relative, `/`-joined), `reason` (`CatalogSkipReason`), `kind` (`CatalogSkipKind`), optional `detail` (the underlying error's message). Deliberate exclusions (`node_modules`, `dist`, `build`, dot-directories, symlinks) are never recorded — only real unreadable/unusable paths are. |
| `CatalogSkipReason` | type | `"packages-dir-missing" \| "unreadable-directory" \| "unreadable-manifest" \| "unparseable-manifest" \| "manifest-not-object" \| "manifest-missing-name-or-version"`. |
| `CatalogSkipKind` | type | `"unreadable"` (a real I/O/permissions failure — unknown, unbounded state could be hiding behind it, so the catalog is provably incomplete) or `"unusable"` (complete, certain knowledge of the state — a manifest read fine but its content didn't work out, or the packages directory definitively does not exist). Drives `evaluateCatalog`'s severity choice for `skipped:*` findings — see that rule below. |
| `CatalogOptions` | type | Options for `buildCatalog`: `packagesDir?: string` (default `"packages"`), `maxDepth?: number` (default `4`, counted from the packages directory itself). |
| `EvaluateCatalogOptions` | type | Options for `evaluateCatalog`: `scope?: string`, restricting which of an entry's real dependencies count as internal — see `internalDependencyNamesOf`. |

## Rules `evaluateCatalog` checks

### `skipped:<reason>` — error or warning, by `CatalogSkip.kind`

One finding per entry in `catalog.skipped`: a path `buildCatalog` looked at
(or was configured to look at) but could not turn into a `CatalogEntry`.
This exists so "I could not check this" is visible instead of
indistinguishable from a genuinely clean or empty workspace.

Severity follows `CatalogSkip.kind`:

- **`error`**, for `kind: "unreadable"` — an unreadable path means this
  catalog does not know what, if anything, lives behind it. Every other
  finding in a report is only as trustworthy as the catalog it was computed
  over, and an unreadable path means that catalog is provably incomplete.
- **`warning`**, for `kind: "unusable"` — `buildCatalog` has complete,
  certain knowledge of the state (a manifest was fully read and its content
  just didn't work out, or the configured packages directory definitively
  does not exist). `packages-dir-missing` in particular is deliberately not
  `error`: a workspace legitimately mid-setup, or one that has never used
  the default `"packages"` name, is a normal input.

```
[error] skipped:unreadable-directory: "packages/locked" was skipped (unreadable-directory): EACCES: permission denied, scandir '...' — this catalog may be missing packages that live there.
[warning] skipped:packages-dir-missing: "packages" was skipped (packages-dir-missing) — this catalog may be missing packages that live there.
[warning] skipped:unparseable-manifest: "packages/broken" was skipped (unparseable-manifest): Unexpected token ... — this catalog may be missing packages that live there.
```

### `duplicate-name` — error

Two or more entries share the same `name`. One finding per duplicated name
(not one per pair), listing every directory it was found in.

```
[error] duplicate-name (@your-scope/widgets): "@your-scope/widgets" is declared by 2 packages: packages/widgets, packages/widgets-old.
```

### `internal-dep-missing` — error

An entry declares a real `dependencies`/`peerDependencies` name (filtered by
`scope`, if given) that is not the `name` of any package in this catalog —
a package depending on something that doesn't exist here at all.

```
[error] internal-dep-missing (@your-scope/widgets): "@your-scope/widgets" depends on "@your-scope/does-not-exist", which is not a package in this catalog.
```

### `dependency-cycle` — error

One finding per cyclic group in the internal-dependency graph, built only
from real `dependencies`/`peerDependencies` edges that resolve to another
package in the catalog. A cyclic group is a set of two or more packages
that can all reach each other (or a single package that depends on itself)
— none of them can be built, or pulled free of the others, without
addressing the whole group together, so that group, not any one path
through it, is the reporting unit. A group of several mutually-dependent
packages is one finding naming every member, not one finding per elementary
cycle: the number of elementary cycles in a densely connected group grows
combinatorially and is both too slow to compute reliably and not more
useful once computed — every one of those paths visits the same packages in
a different order. The finding names every member of the group and
includes one concrete example path so the message stays readable.

```
[error] dependency-cycle: 2 packages form a cyclic group — @your-scope/a, @your-scope/b (example path: @your-scope/a -> @your-scope/b -> @your-scope/a).
```

## Non-goal: content safety

Whether a package's *content* is safe to publish — secrets, private
identity, committed build output, agent-instruction files — is not this
package's job. `catalog` only answers shape-of-the-graph questions: what
exists on disk, what depends on what, and whether that dependency structure
is sound. A catalog with zero `evaluateCatalog` findings can still contain a
package that fails a separate content-safety check outright — those are two
different questions, asked by two different tools.

## Requirements

Node 20+. ESM only. Runtime dependency: `@vespeneventures/governance`
(`~0.10.0`), which this package's own `src/index.ts` re-exports from.

This package is not dependency-free: `governance` itself depends on
`@vespeneventures/policy`, which is therefore pulled in transitively by
installing this package too.

## Licence

MIT
