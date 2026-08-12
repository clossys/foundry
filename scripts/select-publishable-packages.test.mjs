import assert from "node:assert/strict";
import test from "node:test";

import { selectPublishablePackages } from "./select-publishable-packages.mjs";

function select({ changedPaths, current = {}, previous = {} }) {
  return selectPublishablePackages({
    changedPaths,
    manifestExists: (path) => Object.hasOwn(current, path),
    currentManifest: (path) => current[path],
    previousManifest: (path) => {
      if (!Object.hasOwn(previous, path)) throw new Error("manifest did not exist before");
      return previous[path];
    },
  });
}

test("does not schedule a deleted manifest for publication", () => {
  assert.deepEqual(select({
    changedPaths: ["packages/domain-model/package.json"],
    previous: { "packages/domain-model/package.json": { name: "@example/domain-model", version: "0.1.0" } },
  }), []);
});

test("selects added and version-changed manifests in dependency order", () => {
  assert.deepEqual(select({
    changedPaths: ["packages/app/package.json", "packages/core/package.json"],
    current: {
      "packages/app/package.json": { name: "@example/app", version: "1.0.0", dependencies: { "@example/core": "^1.0.0" } },
      "packages/core/package.json": { name: "@example/core", version: "1.0.0" },
    },
    previous: {
      "packages/app/package.json": { name: "@example/app", version: "0.9.0", dependencies: { "@example/core": "^0.9.0" } },
    },
  }), [{ package: "core" }, { package: "app" }]);
});

test("does not schedule a source-only manifest edit", () => {
  assert.deepEqual(select({
    changedPaths: ["packages/core/package.json"],
    current: { "packages/core/package.json": { name: "@example/core", version: "1.0.0" } },
    previous: { "packages/core/package.json": { name: "@example/core", version: "1.0.0" } },
  }), []);
});
