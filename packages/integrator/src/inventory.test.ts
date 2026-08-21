import { describe, expect, it } from "vitest";
import { readInstalledInventory, readInstalledInventoryReport } from "./inventory.js";
import { createMemoryInventoryFileSystem } from "./memory-fs.test-helper.js";
import { IntegratorValidationError } from "./errors.js";

function lockfile(packages: Record<string, { version?: string }>): string {
  return JSON.stringify({ lockfileVersion: 3, packages: { "": {}, ...packages } });
}

function pnpmLockfile(dependencies: Record<string, string>): string {
  const entries = Object.entries(dependencies)
    .map(([name, version]) => `      ${/^[a-zA-Z0-9_-]+$/.test(name) ? name : `'${name}'`}:\n        specifier: ^1.0.0\n        version: ${version}`)
    .join("\n");
  return `importers:\n  .:\n    dependencies:\n${entries}\n`;
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

describe("readInstalledInventoryReport", () => {
  const options = {
    manifestPath: "/plane/package.json",
    npmLockfilePath: "/plane/package-lock.json",
    pnpmLockfilePath: "/plane/pnpm-lock.yaml",
  };

  it("reads an npm lockfile when only the npm lockfile is present (issue #330)", () => {
    const fs = createMemoryInventoryFileSystem({
      "/plane/package.json": JSON.stringify({ dependencies: { "@example-scope/one": "^1.0.0" } }),
      "/plane/package-lock.json": lockfile({ "node_modules/@example-scope/one": { version: "1.2.0" } }),
    });
    expect(readInstalledInventoryReport(fs, options)).toEqual({
      kind: "read",
      lockfileFormat: "npm",
      inventory: { packages: [{ name: "@example-scope/one", declaredRange: "^1.0.0", installedVersion: "1.2.0" }] },
    });
  });

  it("reads a pnpm lockfile when only the pnpm lockfile is present -- the gap issue #330 exists to close", () => {
    const fs = createMemoryInventoryFileSystem({
      "/plane/package.json": JSON.stringify({ dependencies: { "@example-scope/one": "^1.0.0" } }),
      "/plane/pnpm-lock.yaml": pnpmLockfile({ "@example-scope/one": "1.2.0" }),
    });
    expect(readInstalledInventoryReport(fs, options)).toEqual({
      kind: "read",
      lockfileFormat: "pnpm",
      inventory: { packages: [{ name: "@example-scope/one", declaredRange: "^1.0.0", installedVersion: "1.2.0" }] },
    });
  });

  it("reports ambiguous-lockfile-format, and reads neither, when both lockfiles are present", () => {
    const fs = createMemoryInventoryFileSystem({
      "/plane/package.json": JSON.stringify({ dependencies: { "@example-scope/one": "^1.0.0" } }),
      "/plane/package-lock.json": lockfile({ "node_modules/@example-scope/one": { version: "1.2.0" } }),
      "/plane/pnpm-lock.yaml": pnpmLockfile({ "@example-scope/one": "1.2.0" }),
    });
    const result = readInstalledInventoryReport(fs, options);
    expect(result.kind).toBe("indeterminate");
    expect(result).toMatchObject({ kind: "indeterminate", reason: "ambiguous-lockfile-format" });
  });

  it("reports lockfile-not-found, never an empty 'nothing installed' inventory, when neither lockfile exists", () => {
    const fs = createMemoryInventoryFileSystem({
      "/plane/package.json": JSON.stringify({ dependencies: { "@example-scope/one": "^1.0.0" } }),
    });
    expect(readInstalledInventoryReport(fs, options)).toMatchObject({ kind: "indeterminate", reason: "lockfile-not-found" });
  });

  it("reports lockfile-invalid, never an empty 'nothing installed' inventory, for a present but unparseable pnpm lockfile (the core of issue #330)", () => {
    const fs = createMemoryInventoryFileSystem({
      "/plane/package.json": JSON.stringify({ dependencies: { "@example-scope/one": "^1.0.0" } }),
      "/plane/pnpm-lock.yaml": "not: [valid, - shape\n  - broken\n",
    });
    const result = readInstalledInventoryReport(fs, options);
    expect(result).toMatchObject({ kind: "indeterminate", reason: "lockfile-invalid" });
    expect((result as { detail?: string }).detail).toBeTruthy();
  });

  it("reports lockfile-invalid for a present but unparseable npm lockfile, distinctly from lockfile-not-found", () => {
    const fs = createMemoryInventoryFileSystem({
      "/plane/package.json": JSON.stringify({ dependencies: { "@example-scope/one": "^1.0.0" } }),
      "/plane/package-lock.json": "{ not valid json",
    });
    expect(readInstalledInventoryReport(fs, options)).toMatchObject({ kind: "indeterminate", reason: "lockfile-invalid" });
  });

  it("reports manifest-not-found when the manifest itself is missing", () => {
    const fs = createMemoryInventoryFileSystem({ "/plane/package-lock.json": lockfile({}) });
    expect(readInstalledInventoryReport(fs, options)).toMatchObject({ kind: "indeterminate", reason: "manifest-not-found" });
  });

  it("reports manifest-invalid, never throws, for a manifest that does not parse as JSON", () => {
    const fs = createMemoryInventoryFileSystem({
      "/plane/package.json": "{ not valid json",
      "/plane/package-lock.json": lockfile({}),
    });
    expect(() => readInstalledInventoryReport(fs, options)).not.toThrow();
    expect(readInstalledInventoryReport(fs, options)).toMatchObject({ kind: "indeterminate", reason: "manifest-invalid" });
  });

  it("never throws for any of the indeterminate cases above -- detectSupersession's discipline, applied here", () => {
    const emptyFs = createMemoryInventoryFileSystem({});
    expect(() => readInstalledInventoryReport(emptyFs, options)).not.toThrow();
  });

  it("omits a declared package with no matching pnpm resolution, mirroring the npm reader", () => {
    const fs = createMemoryInventoryFileSystem({
      "/plane/package.json": JSON.stringify({ dependencies: { "@example-scope/one": "^1.0.0" } }),
      "/plane/pnpm-lock.yaml": "importers:\n  .:\n    dependencies: {}\n",
    });
    expect(readInstalledInventoryReport(fs, options)).toEqual({
      kind: "read",
      lockfileFormat: "pnpm",
      inventory: { packages: [] },
    });
  });
});
