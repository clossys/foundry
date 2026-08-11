import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findByName } from "@vespeneventures/catalog";
import { runFoundationCheck } from "./foundation.js";
import { computeBuildOrder } from "./build-order.js";

// Self-hosting integration test: runs runFoundationCheck/computeBuildOrder
// against THIS repository's real packages/ directory, not a fixture — the
// same pattern @vespeneventures/catalog's own integration test uses. Root is
// resolved three levels up from this file (src -> packages/gates ->
// packages -> repo root) and verified below before anything else runs.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

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
    expect(existsSync(join(repoRoot, "packages", "gates", "package.json"))).toBe(true);
  });

  // Guards every scope-dependent assertion below: a scope matching nothing
  // produces the same empty finding list a genuinely clean scope produces.
  it("the scope under test actually matches packages in this repo", () => {
    expect(SCOPE).toMatch(/^@[a-z0-9][a-z0-9._-]*$/);
    const report = runFoundationCheck(repoRoot, { scope: SCOPE });
    const matching = report.catalog.entries.filter((e) => e.name?.startsWith(`${SCOPE}/`));
    expect(matching.length).toBeGreaterThan(0);
  });

  it("finds the foundation and repository contract among the real entries", () => {
    const report = runFoundationCheck(repoRoot, { scope: SCOPE });

    expect(report.catalog.entries.length).toBeGreaterThanOrEqual(4);
    const names = report.catalog.entries.map((e) => e.name);
    for (const expected of [
      "@vespeneventures/catalog",
      "@vespeneventures/policy",
      "@vespeneventures/gates",
      "@vespeneventures/release",
      "@vespeneventures/repository",
    ]) {
      expect(names).toContain(expected);
    }

    const gatesEntry = findByName(report.catalog, "@vespeneventures/gates");
    expect(gatesEntry).toBeDefined();
  });

  it("produces zero error-severity findings for @vespeneventures/gates itself", () => {
    const report = runFoundationCheck(repoRoot, { scope: SCOPE });
    const gatesFindings = report.findings.filter((f) => f.package === "@vespeneventures/gates");
    const gatesErrors = gatesFindings.filter((f) => f.severity === "error");

    expect(gatesErrors).toEqual([]);
  });

  it("computes a real build order for this repo's actual dependency graph, with no cycle", () => {
    const report = runFoundationCheck(repoRoot, { scope: SCOPE });
    const result = computeBuildOrder(report.catalog, { scope: SCOPE });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable — asserted ok:true above");

    const indexOf = (name: string) => result.order.indexOf(name);

    // Constraints the ordering MUST satisfy given the real dependency edges —
    // NOT a frozen literal ordering.
    expect(indexOf("@vespeneventures/catalog")).toBeLessThan(indexOf("@vespeneventures/gates"));
    expect(indexOf("@vespeneventures/policy")).toBeLessThan(indexOf("@vespeneventures/gates"));
    expect(indexOf("@vespeneventures/gates")).toBeLessThan(indexOf("@vespeneventures/release"));
    expect(indexOf("@vespeneventures/policy")).toBeLessThan(indexOf("@vespeneventures/release"));
    expect(indexOf("@vespeneventures/repository")).toBeGreaterThanOrEqual(0);

    // Every entry the catalog found appears exactly once in the order.
    expect(result.order).toHaveLength(report.catalog.entries.length);
    expect(new Set(result.order).size).toBe(result.order.length);
  });
});
