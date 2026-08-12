import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { combinePreflightOk, preflightPackage } from "./preflight.js";

// Real end-to-end proof, not a fixture: root is this repository's real
// workspace root, and packageDir is the real packages/policy directory.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

// Read the scope from package-scope.json rather than hardcoding it: a bare
// scope literal is not rewritten by set-scope.mjs (which rewrites scopes in
// package NAMES, not one passed as a VALUE), and a stale one fails silently.
const SCOPE = JSON.parse(readFileSync(join(repoRoot, "package-scope.json"), "utf8")).scope;

describe("preflightPackage — real end-to-end against packages/policy", () => {
  it("reports ok:true for @vespeneventures/policy given today's real repository state", async () => {
    const report = await preflightPackage(repoRoot, join(repoRoot, "packages", "policy"), {
      scope: SCOPE,
    });

    expect(report.packageName).toBe("@vespeneventures/policy");
    // policy has zero dependencies to trip the round trip, and its own
    // dependency graph is clean, so both halves pass today.
    expect(report.catalogFindings).toEqual([]);
    expect(report.roundTrip.ok).toBe(true);
    expect(report.ok).toBe(true);
  });

});

describe("combinePreflightOk — exhaustive truth table (regression for a flipped &&/|| or an inverted !)", () => {
  // The pre-existing end-to-end test above only ever exercised
  // (hasCatalogError: false, roundTripOk: true) -- `!false && true`, i.e.
  // `true && true`. That single point cannot distinguish `&&` from `||`
  // (both give `true` there), nor catch a dropped `!` combined with a
  // flipped operator. Each row below makes at least one operand the sole
  // reason the result is `false`, which a masked `true && true` never can.
  it.each([
    [false, true, true],
    [false, false, false],
    [true, true, false],
    [true, false, false],
  ])("hasCatalogError=%s, roundTripOk=%s -> ok=%s", (hasCatalogError, roundTripOk, expected) => {
    expect(combinePreflightOk(hasCatalogError, roundTripOk)).toBe(expected);
  });
});
