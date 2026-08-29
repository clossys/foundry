import assert from "node:assert/strict";
import test from "node:test";

import { discoverPackageManifests, orderByDependency, registryProbeOptions, selectMissingPackages } from "./select-publishable-packages.mjs";
import { GITHUB_PACKAGES_REGISTRY } from "./registry-version-lookup.mjs";

function discover({ directories, current = {} }) {
  return discoverPackageManifests({
    packagesRoot: "packages",
    listDirectories: () => directories,
    manifestExists: (path) => Object.hasOwn(current, path),
    currentManifest: (path) => current[path],
  });
}

// -------------------------------------------------------------------- discoverPackageManifests

test("discoverPackageManifests: reads every non-private manifest under packages/", () => {
  const { entries, fatal } = discover({
    directories: ["app", "core"],
    current: {
      "packages/app/package.json": { name: "@example/app", version: "1.0.0" },
      "packages/core/package.json": { name: "@example/core", version: "1.0.0" },
    },
  });
  assert.equal(fatal, null);
  assert.deepEqual(entries, [
    { directory: "app", manifest: { name: "@example/app", version: "1.0.0" } },
    { directory: "core", manifest: { name: "@example/core", version: "1.0.0" } },
  ]);
});

test("discoverPackageManifests: skips a directory with no package.json", () => {
  const { entries, fatal } = discover({ directories: ["ghost"], current: {} });
  assert.equal(fatal, null);
  assert.deepEqual(entries, []);
});

test("discoverPackageManifests: skips a private:true package entirely", () => {
  const { entries } = discover({
    directories: ["incubating"],
    current: { "packages/incubating/package.json": { name: "@example/incubating", version: "0.0.1", private: true } },
  });
  assert.deepEqual(entries, []);
});

test("discoverPackageManifests: an unparseable manifest is fatal, never silently skipped", () => {
  const { entries, fatal } = discoverPackageManifests({
    packagesRoot: "packages",
    listDirectories: () => ["broken"],
    manifestExists: () => true,
    currentManifest: () => {
      throw new SyntaxError("Unexpected token");
    },
  });
  assert.deepEqual(entries, []);
  assert.match(fatal, /does not parse as JSON/);
});

test("discoverPackageManifests: a manifest with no valid name/version is fatal", () => {
  const { entries, fatal } = discover({
    directories: ["bad"],
    current: { "packages/bad/package.json": { version: "1.0.0" } },
  });
  assert.deepEqual(entries, []);
  assert.match(fatal, /no valid string "name" and "version"/);
});

// -------------------------------------------------------------------- selectMissingPackages

function entry(name, version, extra = {}) {
  return { directory: name, manifest: { name: `@example/${name}`, version, ...extra } };
}

test("selectMissingPackages: a version absent from the registry is missing (publishable)", () => {
  const entries = [entry("app", "1.0.0")];
  const verdicts = new Map([["@example/app", { kind: "missing" }]]);
  const { missing, published, inconclusive, anyKnown } = selectMissingPackages(entries, verdicts);
  assert.deepEqual(missing, entries);
  assert.deepEqual(published, []);
  assert.deepEqual(inconclusive, []);
  assert.equal(anyKnown, true);
});

test("selectMissingPackages: a version already on the registry is published, not selected", () => {
  const entries = [entry("app", "1.0.0")];
  const verdicts = new Map([["@example/app", { kind: "published" }]]);
  const { missing, published, anyKnown } = selectMissingPackages(entries, verdicts);
  assert.deepEqual(missing, []);
  assert.deepEqual(published, entries);
  assert.equal(anyKnown, true);
});

test("selectMissingPackages: an unauthenticated verdict is inconclusive, never treated as missing", () => {
  const entries = [entry("app", "1.0.0")];
  const verdicts = new Map([["@example/app", { kind: "unauthenticated" }]]);
  const { missing, inconclusive, anyKnown } = selectMissingPackages(entries, verdicts);
  assert.deepEqual(missing, []);
  assert.deepEqual(inconclusive, [{ name: "@example/app", kind: "unauthenticated" }]);
  assert.equal(anyKnown, false);
});

test("selectMissingPackages: an unreachable verdict is inconclusive, never treated as missing", () => {
  const entries = [entry("app", "1.0.0")];
  const verdicts = new Map([["@example/app", { kind: "unreachable" }]]);
  const { missing, inconclusive, anyKnown } = selectMissingPackages(entries, verdicts);
  assert.deepEqual(missing, []);
  assert.deepEqual(inconclusive, [{ name: "@example/app", kind: "unreachable" }]);
  assert.equal(anyKnown, false);
});

test("selectMissingPackages: the batch-ambiguity case — one confirmed package alongside one inconclusive package still reports anyKnown, and only selects the confirmed one", () => {
  const entries = [entry("known", "1.0.0"), entry("ambiguous", "1.0.0")];
  const verdicts = new Map([
    ["@example/known", { kind: "missing" }],
    ["@example/ambiguous", { kind: "unreachable" }],
  ]);
  const { missing, inconclusive, anyKnown } = selectMissingPackages(entries, verdicts);
  assert.deepEqual(missing, [entries[0]]);
  assert.deepEqual(inconclusive, [{ name: "@example/ambiguous", kind: "unreachable" }]);
  assert.equal(anyKnown, true);
});

test("selectMissingPackages: no verdict at all for a package is inconclusive, never silently dropped", () => {
  const entries = [entry("app", "1.0.0")];
  const { missing, inconclusive, anyKnown } = selectMissingPackages(entries, new Map());
  assert.deepEqual(missing, []);
  assert.equal(inconclusive.length, 1);
  assert.equal(inconclusive[0].name, "@example/app");
  assert.equal(anyKnown, false);
});

// -------------------------------------------------------------------- registryProbeOptions

test("registryProbeOptions: public npmjs is anonymous only for the exact public identity", () => {
  assert.deepEqual(registryProbeOptions({ scope: "@clossys", registry: "https://registry.npmjs.org", access: "public" }, {}), {
    owner: "clossys",
    registry: "https://registry.npmjs.org",
  });
  assert.match(
    registryProbeOptions({ scope: "@clossys", registry: "https://registry.npmjs.org" }, {}).fatal,
    /unsupported release identity/,
  );
});

test("registryProbeOptions: GitHub Packages preserves its credential requirement", () => {
  assert.match(
    registryProbeOptions({ scope: "@example", registry: GITHUB_PACKAGES_REGISTRY }, {}).fatal,
    /GH_PACKAGES_TOKEN is not set/,
  );
  assert.deepEqual(
    registryProbeOptions({ scope: "@example", registry: GITHUB_PACKAGES_REGISTRY }, { GH_PACKAGES_TOKEN: "fixture-token" }),
    { owner: "example", registry: GITHUB_PACKAGES_REGISTRY, token: "fixture-token" },
  );
});

// -------------------------------------------------------------------- orderByDependency

test("orderByDependency: orders a dependent after its first-party dependency", () => {
  const ordered = orderByDependency([
    entry("app", "1.0.0", { dependencies: { "@example/core": "^1.0.0" } }),
    entry("core", "1.0.0"),
  ]);
  assert.deepEqual(ordered, [{ package: "core" }, { package: "app" }]);
});

test("orderByDependency: a cyclic first-party dependency set throws rather than silently ordering something", () => {
  assert.throws(
    () =>
      orderByDependency([
        entry("a", "1.0.0", { dependencies: { "@example/b": "^1.0.0" } }),
        entry("b", "1.0.0", { dependencies: { "@example/a": "^1.0.0" } }),
      ]),
    /cyclic first-party dependency set/,
  );
});

test("orderByDependency: independent packages are ordered alphabetically for determinism", () => {
  const ordered = orderByDependency([entry("zeta", "1.0.0"), entry("alpha", "1.0.0")]);
  assert.deepEqual(ordered, [{ package: "alpha" }, { package: "zeta" }]);
});
