import assert from "node:assert/strict";
import test from "node:test";

import { deprecationTarget, LEGACY_DEPRECATIONS, legacyDeprecationPlan, parseMode } from "./deprecate-legacy-packages.mjs";

test("deprecation plan is a closed mapping to governance subpaths", () => {
  assert.deepEqual(LEGACY_DEPRECATIONS.map(({ directory }) => directory), ["catalog", "gates", "release", "repository", "review"]);
  assert.deepEqual(legacyDeprecationPlan("@vespeneventures"), [
    { directory: "catalog", packageName: "@vespeneventures/catalog", message: "Deprecated: use @vespeneventures/governance/catalog instead." },
    { directory: "gates", packageName: "@vespeneventures/gates", message: "Deprecated: use @vespeneventures/governance/gates instead." },
    { directory: "release", packageName: "@vespeneventures/release", message: "Deprecated: use @vespeneventures/governance/release instead." },
    { directory: "repository", packageName: "@vespeneventures/repository", message: "Deprecated: use @vespeneventures/governance/repository instead." },
    { directory: "review", packageName: "@vespeneventures/review", message: "Deprecated: use @vespeneventures/governance/review instead." },
  ]);
});

test("only dry-run and apply are accepted", () => {
  assert.equal(parseMode(["--mode=dry-run"]), "dry-run");
  assert.equal(parseMode(["--mode=apply"]), "apply");
  assert.throws(() => parseMode(["--mode=apply", "--package=anything"]));
  assert.throws(() => parseMode(["--mode=delete"]));
});

test("registry notices are applied per discovered version, never through a wildcard", () => {
  assert.equal(deprecationTarget("@vespeneventures/catalog", "0.1.1"), "@vespeneventures/catalog@0.1.1");
  assert.throws(() => deprecationTarget("@vespeneventures/catalog", "*"));
  assert.throws(() => deprecationTarget("@vespeneventures/catalog", "0.1.1 --tag=latest"));
});
