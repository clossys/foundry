import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findByName } from "../catalog/index.js";
import { runFoundationCheck } from "./foundation.js";
import { computeBuildOrder } from "./build-order.js";

// Self-hosting integration test: runs runFoundationCheck/computeBuildOrder
// against THIS repository's real packages/ directory, not a fixture — the
// same pattern @vespeneventures/catalog's own integration test uses. Root is
// resolved four levels up from this file (gates -> src -> controller ->
// packages -> repo root) and verified below before anything else runs.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

// Read the scope from package-scope.json rather than hardcoding it. A bare
// scope literal is not rewritten by set-scope.mjs — that script rewrites
// scopes embedded in package NAMES, not one passed as a VALUE — and a stale
// one fails silently rather than loudly: `scope` drives the
// internal-dep-missing/dependency-cycle filtering, which never fires when
// nothing matches it, so a "zero findings" assertion keeps passing for the
// wrong reason.
const SCOPE = JSON.parse(readFileSync(join(repoRoot, "package-scope.json"), "utf8")).scope;

describe("integration: real packages/ directory", () => {
  it("resolves repoRoot to a directory that actually contains this package", () => {
    expect(existsSync(join(repoRoot, "packages"))).toBe(true);
    expect(existsSync(join(repoRoot, "package.json"))).toBe(true);
    // `gates` is a subpath of `@vespeneventures/controller` now (issue
    // #282 merged the standalone `gates` package into it with zero
    // consumers left behind), so the on-disk package that must exist is
    // `controller`, not a `gates` package directory.
    expect(existsSync(join(repoRoot, "packages", "controller", "package.json"))).toBe(true);
  });

  // Guards every scope-dependent assertion below: a scope matching nothing
  // produces the same empty finding list a genuinely clean scope produces.
  it("the scope under test actually matches packages in this repo", () => {
    expect(SCOPE).toMatch(/^@[a-z0-9][a-z0-9._-]*$/);
    const report = runFoundationCheck(repoRoot, { scope: SCOPE });
    const matching = report.catalog.entries.filter((e) => e.name?.startsWith(`${SCOPE}/`));
    expect(matching.length).toBeGreaterThan(0);
  });

  it("finds the foundation contract among the real entries", () => {
    const report = runFoundationCheck(repoRoot, { scope: SCOPE });

    expect(report.catalog.entries.length).toBeGreaterThanOrEqual(4);
    const names = report.catalog.entries.map((e) => e.name);
    // `catalog`, `policy`, `governance`, `gates`, `release`, `repository`,
    // and `review` were separate, paired compatibility packages before
    // issue #282's recut folded every one of them into
    // `@vespeneventures/controller` as subpaths and deleted the standalone
    // packages with zero consumers left. There is exactly one foundation
    // package left to find now.
    expect(names).toContain("@vespeneventures/controller");

    const controllerEntry = findByName(report.catalog, "@vespeneventures/controller");
    expect(controllerEntry).toBeDefined();
  });

  it("produces zero error-severity findings for @vespeneventures/controller itself", () => {
    const report = runFoundationCheck(repoRoot, { scope: SCOPE });
    const controllerFindings = report.findings.filter((f) => f.package === "@vespeneventures/controller");
    const controllerErrors = controllerFindings.filter((f) => f.severity === "error");

    expect(controllerErrors).toEqual([]);
  });

  it("computes a real build order for this repo's actual dependency graph, with no cycle", () => {
    const report = runFoundationCheck(repoRoot, { scope: SCOPE });
    const result = computeBuildOrder(report.catalog, { scope: SCOPE });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable — asserted ok:true above");

    const indexOf = (name: string) => result.order.indexOf(name);

    // Constraints the ordering MUST satisfy given the real dependency edges —
    // NOT a frozen literal ordering. Issue #282's recut deleted the
    // `governance`/`policy` compatibility stubs entirely (zero consumers),
    // so there is no longer a `governance` node to route through.
    // `@vespeneventures/controller` absorbed `catalog`, `policy`, `gates`,
    // `release`, `repository`, and `review` as subpaths and has zero
    // internal dependencies of its own; `builder`, `inspector`, and
    // `ledger` each declare a real, direct dependency on `controller`, and
    // `surface` depends on `copy` and `ui`.
    expect(indexOf("@vespeneventures/controller")).toBeLessThan(indexOf("@vespeneventures/builder"));
    expect(indexOf("@vespeneventures/controller")).toBeLessThan(indexOf("@vespeneventures/inspector"));
    expect(indexOf("@vespeneventures/controller")).toBeLessThan(indexOf("@vespeneventures/ledger"));
    expect(indexOf("@vespeneventures/copy")).toBeLessThan(indexOf("@vespeneventures/surface"));
    expect(indexOf("@vespeneventures/ui")).toBeLessThan(indexOf("@vespeneventures/surface"));

    // Every entry the catalog found appears exactly once in the order.
    expect(result.order).toHaveLength(report.catalog.entries.length);
    expect(new Set(result.order).size).toBe(result.order.length);
  });
});
