import { describe, expect, it } from "vitest";
import { parsePnpmRootImporterVersions } from "./pnpm-lockfile.js";
import { IntegratorValidationError } from "./errors.js";

const REALISTIC_LOCKFILE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      '@example-scope/one':
        specifier: ^1.0.0
        version: 1.2.0
      lodash:
        specifier: ^4.17.0
        version: 4.17.21
    devDependencies:
      typescript:
        specifier: ~5.9.0
        version: 5.9.2

packages:

  '@example-scope/one@1.2.0':
    resolution: {integrity: sha512-abc123==}

  lodash@4.17.21:
    resolution: {integrity: sha512-def456==}

  typescript@5.9.2:
    resolution: {integrity: sha512-ghi789==}
`;

describe("parsePnpmRootImporterVersions", () => {
  it("reads the root importer's resolved dependency versions across dependencies and devDependencies", () => {
    const versions = parsePnpmRootImporterVersions(REALISTIC_LOCKFILE);
    expect(versions.get("@example-scope/one")).toBe("1.2.0");
    expect(versions.get("lodash")).toBe("4.17.21");
    expect(versions.get("typescript")).toBe("5.9.2");
    expect(versions.size).toBe(3);
  });

  it("prefers a dependencies version over a duplicate declared in devDependencies, same precedence as the manifest reader", () => {
    const lockfile = `importers:
  .:
    devDependencies:
      example:
        specifier: ^0.9.0
        version: 0.9.0
    dependencies:
      example:
        specifier: ^1.0.0
        version: 1.0.0
`;
    const versions = parsePnpmRootImporterVersions(lockfile);
    expect(versions.get("example")).toBe("1.0.0");
  });

  it("skips a dependency entry with no version field, the same tolerance the npm reader extends to link/workspace entries", () => {
    const lockfile = `importers:
  .:
    dependencies:
      workspace-linked:
        specifier: workspace:*
`;
    const versions = parsePnpmRootImporterVersions(lockfile);
    expect(versions.size).toBe(0);
  });

  it("throws IntegratorValidationError when there is no importers section at all", () => {
    expect(() => parsePnpmRootImporterVersions("packages:\n  lodash@4.17.21:\n    resolution: {}\n")).toThrow(IntegratorValidationError);
    expect(() => parsePnpmRootImporterVersions("packages:\n  lodash@4.17.21:\n    resolution: {}\n")).toThrow(/importers/);
  });

  it("throws IntegratorValidationError when the importers section has no root (\".\") entry", () => {
    const lockfile = `importers:
  packages/other:
    dependencies:
      example:
        specifier: ^1.0.0
        version: 1.0.0
`;
    expect(() => parsePnpmRootImporterVersions(lockfile)).toThrow(/root.*importer/);
  });

  it("throws IntegratorValidationError on an unsupported sequence entry rather than silently skipping it", () => {
    const lockfile = `importers:
  .:
    dependencies:
      - example
`;
    expect(() => parsePnpmRootImporterVersions(lockfile)).toThrow(IntegratorValidationError);
  });

  it("throws IntegratorValidationError on a malformed line with no key", () => {
    const lockfile = `importers:
  .:
    dependencies:
      not a valid mapping line without a colon
`;
    expect(() => parsePnpmRootImporterVersions(lockfile)).toThrow(IntegratorValidationError);
  });

  it("returns an empty map, not a throw, when the root importer declares no dependency blocks at all", () => {
    const lockfile = `importers:
  .:
    dependenciesMeta: {}
`;
    const versions = parsePnpmRootImporterVersions(lockfile);
    expect(versions.size).toBe(0);
  });
});
