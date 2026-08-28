import assert from "node:assert/strict";
import test from "node:test";

import { assertPackageAuthorized, filterPackagesForTarget, loadReleaseCatalog, readCurrentReleaseIdentity, resolveReleaseTarget } from "./check-release-catalog.mjs";

const currentIdentity = { scope: "@vespeneventures", registry: "https://npm.pkg.github.com" };
const targetIdentity = { scope: "@clossys", registry: "https://registry.npmjs.org" };

function catalog(overrides = {}) {
  return {
    schemaVersion: 1,
    defaultTarget: "current-github-packages",
    targets: [
      { id: "current-github-packages", status: "active", scope: currentIdentity.scope, registry: currentIdentity.registry, packages: "all" },
      { id: "clossys-npmjs-precutover", status: "planned", scope: targetIdentity.scope, registry: targetIdentity.registry, packages: ["advisor", "starter", "controller"] },
    ],
    ...overrides,
  };
}

function load(value) {
  return loadReleaseCatalog({ path: "catalog.json", readFile: () => JSON.stringify(value) });
}

test("default current release selection remains all-package GitHub Packages behavior", () => {
  const target = resolveReleaseTarget(load(catalog()), currentIdentity);
  const entries = ["advisor", "architect", "starter", "controller"].map((directory) => ({ directory, manifest: { name: `@vespeneventures/${directory}`, version: "0.1.0" } }));
  assert.equal(target.id, "current-github-packages");
  assert.deepEqual(filterPackagesForTarget(entries, target), entries);
  assert.doesNotThrow(() => assertPackageAuthorized(target, "architect"));
});

test("the explicit future target selects only the authorized Trio", () => {
  const target = resolveReleaseTarget(load(catalog()), targetIdentity, "clossys-npmjs-precutover");
  const entries = ["advisor", "architect", "starter", "controller"].map((directory) => ({ directory, manifest: { name: `@clossys/${directory}`, version: "0.1.0" } }));
  assert.deepEqual(filterPackagesForTarget(entries, target).map((entry) => entry.directory), ["advisor", "starter", "controller"]);
});

test("the future target rejects a non-catalog package rather than publishing it", () => {
  const target = resolveReleaseTarget(load(catalog()), targetIdentity, "clossys-npmjs-precutover");
  assert.throws(() => assertPackageAuthorized(target, "architect"), /not authorized/);
});

test("a scope switch cannot implicitly retain the current all-package target", () => {
  const document = load(catalog());
  assert.throws(() => resolveReleaseTarget(document, targetIdentity), /expects @vespeneventures/);
  assert.equal(resolveReleaseTarget(document, targetIdentity, "clossys-npmjs-precutover").id, "clossys-npmjs-precutover");
});

test("missing or malformed catalogues fail closed", () => {
  assert.throws(() => loadReleaseCatalog({ path: "missing.json", readFile: () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; } }), /cannot read/);
  assert.throws(() => loadReleaseCatalog({ path: "broken.json", readFile: () => "{" }), /does not parse/);
  assert.throws(() => load(catalog({ targets: [] })), /non-empty targets/);
  assert.throws(() => load(catalog({ targets: [{ id: "bad", status: "planned", scope: "@clossys", registry: "http://registry.npmjs.org", packages: [] }] })), /must declare status/);
  assert.throws(
    () =>
      load(
        catalog({
          targets: [
            { id: "current-github-packages", status: "active", scope: currentIdentity.scope, registry: currentIdentity.registry, packages: "all" },
            { id: "clossys-npmjs-precutover", status: "planned", scope: targetIdentity.scope, registry: targetIdentity.registry, packages: ["advisor", "controller"] },
          ],
        }),
      ),
    /planned targets must exactly declare the bounded/,
  );
});

test("target catalogue refuses a missing authorized package instead of silently publishing fewer packages", () => {
  const target = resolveReleaseTarget(load(catalog()), targetIdentity, "clossys-npmjs-precutover");
  assert.throws(() => filterPackagesForTarget([{ directory: "advisor" }, { directory: "controller" }], target), /authorizes missing packages\/starter/);
});

test("current release identity itself is validated before a target is resolved", () => {
  assert.deepEqual(readCurrentReleaseIdentity({ path: "scope.json", readFile: () => JSON.stringify(currentIdentity) }), currentIdentity);
  assert.throws(() => readCurrentReleaseIdentity({ path: "scope.json", readFile: () => JSON.stringify({ scope: "vespeneventures", registry: currentIdentity.registry }) }), /valid npm scope/);
});
