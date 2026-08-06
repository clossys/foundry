import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "./build.js";
import { evaluateCatalog, findByName } from "./evaluate.js";

// Integration test: runs buildCatalog/evaluateCatalog against THIS repo's
// real packages/ directory, not a fixture. Root is resolved three levels up
// from this file (src -> packages/catalog -> packages -> repo root) and
// verified below before anything else runs, so a future move of this test
// file fails loudly here instead of quietly finding zero packages.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// Read the scope from package-scope.json rather than hardcoding it.
//
// A hardcoded scope literal is not rewritten by set-scope.mjs — that script
// rewrites scopes embedded in package NAMES, not a bare scope passed as a
// VALUE. A repo-wide scope change therefore leaves a literal like
// `scope: "@old"` behind, and the failure is silent rather than loud:
// `scope` drives the internal-dep-missing/dependency-cycle filtering, which
// simply never fires when nothing matches it. Every "expect zero findings"
// assertion below would then keep passing for the wrong reason. Reading the
// single source of truth removes the drift entirely.
const SCOPE = JSON.parse(readFileSync(join(repoRoot, "package-scope.json"), "utf8")).scope;

describe("integration: real packages/ directory", () => {
  it("resolves repoRoot to a directory that actually contains a packages/ tree", () => {
    expect(existsSync(join(repoRoot, "packages"))).toBe(true);
    expect(existsSync(join(repoRoot, "package.json"))).toBe(true);
    expect(existsSync(join(repoRoot, "packages", "catalog", "package.json"))).toBe(true);
  });

  // Guards every scope-dependent assertion in this file. Without it a wrong
  // or stale scope is indistinguishable from a clean run, because a scope
  // matching nothing produces no findings — the same empty array a correct,
  // genuinely clean scope produces.
  it("the scope under test actually matches packages in this repo", () => {
    expect(SCOPE).toMatch(/^@[a-z0-9][a-z0-9._-]*$/);
    const matching = buildCatalog(repoRoot).entries.filter((entry) => entry.name?.startsWith(`${SCOPE}/`));
    expect(matching.length).toBeGreaterThan(0);
  });

  it("finds this repository's real packages: catalog, policy, gates, release", () => {
    const catalog = buildCatalog(repoRoot);
    const names = catalog.entries.map((e) => e.name);

    for (const expected of [`${SCOPE}/catalog`, `${SCOPE}/policy`, `${SCOPE}/gates`, `${SCOPE}/release`]) {
      expect(names).toContain(expected);
    }
  });

  it("finds this package (@vespeneventures/catalog) itself, self-hosting cleanly against the real dependency graph", () => {
    const catalog = buildCatalog(repoRoot);
    const catalogEntry = findByName(catalog, `${SCOPE}/catalog`);

    expect(catalogEntry).toBeDefined();
    // catalog has zero declared dependencies today (see its own
    // package.json) — no internal-dep-missing findings attributed to it.
    const findings = evaluateCatalog(catalog, { scope: SCOPE });
    const catalogOwnFindings = findings.filter((f) => f.package === `${SCOPE}/catalog`);
    expect(catalogOwnFindings).toEqual([]);
  });

  it("produces zero error-severity findings for this repository's own packages/ tree", () => {
    const catalog = buildCatalog(repoRoot);
    const findings = evaluateCatalog(catalog, { scope: SCOPE });

    // Nothing here asserts zero findings overall — an unrelated warning
    // must not make this test brittle — but a clean, well-formed real
    // dependency graph must never produce an error.
    const errors = findings.filter((f) => f.severity === "error");
    expect(errors).toEqual([]);
  });
});
