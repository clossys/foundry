import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertPackageAuthorized, filterPackagesForTarget, loadReleaseCatalog, readCurrentReleaseIdentity, resolveReleaseTarget } from "./check-release-catalog.mjs";

const currentIdentity = { scope: "@vespeneventures", registry: "https://npm.pkg.github.com" };
const targetIdentity = { scope: "@clossys", registry: "https://registry.npmjs.org" };
const cutoverIdentity = { ...targetIdentity, access: "public" };
const launchPackages = ["advisor", "starter", "controller", "designer"];
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const catalogCli = join(scriptsDir, "check-release-catalog.mjs");

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

function cutoverCatalog(overrides = {}) {
  return {
    schemaVersion: 2,
    defaultTarget: "clossys-npmjs",
    targets: [
      { id: "current-github-packages", status: "historical", scope: currentIdentity.scope, registry: currentIdentity.registry, packages: "all" },
      { id: "clossys-npmjs", status: "active", scope: targetIdentity.scope, registry: targetIdentity.registry, access: "public", packages: [...launchPackages] },
    ],
    ...overrides,
  };
}

function load(value) {
  return loadReleaseCatalog({ path: "catalog.json", readFile: () => JSON.stringify(value) });
}

function runCli({ catalogContents, catalogPresent = true, scopeContents, scopePresent = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "release-catalog-cli-"));
  try {
    if (scopePresent) writeFileSync(join(root, "package-scope.json"), scopeContents ?? JSON.stringify(currentIdentity));
    if (catalogPresent) writeFileSync(join(root, "release-catalog.json"), catalogContents ?? JSON.stringify(catalog()));
    return spawnSync(process.execPath, [catalogCli, "--catalog", join(root, "release-catalog.json"), "--scope-file", join(root, "package-scope.json")], { encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

test("the pre-cutover target can never be an implicit default", () => {
  assert.throws(() => load(catalog({ defaultTarget: "clossys-npmjs-precutover" })), /active all-package default target/);
});

test("the catalog rejects active migration targets and any migration target that broadens to all packages", () => {
  assert.throws(
    () =>
      load(
        catalog({
          targets: [
            { id: "current-github-packages", status: "active", scope: currentIdentity.scope, registry: currentIdentity.registry, packages: "all" },
            { id: "clossys-npmjs-precutover", status: "active", scope: targetIdentity.scope, registry: targetIdentity.registry, packages: "all" },
          ],
        }),
      ),
    /must retain the exact planned/,
  );
  assert.throws(
    () =>
      load(
        catalog({
          targets: [
            { id: "current-github-packages", status: "active", scope: currentIdentity.scope, registry: currentIdentity.registry, packages: "all" },
            { id: "migration", status: "active", scope: targetIdentity.scope, registry: targetIdentity.registry, packages: "all" },
            { id: "clossys-npmjs-precutover", status: "planned", scope: targetIdentity.scope, registry: targetIdentity.registry, packages: ["advisor", "starter", "controller"] },
          ],
        }),
      ),
    /must declare exactly the current release target/,
  );
});

test("an implicit selection resolves only the current target", () => {
  const document = load(catalog());
  assert.equal(resolveReleaseTarget(document, currentIdentity).id, "current-github-packages");
  assert.throws(() => resolveReleaseTarget(document, targetIdentity), /expects @vespeneventures/);
});

test("the post-recut catalogue defaults to the launch Trio followed by Designer", () => {
  const document = load(cutoverCatalog());
  const target = resolveReleaseTarget(document, cutoverIdentity);
  assert.equal(target.id, "clossys-npmjs");
  assert.deepEqual(target.packages, launchPackages);
  assert.equal(target.access, "public");
  const entries = ["advisor", "architect", "starter", "controller", "designer"].map((directory) => ({ directory }));
  assert.deepEqual(filterPackagesForTarget(entries, target).map((entry) => entry.directory), launchPackages);
  assert.throws(() => assertPackageAuthorized(target, "architect"), /not authorized/);
  assert.throws(() => resolveReleaseTarget(document, currentIdentity, "current-github-packages"), /historical/);
});

test("the launch target emits declared Trio-then-Designer order rather than caller inventory order", () => {
  const target = resolveReleaseTarget(load(cutoverCatalog()), cutoverIdentity);
  const entries = ["designer", "controller", "architect", "advisor", "starter"].map((directory) => ({ directory }));
  assert.deepEqual(filterPackagesForTarget(entries, target).map((entry) => entry.directory), launchPackages);
});

test("candidate catalogue rejects mixed access, broadened or changed launch packages, old default, or retained precutover target", () => {
  for (const document of [
    cutoverCatalog({ targets: [cutoverCatalog().targets[0], { ...cutoverCatalog().targets[1], access: undefined }] }),
    cutoverCatalog({ targets: [cutoverCatalog().targets[0], { ...cutoverCatalog().targets[1], packages: "all" }] }),
    cutoverCatalog({ targets: [cutoverCatalog().targets[0], { ...cutoverCatalog().targets[1], packages: ["starter", "advisor", "controller"] }] }),
    cutoverCatalog({ targets: [cutoverCatalog().targets[0], { ...cutoverCatalog().targets[1], packages: ["advisor", "starter"] }] }),
    cutoverCatalog({ targets: [cutoverCatalog().targets[0], { ...cutoverCatalog().targets[1], packages: ["advisor", "starter", "controller", "architect"] }] }),
    cutoverCatalog({ targets: [cutoverCatalog().targets[0], { ...cutoverCatalog().targets[1], packages: ["advisor", "starter", "controller"] }] }),
    cutoverCatalog({ defaultTarget: "current-github-packages" }),
    cutoverCatalog({ targets: [...cutoverCatalog().targets, catalog().targets[1]] }),
  ]) {
    assert.throws(() => load(document), /candidate state/);
  }
  assert.throws(
    () =>
      load(
        cutoverCatalog({
          targets: [
            cutoverCatalog().targets[0],
            { ...cutoverCatalog().targets[1], packages: ["advisor", "advisor", "controller"] },
          ],
        }),
      ),
    /non-empty unique package-directory list/,
  );
});

test("the current target cannot be repurposed as an implicit migration lane", () => {
  const repurposed = catalog({
    targets: [
      { id: "current-github-packages", status: "active", scope: targetIdentity.scope, registry: targetIdentity.registry, packages: "all" },
      { id: "clossys-npmjs-precutover", status: "planned", scope: targetIdentity.scope, registry: targetIdentity.registry, packages: ["advisor", "starter", "controller"] },
    ],
  });
  assert.throws(() => load(repurposed), /active all-package default target/);

  const implicit = runCli({ catalogContents: JSON.stringify(repurposed), scopeContents: JSON.stringify(targetIdentity) });
  assert.equal(implicit.status, 1, implicit.stderr || implicit.stdout);
  assert.match(implicit.stderr, /active all-package default target/);
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

test("catalog CLI distinguishes unreadable and malformed input from a semantic violation", () => {
  const missing = runCli({ catalogPresent: false });
  assert.equal(missing.status, 2, missing.stderr || missing.stdout);
  assert.match(missing.stderr, /cannot read/);

  const malformed = runCli({ catalogContents: "{" });
  assert.equal(malformed.status, 2, malformed.stderr || malformed.stdout);
  assert.match(malformed.stderr, /does not parse/);

  const semantic = runCli({ catalogContents: JSON.stringify(catalog({ defaultTarget: "clossys-npmjs-precutover" })) });
  assert.equal(semantic.status, 1, semantic.stderr || semantic.stdout);
  assert.match(semantic.stderr, /active all-package default target/);
});

test("package-scope CLI input uses indeterminate exits while semantic identity drift remains violated", () => {
  const missing = runCli({ scopePresent: false });
  assert.equal(missing.status, 2, missing.stderr || missing.stdout);
  assert.match(missing.stderr, /cannot read/);

  const malformed = runCli({ scopeContents: "{" });
  assert.equal(malformed.status, 2, malformed.stderr || malformed.stdout);
  assert.match(malformed.stderr, /does not parse/);

  const semantic = runCli({ scopeContents: JSON.stringify({ scope: "not-an-npm-scope", registry: currentIdentity.registry }) });
  assert.equal(semantic.status, 1, semantic.stderr || semantic.stdout);
  assert.match(semantic.stderr, /valid npm scope/);
});

test("target catalogue refuses a missing authorized package instead of silently publishing fewer packages", () => {
  const target = resolveReleaseTarget(load(catalog()), targetIdentity, "clossys-npmjs-precutover");
  assert.throws(() => filterPackagesForTarget([{ directory: "advisor" }, { directory: "controller" }], target), /authorizes missing packages\/starter/);
});

test("the active launch target refuses a missing authorized member rather than selecting a partial set", () => {
  const target = resolveReleaseTarget(load(cutoverCatalog()), cutoverIdentity);
  assert.throws(
    () => filterPackagesForTarget([{ directory: "advisor" }, { directory: "starter" }, { directory: "controller" }], target),
    /authorizes missing packages\/designer/,
  );
});

test("current release identity itself is validated before a target is resolved", () => {
  assert.deepEqual(readCurrentReleaseIdentity({ path: "scope.json", readFile: () => JSON.stringify(currentIdentity) }), currentIdentity);
  assert.throws(() => readCurrentReleaseIdentity({ path: "scope.json", readFile: () => JSON.stringify({ scope: "vespeneventures", registry: currentIdentity.registry }) }), /valid npm scope/);
  assert.deepEqual(readCurrentReleaseIdentity({ path: "scope.json", readFile: () => JSON.stringify(cutoverIdentity) }), cutoverIdentity);
  assert.throws(() => readCurrentReleaseIdentity({ path: "scope.json", readFile: () => JSON.stringify({ ...targetIdentity, access: "restricted" }) }), /access must be/);
});
