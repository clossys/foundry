import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { combinePreflightOk, preflightPackage } from "./preflight.js";

// Real end-to-end proof, not a fixture: root is this repository's real
// workspace root, and packageDir is the real packages/controller directory.
//
// This used to target packages/policy, back when policy was its own
// zero-external-dependency package — the one package in the workspace whose
// packed tarball could be installed in a genuinely isolated directory with
// no network resolution beyond npm itself. Since issue #282 folded policy's
// source into @clossys/controller as its `./policy` subpath, the
// deprecated `@example/policy` compatibility stub now depends on
// `@clossys/controller` — a real dependency a truly isolated
// install cannot resolve until controller itself is published. Controller
// inherited the zero-external-dependency property policy used to hold this
// place with, so this test now targets controller instead.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

// Read the scope from package-scope.json rather than hardcoding it: a bare
// scope literal is not rewritten by set-scope.mjs (which rewrites scopes in
// package NAMES, not one passed as a VALUE), and a stale one fails silently.
const SCOPE = JSON.parse(readFileSync(join(repoRoot, "package-scope.json"), "utf8")).scope;

describe("preflightPackage — real end-to-end against packages/controller", () => {
  // controller ships many more exports subpaths than policy did, so the real
  // npm install + per-subpath import checks inside packRoundTrip (which this
  // wraps) take longer than the suite's default 5s timeout — see
  // pack-round-trip.test.ts's own equivalent test for the full list.
  it("reports ok:true for @clossys/controller given today's real repository state", { timeout: 60_000 }, async () => {
    const report = await preflightPackage(repoRoot, join(repoRoot, "packages", "controller"), {
      scope: SCOPE,
    });

    expect(report.packageName).toBe("@clossys/controller");
    // controller has zero unconditional runtime dependencies to trip the
    // round trip, and its own dependency graph is clean, so both halves
    // pass today.
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
    [false, true, true, true],
    [false, true, false, false],
    [false, false, true, false],
    [true, true, true, false],
    [true, false, false, false],
  ])("hasCatalogError=%s, roundTripOk=%s, authorityOk=%s -> ok=%s", (hasCatalogError, roundTripOk, authorityOk, expected) => {
    expect(combinePreflightOk(hasCatalogError, roundTripOk, authorityOk)).toBe(expected);
  });
});
