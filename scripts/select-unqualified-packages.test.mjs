import assert from "node:assert/strict";
import test from "node:test";
import { selectMissingQualification } from "./select-unqualified-packages.mjs";

// selectUnqualifiedPackages() itself is a thin pass-through over
// planQualifiedPublishSet(), which is already covered end-to-end by
// scripts/plan-qualified-publish-set.test.mjs's own classifyPackagesForPublish
// coverage (including a real, injectable fetchImpl seam). This suite covers
// the one thing genuinely new here: the missing-only filter.

function row(status, overrides = {}) {
  return { package: "app", name: "@example/app", version: "1.0.0", status, reason: "irrelevant", path: undefined, ...overrides };
}

test("selectMissingQualification: keeps only qualification-record-missing rows", () => {
  const report = [
    row("on-npm-already"),
    row("qualification-record-missing", { package: "b", name: "@example/b", version: "2.0.0" }),
    row("qualification-record-stale", { package: "c" }),
    row("qualification-record-indeterminate", { package: "d" }),
    row("eligible", { package: "e" }),
    row("registry-lookup-inconclusive", { package: undefined, name: "@example/f", version: undefined }),
  ];
  assert.deepEqual(selectMissingQualification(report), [{ package: "b", name: "@example/b", version: "2.0.0" }]);
});

test("selectMissingQualification: never selects a stale record for re-dispatch", () => {
  const report = [row("qualification-record-stale")];
  assert.deepEqual(selectMissingQualification(report), []);
});

test("selectMissingQualification: an empty report selects nothing", () => {
  assert.deepEqual(selectMissingQualification([]), []);
});
