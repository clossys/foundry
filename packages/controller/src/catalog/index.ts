/**
 * @vespeneventures/catalog — a zero-dependency package in this small
 * foundation.
 *
 * `catalog` answers the questions that need the WHOLE set of packages: what
 * packages exist on disk under a workspace's packages directory, whether a
 * package's real internal dependencies actually exist, and whether the
 * dependency graph they form has cycles. It reads the real filesystem — this
 * is the one package in this foundation that does I/O.
 *
 * Split into two pure halves:
 *   - `buildCatalog` gathers. It walks disk, parses JSON, records what's
 *     there — the whole `package.json`, verbatim. It never judges.
 *   - `evaluateCatalog` judges, over data `buildCatalog` already gathered.
 *     Every dependency-graph question it answers is computed from each
 *     entry's own real `dependencies`/`peerDependencies` — never from
 *     anything a package merely declares about itself in a separate,
 *     unenforced block.
 *
 * NON-GOAL, deliberately: content safety — secrets, private identity,
 * forbidden files — is not here. That already exists, one layer up, in
 * `scripts/check-public-safety.mjs`, and belongs to the `gates` layer of
 * this same foundation. `catalog` only answers shape-of-the-graph
 * questions: what exists, what depends on what, and whether that
 * dependency structure is sound. Whether the *content* of any of it is
 * safe to publish is somebody else's job.
 */

export type {
  Catalog,
  CatalogEntry,
  CatalogFinding,
  CatalogOptions,
  CatalogSkip,
  CatalogSkipKind,
  CatalogSkipReason,
} from "./types.js";

export { buildCatalog } from "./build.js";

export type { EvaluateCatalogOptions } from "./evaluate.js";
export { closureOf, evaluateCatalog, findByName, internalDependencyNamesOf } from "./evaluate.js";
