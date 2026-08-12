/**
 * `computeBuildOrder` — the actual gap this layer exists to close. This
 * repository's own root `package.json` currently hand-maintains a fixed
 * prefix ("build layer 1 first, then everything else") as a stopgap, with a
 * comment saying a real topological order belongs to a layer above
 * `catalog`. This is that layer.
 *
 * Pure, no I/O: takes an already-built `Catalog` (from
 * `@vespeneventures/catalog`'s `buildCatalog`) and returns a build order
 * without ever touching disk itself.
 */

import { evaluateCatalog, internalDependencyNamesOf } from "../catalog/index.js";
import type { Catalog } from "../catalog/index.js";
import type { BuildOrderResult } from "./types.js";

/** Options for `computeBuildOrder`. */
export interface ComputeBuildOrderOptions {
  /**
   * Passed straight through to `evaluateCatalog` and to
   * `internalDependencyNamesOf` (both from `@vespeneventures/catalog`) —
   * restricts which of an entry's real `dependencies`/`peerDependencies`
   * count as edges in the graph this function sorts. See
   * `@vespeneventures/catalog`'s `EvaluateCatalogOptions.scope` for the exact
   * filtering rule.
   */
  scope?: string;
}

/**
 * Computes a deterministic topological build order over `catalog`'s
 * internal-dependency graph using Kahn's algorithm: repeatedly take the
 * ready node (no unresolved internal dependency remaining) with no
 * unresolved dependency, append it to the order, and remove its outgoing
 * edges — i.e. decrement the in-degree of everything that depends on it.
 *
 * Cycle detection is NOT reimplemented here. `evaluateCatalog` (from
 * `@vespeneventures/catalog`) already finds cycles in exactly this graph via
 * its own `dependency-cycle` rule; this function calls it first, and if it
 * reports any `dependency-cycle` finding, returns those findings as the
 * failure instead of attempting a sort on a graph already known to have a
 * cycle. A cyclic graph has no valid topological order at all, so there is
 * nothing a partial sort could usefully report.
 *
 * `duplicate-name` is gated on the same way, for the same reason, and it
 * matters just as much: `evaluateCatalog` already computes this finding too
 * (it is not reimplemented here either), but an earlier version of this
 * function filtered ONLY for `dependency-cycle` and silently discarded any
 * `duplicate-name` finding sitting right there in the same result. Two
 * catalog entries sharing a name make the in-degree/dependents maps below
 * key on that shared name, which is where the actual damage happened: one
 * of the two same-named entries' dependency edges gets clobbered by the
 * other's, an entry can vanish from the emitted order entirely, and — the
 * worst part — the function still returns `ok: true`, reporting success on
 * a build order that is short one or more real packages. Gating here first
 * means that broken path is never reached at all: a catalog with duplicate
 * names never gets as far as being sorted.
 *
 * An entry with no matching real dependency is treated as having no
 * internal dependencies — it becomes ready immediately, on the same footing
 * as a genuine zero-dependency package.
 *
 * An internal dependency naming a package not present in `catalog` at all
 * (already reported separately by `evaluateCatalog`'s `internal-dep-missing`
 * rule) contributes no edge here either — the same convention `catalog`'s
 * own cycle detection uses: an edge to a node that doesn't exist can't be
 * waited on.
 *
 * Ties — two or more packages that are simultaneously ready, with nothing in
 * the tied set depending on anything else in it — are broken alphabetically
 * by name. That is what makes the result deterministic and reproducible
 * across runs and machines, which matters for real CI reproducibility, not
 * just test convenience: two packages with no dependency relationship
 * between them would otherwise build in whatever order object/array
 * iteration happened to produce.
 */
export function computeBuildOrder(catalog: Catalog, options?: ComputeBuildOrderOptions): BuildOrderResult {
  const scope = options?.scope;

  // Gate on both dependency-cycle AND duplicate-name — see this function's
  // doc comment for why a duplicate name is just as fatal to a valid order
  // as a cycle is, and why both must be checked before any sorting begins.
  const blockingFindings = evaluateCatalog(catalog, { scope }).filter(
    (finding) => finding.rule === "dependency-cycle" || finding.rule === "duplicate-name",
  );
  if (blockingFindings.length > 0) {
    return { ok: false, findings: blockingFindings };
  }

  const names = new Set(catalog.entries.map((entry) => entry.name));

  // in-degree: how many not-yet-built internal dependencies each entry has.
  const inDegree = new Map<string, number>();
  // dependents: for each package, the list of packages that declare it as an
  // internal dependency — i.e. the edges to relax once this package builds.
  const dependents = new Map<string, string[]>();

  for (const entry of catalog.entries) {
    const deps = internalDependencyNamesOf(entry, scope).filter((dep) => names.has(dep));
    inDegree.set(entry.name, deps.length);
    for (const dep of deps) {
      const list = dependents.get(dep);
      if (list) list.push(entry.name);
      else dependents.set(dep, [entry.name]);
    }
  }

  // The ready set: every entry with no unresolved dependency right now.
  // Kept sorted so the next node taken is always the alphabetically
  // smallest one currently ready — this is what breaks ties deterministically.
  const ready: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) ready.push(name);
  }
  ready.sort();

  const order: string[] = [];
  while (ready.length > 0) {
    const name = ready.shift() as string;
    order.push(name);
    for (const dependent of dependents.get(name) ?? []) {
      const remaining = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) {
        // Insert in sorted position rather than push-then-sort-the-whole-array
        // every iteration; the ready list stays small in practice, and this
        // keeps the tie-break rule (alphabetical among currently-ready nodes)
        // visibly correct at every step rather than relying on a final sort.
        let insertAt = ready.length;
        while (insertAt > 0 && (ready[insertAt - 1] as string) > dependent) insertAt--;
        ready.splice(insertAt, 0, dependent);
      }
    }
  }

  // Invariant: a successful order contains every catalog entry exactly
  // once. This is guaranteed by construction once duplicate-name and
  // dependency-cycle are gated on above — Kahn's algorithm always drains
  // its ready queue completely on a DAG with unique names — but it is
  // asserted explicitly here rather than trusted silently. This exact
  // function used to report `ok: true` while quietly dropping entries (see
  // the doc comment above); an explicit check is what keeps that failure
  // mode from ever reappearing unnoticed, here or after some future edit.
  if (order.length !== catalog.entries.length) {
    throw new Error(
      `computeBuildOrder: internal invariant violated — computed an order with ${order.length} entries ` +
        `but the catalog has ${catalog.entries.length}. This should be unreachable once duplicate-name and ` +
        `dependency-cycle findings are gated on above; please report this as a bug.`,
    );
  }

  return { ok: true, order };
}
