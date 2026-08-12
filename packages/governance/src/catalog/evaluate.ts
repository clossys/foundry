/**
 * `evaluateCatalog` — pure judgement over already-gathered data. It answers
 * the questions that need the whole set of packages, computed from data
 * every package.json already carries — `dependencies`, `peerDependencies` —
 * never from a separate, self-declared block: does a real dependency
 * matching the given scope actually exist anywhere in this catalog, and is
 * the dependency graph (built from those same real dependencies) closed
 * under cycles. It also turns every recorded `Catalog.skipped` entry into a
 * finding — see the `skipped:*` rule below.
 *
 * Nothing in this file touches the filesystem. `buildCatalog` already read
 * everything a `Catalog` needs — including each entry's full `packageJson` —
 * so judgement never has to go back to disk.
 *
 * TOTALITY: every function below that reads dependency names goes through
 * `internalDependencyNamesOf`, which reads `Object.keys(...)` off
 * `dependencies`/`peerDependencies` — an operation that is total over any
 * JSON-parsed value (a non-object degrades to zero keys via the
 * `isPlainObject` guard; `Object.keys` itself never throws and never
 * misreads a value as something it isn't, unlike an array-spread over an
 * unvalidated value). `evaluateCatalog` must never throw on any stored
 * shape — a caller that already discovered N genuine findings must never
 * lose all N of them because the (N+1)th package's manifest happened to be
 * malformed in a way this package itself introduced no defence against.
 */

import type { Catalog, CatalogEntry, CatalogFinding } from "./types.js";

/** Options for `evaluateCatalog`. */
export interface EvaluateCatalogOptions {
  /**
   * Restricts which of an entry's real `dependencies`/`peerDependencies`
   * count as "internal" to this catalog, for the `internal-dep-missing` and
   * `dependency-cycle` rules: a dependency name is internal exactly when it
   * starts with `"<scope>/"`. When omitted, every `dependencies`/
   * `peerDependencies` name is treated as internal — the right default for
   * a workspace where every runtime dependency between its own packages
   * already is one (an ordinary external runtime dependency would need its
   * own `dependencies` entry to be affected either way).
   */
  scope?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The names of `entry`'s own `dependencies` + `peerDependencies` (merged,
 * deduplicated) that count as "internal" to this catalog — every such name
 * when `scope` is omitted, or only the ones starting with `"<scope>/"` when
 * one is given. Reads directly off `entry.packageJson`, the real manifest
 * fields — never off anything a package merely declares about itself in a
 * separate, unenforced block. Total over any stored shape: a `dependencies`
 * or `peerDependencies` that isn't a plain object contributes no names at
 * all, rather than throwing or being misread.
 */
export function internalDependencyNamesOf(entry: CatalogEntry, scope?: string): string[] {
  const pkg = entry.packageJson;
  const deps = isPlainObject(pkg.dependencies) ? Object.keys(pkg.dependencies) : [];
  const peerDeps = isPlainObject(pkg.peerDependencies) ? Object.keys(pkg.peerDependencies) : [];
  const merged = [...new Set([...deps, ...peerDeps])];
  return scope === undefined ? merged : merged.filter((name) => name.startsWith(`${scope}/`));
}

/**
 * The single entry in a catalog with the given `name`, if any.
 *
 * DUPLICATE-NAME BEHAVIOUR, explicit: when 2+ entries share `name` (which
 * `duplicate-name` already flags as its own error, separately), this
 * returns the FIRST one found in `catalog.entries` order — the same
 * (stable, sorted — see `buildCatalog`) order the catalog itself uses, so
 * this is deterministic, but it is still an arbitrary pick among the
 * duplicates. That is fine for the use this function is put to below
 * (existence checks, where WHICH matching entry is irrelevant — see
 * `internal-dep-missing`), but it is the wrong tool for anything that needs
 * to consider what a dependency-by-name actually resolves to: use
 * `findAllByName` there instead, as `closureOf` does, specifically so a real
 * edge declared only by the SECOND duplicate is never silently dropped just
 * because `find` stopped at the first.
 */
export function findByName(catalog: Catalog, name: string): CatalogEntry | undefined {
  return catalog.entries.find((entry) => entry.name === name);
}

/** Every entry in a catalog with the given `name` — see `findByName`'s doc comment for why this exists alongside it. */
function findAllByName(catalog: Catalog, name: string): CatalogEntry[] {
  return catalog.entries.filter((entry) => entry.name === name);
}

/**
 * The internal-dependency closure of one entry, excluding itself: every
 * package reachable by following real `dependencies`/`peerDependencies`
 * edges (filtered by `scope` — see `internalDependencyNamesOf`),
 * transitively, starting from `name`.
 *
 * The result is split into `reachable` (names found in the catalog) and
 * `missing` (names that matched the internal-dependency filter but are not
 * present anywhere in the catalog) — the same distinction
 * `internal-dep-missing` checks for the single-entry case, generalised to
 * the whole closure.
 *
 * DUPLICATE NAMES: unlike `findByName`, this follows EVERY entry sharing a
 * name (via `findAllByName`) at each step, unioning their dependencies. A
 * traversal that only followed the first of two duplicate-named entries
 * could miss a real edge only the second one declares, silently
 * understating the closure.
 *
 * Safe against cycles: each name is visited at most once. If `name` itself
 * is not in the catalog, both lists come back empty.
 */
export function closureOf(catalog: Catalog, name: string, scope?: string): { reachable: string[]; missing: string[] } {
  const startCandidates = findAllByName(catalog, name);
  if (startCandidates.length === 0) return { reachable: [], missing: [] };

  const reachable = new Set<string>();
  const missing = new Set<string>();
  const visited = new Set<string>([name]);
  const queue: string[] = startCandidates.flatMap((entry) => internalDependencyNamesOf(entry, scope));

  while (queue.length > 0) {
    const depName = queue.shift() as string;
    if (visited.has(depName)) continue;
    visited.add(depName);

    const depCandidates = findAllByName(catalog, depName);
    if (depCandidates.length === 0) {
      missing.add(depName);
      continue;
    }
    reachable.add(depName);
    for (const depEntry of depCandidates) {
      for (const next of internalDependencyNamesOf(depEntry, scope)) {
        if (!visited.has(next)) queue.push(next);
      }
    }
  }

  return { reachable: [...reachable], missing: [...missing] };
}

/**
 * Strongly connected components of `adjacency`, via Tarjan's algorithm, in
 * O(V+E). Two nodes are in the same SCC exactly when each can reach the
 * other — which is exactly what "both nodes lie on a common cycle" requires
 * — so a non-trivial SCC (2+ members, or a single member with a self-loop)
 * IS a cyclic group: see `findCyclicGroups`, which is this function's only
 * caller.
 */
function stronglyConnectedComponents(adjacency: Map<string, string[]>): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  function strongconnect(v: string): void {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v) as number, lowlink.get(w) as number));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v) as number, indices.get(w) as number));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop() as string;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      components.push(component);
    }
  }

  for (const node of adjacency.keys()) {
    if (!indices.has(node)) strongconnect(node);
  }

  return components;
}

/**
 * One concrete simple cycle within `members` (a non-trivial strongly
 * connected component, so at least one cycle is guaranteed to exist) — a
 * single DFS from the lexicographically smallest member, returning as soon
 * as it finds a back edge to a node already on the current path. Unlike an
 * exhaustive enumeration, this never revisits a branch once it backtracks
 * out of it, so it is O(V+E) within the component: it exists purely to give
 * `findCyclicGroups`' finding one concrete, readable example path, not to
 * find every path — see that function's doc comment for why "every path"
 * is neither attempted nor useful.
 */
function findExamplePath(members: Set<string>, adjacency: Map<string, string[]>): string[] {
  const start = [...members].sort()[0] as string;
  const path: string[] = [];
  const onPath = new Set<string>();

  function visit(node: string): string[] | null {
    path.push(node);
    onPath.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (!members.has(next)) continue; // edge leaves this SCC — cannot be part of a cycle confined to it
      if (onPath.has(next)) {
        return [...path.slice(path.indexOf(next)), next];
      }
      const found = visit(next);
      if (found) return found;
    }
    path.pop();
    onPath.delete(node);
    return null;
  }

  // A non-trivial SCC guarantees a cycle exists reachable from every one of
  // its members, so `visit(start)` always finds one; the `?? [start, start]`
  // fallback only exists to keep this function total rather than asserting.
  return visit(start) ?? [start, start];
}

/**
 * Finds every CYCLIC GROUP in the internal-dependency graph, built only from
 * real `dependencies`/`peerDependencies` edges that match `scope` (an edge
 * to a name not present in the catalog is dropped here — `internal-dep-missing`
 * reports that separately, so a cycle finding never doubles as a
 * missing-dependency finding).
 *
 * REPORTING UNIT, deliberately: one entry per non-trivial strongly connected
 * component (`stronglyConnectedComponents`), not one per elementary cycle.
 * An SCC with 2+ members — or a single member with a self-loop — IS a
 * cyclic group: every member can reach every other, so none of them can be
 * built, or broken out of the cycle, without addressing the whole group
 * together. This function used to enumerate every distinct elementary
 * cycle instead, which has two fatal problems in practice, not one:
 *
 *   1. IT DOESN'T SCALE. The number of elementary cycles in a graph is
 *      combinatorially explosive — a complete digraph on n nodes (every
 *      package mutually depending on every other, an unusual but entirely
 *      real shape for a small "core" cluster) has on the order of n!
 *      elementary cycles. Measured: n=9 already produces 125,664 cycles in
 *      over 2 seconds; n=12 is on the order of an hour. A `check`-style
 *      gate that can hang indefinitely on a legitimate (if messy) input is
 *      not a gate.
 *   2. EVEN WHEN IT COMPLETES, THE OUTPUT ISN'T A REPORT. 125,664 findings
 *      is not something anyone can act on. Every one of those paths visits
 *      the same n nodes in a different order — they are one problem
 *      ("these n packages form a mutually-dependent group") described
 *      125,664 times, not 125,664 distinct problems.
 *
 * Reporting per-SCC is exactly the right fix for both: `stronglyConnected
 * Components` is O(V+E) — cannot blow up on any input — and "these N
 * packages form a cyclic group" is precisely the fact someone needs in
 * order to break the cycle; which of the group's many internal paths gets
 * shown as the example is incidental. `findExamplePath` finds ONE concrete
 * path through the group (via a single non-exhaustive DFS, also O(V+E))
 * purely so the finding's message stays readable, not to enumerate.
 */
function findCyclicGroups(catalog: Catalog, scope: string | undefined): { members: string[]; examplePath: string[] }[] {
  const adjacency = new Map<string, string[]>();
  for (const entry of catalog.entries) {
    adjacency.set(
      entry.name,
      internalDependencyNamesOf(entry, scope).filter((dep) => findByName(catalog, dep) !== undefined),
    );
  }

  const groups: { members: string[]; examplePath: string[] }[] = [];

  for (const component of stronglyConnectedComponents(adjacency)) {
    const members = new Set(component);
    if (members.size === 1) {
      const only = component[0] as string;
      if (!(adjacency.get(only) ?? []).includes(only)) continue; // singleton, no self-loop — not a cycle
    }
    groups.push({ members: [...members].sort(), examplePath: findExamplePath(members, adjacency) });
  }

  // Sorted by the group's own smallest member so the overall finding order
  // is deterministic and readable, independent of Tarjan's internal
  // traversal/finish order (which is a real but unhelpful kind of
  // determinism — tied to implementation details no reader should have to
  // know about).
  groups.sort((a, b) => (a.members[0] as string).localeCompare(b.members[0] as string));

  return groups;
}

/**
 * Evaluates an already-built `Catalog` against every cross-package rule this
 * package knows about. See the README for the full list, one example each.
 * Never throws — see this file's top doc comment (TOTALITY).
 */
export function evaluateCatalog(catalog: Catalog, options?: EvaluateCatalogOptions): CatalogFinding[] {
  const findings: CatalogFinding[] = [];
  const scope = options?.scope;

  // Rule: skipped:<reason> — one finding per path buildCatalog recorded in
  // `catalog.skipped`, i.e. every path it looked at (or was configured to
  // look at) but could not turn into a CatalogEntry. `catalog.skipped` is
  // read defensively (`?? []`) rather than assumed present: `Catalog` is a
  // plain data shape a caller can construct by hand (as, for example, a
  // consuming package's own unit tests do, entirely reasonably, without
  // going through buildCatalog) — evaluateCatalog must stay total over that
  // too, not just over what buildCatalog itself would ever produce.
  //
  // SEVERITY, deliberately chosen per `skip.kind`:
  //   - "unreadable" -> error. An unreadable directory or manifest means
  //     this catalog does not know what — if anything — lives behind the
  //     failure: zero packages, one, or a hundred could be hiding there, any
  //     of which might declare a genuine, error-severity problem of its own
  //     (see build.test.ts's chmod-000 fixture, where a real
  //     `internal-dep-missing` finding disappeared along with the unreadable
  //     package it belonged to, before this rule existed). That is a
  //     DIFFERENT, and arguably WORSE, kind of problem than any single rule
  //     violation below: every other finding in this report is only as
  //     trustworthy as the catalog it was computed over, and an unreadable
  //     path means that catalog is provably incomplete. Treating it as
  //     anything less than `error` would let a `check`-style gate exit 0
  //     over a report that cannot actually vouch for itself.
  //   - "unusable" -> warning. `buildCatalog` has COMPLETE, certain
  //     knowledge of the relevant state here — either a manifest file was
  //     fully read and its content just didn't work out (bad JSON, not an
  //     object, missing name/version), or the configured packages directory
  //     definitively does not exist at all. Neither case has any unknown,
  //     unbounded state hiding behind it the way an unreadable directory
  //     does. `packages-dir-missing` in particular is deliberately NOT
  //     `error`: a workspace legitimately mid-setup, or one that has never
  //     used the default `"packages"` name, is a normal input (see
  //     buildCatalog's own doc comment) — this still makes the difference
  //     from a real config typo VISIBLE, which is what was actually missing
  //     before, without making every fresh/differently-laid-out workspace
  //     fail a `check`-style gate outright.
  for (const skip of catalog.skipped ?? []) {
    findings.push({
      rule: `skipped:${skip.reason}`,
      severity: skip.kind === "unreadable" ? "error" : "warning",
      message: `"${skip.path}" was skipped (${skip.reason})${skip.detail ? `: ${skip.detail}` : ""} — this catalog may be missing packages that live there.`,
      path: skip.path,
    });
  }

  // Rule: duplicate-name — one finding per name shared by 2+ entries, not
  // one per pair.
  const byName = new Map<string, CatalogEntry[]>();
  for (const entry of catalog.entries) {
    const group = byName.get(entry.name);
    if (group) group.push(entry);
    else byName.set(entry.name, [entry]);
  }
  for (const [name, group] of byName) {
    if (group.length > 1) {
      findings.push({
        rule: "duplicate-name",
        severity: "error",
        message: `"${name}" is declared by ${group.length} packages: ${group.map((e) => e.dir).join(", ")}.`,
        package: name,
      });
    }
  }

  // Rule: internal-dep-missing — a name in an entry's own real
  // `dependencies`/`peerDependencies` (filtered by `scope` — see
  // `internalDependencyNamesOf`) that does not resolve to any package in
  // this catalog. Existence is boolean (does ANY entry named `depName`
  // exist), so — unlike `dependency-cycle` — this rule is not affected by
  // duplicate names: `findByName`'s "first match" pick is irrelevant when
  // all that matters is whether a match exists at all.
  for (const entry of catalog.entries) {
    for (const depName of internalDependencyNamesOf(entry, scope)) {
      if (!findByName(catalog, depName)) {
        findings.push({
          rule: "internal-dep-missing",
          severity: "error",
          message: `"${entry.name}" depends on "${depName}", which is not a package in this catalog.`,
          package: entry.name,
          path: depName,
        });
      }
    }
  }

  // Rule: dependency-cycle — one finding per CYCLIC GROUP (strongly
  // connected component with 2+ members, or a self-loop), not per
  // elementary cycle. See findCyclicGroups' doc comment for why.
  for (const group of findCyclicGroups(catalog, scope)) {
    findings.push({
      rule: "dependency-cycle",
      severity: "error",
      message:
        `dependency cycle: ${group.members.length} packages form a cyclic group — ` +
        `${group.members.join(", ")} (example path: ${group.examplePath.join(" -> ")}).`,
    });
  }

  return findings;
}
