import { describe, expect, it } from "vitest";
import { readInstalledInventory } from "./inventory.js";
import { createMemoryInventoryFileSystem } from "./memory-fs.test-helper.js";
import { IntegratorValidationError } from "./errors.js";

function lockfile(packages: Record<string, { version?: string }>): string {
  return JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...packages } });
}

describe("readInstalledInventory", () => {
  it("reports a package declared in the manifest and resolved in the lockfile", () => {
    const fs = createMemoryInventoryFileSystem({
      "/plane/package.json": JSON.stringify({ dependencies: { "@example-scope/one": "^1.0.0" } }),
      "/plane/package-lock.json": lockfile({ "node_modules/@example-scope/one": { version: "1.2.0" } }),
    });
    const inventory = readInstalledInventory(fs, { manifestPath: "/plane/package.json", lockfilePath: "/plane/package-lock.json" });
    expect(inventory.packages).toEqual([{ name: "@example-scope/one", declaredRange: "^1.0.0", installedVersion: "1.2.0" }]);
  });

  it("omits a declared package with no matching lockfile resolution -- declared is not installed", () => {
    const fs = createMemoryInventoryFileSystem({
      "/plane/package.json": JSON.stringify({ dependencies: { "@example-scope/one": "^1.0.0" } }),
      "/plane/package-lock.json": lockfile({}),
    });
    const inventory = readInstalledInventory(fs, { manifestPath: "/plane/package.json", lockfilePath: "/plane/package-lock.json" });
    expect(inventory.packages).toEqual([]);
  });

  it("prefers a dependencies range over a duplicate declared in devDependencies", () => {
    const fs = createMemoryInventoryFileSystem({
      "/plane/package.json": JSON.stringify({
        devDependencies: { "@example-scope/one": "^0.9.0" },
        dependencies: { "@example-scope/one": "^1.0.0" },
      }),
      "/plane/package-lock.json": lockfile({ "node_modules/@example-scope/one": { version: "1.0.0" } }),
    });
    const inventory = readInstalledInventory(fs, { manifestPath: "/plane/package.json", lockfilePath: "/plane/package-lock.json" });
    expect(inventory.packages).toEqual([{ name: "@example-scope/one", declaredRange: "^1.0.0", installedVersion: "1.0.0" }]);
  });

  it("reads the top-level node_modules resolution, not a nested one under another package", () => {
    const fs = createMemoryInventoryFileSystem({
      "/plane/package.json": JSON.stringify({ dependencies: { "@example-scope/one": "^1.0.0" } }),
      "/plane/package-lock.json": lockfile({
        "node_modules/@example-scope/one": { version: "1.5.0" },
        "node_modules/@example-scope/other/node_modules/@example-scope/one": { version: "0.1.0" },
      }),
    });
    const inventory = readInstalledInventory(fs, { manifestPath: "/plane/package.json", lockfilePath: "/plane/package-lock.json" });
    expect(inventory.packages).toEqual([{ name: "@example-scope/one", declaredRange: "^1.0.0", installedVersion: "1.5.0" }]);
  });

  it("throws when the manifest is missing", () => {
    const fs = createMemoryInventoryFileSystem({ "/plane/package-lock.json": lockfile({}) });
    expect(() => readInstalledInventory(fs, { manifestPath: "/plane/package.json", lockfilePath: "/plane/package-lock.json" })).toThrow(IntegratorValidationError);
  });

  it("throws when the lockfile is missing", () => {
    const fs = createMemoryInventoryFileSystem({ "/plane/package.json": JSON.stringify({}) });
    expect(() => readInstalledInventory(fs, { manifestPath: "/plane/package.json", lockfilePath: "/plane/package-lock.json" })).toThrow(IntegratorValidationError);
  });

  it("throws on a lockfile with no packages map (an unsupported lockfileVersion)", () => {
    const fs = createMemoryInventoryFileSystem({
      "/plane/package.json": JSON.stringify({ dependencies: { "@example-scope/one": "^1.0.0" } }),
      "/plane/package-lock.json": JSON.stringify({ lockfileVersion: 1, dependencies: {} }),
    });
    expect(() => readInstalledInventory(fs, { manifestPath: "/plane/package.json", lockfilePath: "/plane/package-lock.json" })).toThrow(/packages/);
  });
});
