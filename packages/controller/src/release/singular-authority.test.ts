import { describe, expect, it } from "vitest";
import { checkSingularAuthority, singularAuthorityDeclarationFromManifest, type SingularAuthorityCheckInput } from "./singular-authority.js";

const declarations = [{ packageName: "@scope/controller", authority: "controller" }] as const;
const target = { authority: "controller", version: "0.8.19" } as const;

describe("singularAuthorityDeclarationFromManifest", () => {
  it("reads the small machine-readable declaration and rejects malformed authority claims", () => {
    expect(singularAuthorityDeclarationFromManifest({ name: "@scope/controller", foundry: { singularAuthority: "controller" } }))
      .toEqual({ packageName: "@scope/controller", authority: "controller" });
    expect(singularAuthorityDeclarationFromManifest({ name: "ordinary-library" })).toBeUndefined();
    expect(() => singularAuthorityDeclarationFromManifest({ name: "@scope/controller", foundry: { singularAuthority: "Controller" } }))
      .toThrow("foundry.singularAuthority");
  });
});

function npm(packages: Record<string, unknown>): SingularAuthorityCheckInput {
  return { lockfile: { format: "npm", content: JSON.stringify({ lockfileVersion: 3, packages }) }, declarations, target };
}

const NPM_CONVERGED = {
  "": { dependencies: { "@scope/builder": "^0.7.1" }, devDependencies: { "@scope/controller": "^0.8.0" } },
  "node_modules/@scope/builder": { version: "0.7.1", dependencies: { "@scope/controller": "^0.8.0" } },
  "node_modules/@scope/controller": { version: "0.8.19" },
};

describe("checkSingularAuthority — npm lockfile v2/v3 packages graph", () => {
  it("passes one compatible resolved authority version and reports both introducing edges", () => {
    const report = checkSingularAuthority(npm(NPM_CONVERGED));
    expect(report.ok).toBe(true);
    expect(report.results).toMatchObject([{ authority: "controller", status: "converged", ok: true }]);
    expect(report.results[0]!.resolved[0]).toMatchObject({ packageName: "@scope/controller", version: "0.8.19" });
    expect(report.results[0]!.resolved[0]!.introducedBy).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "root", dependency: "@scope/controller", range: "^0.8.0" }),
      expect.objectContaining({ from: "node_modules/@scope/builder", dependency: "@scope/controller", range: "^0.8.0" }),
    ]));
  });

  it("treats a real-shaped root devDependency or optionalDependency as an introducing edge", () => {
    const optional = checkSingularAuthority(npm({
      "": { optionalDependencies: { "@scope/controller": "^0.8.0" } },
      "node_modules/@scope/controller": { version: "0.8.19" },
    }));
    expect(optional.results[0]).toMatchObject({ status: "converged", ok: true });
    expect(optional.results[0]!.resolved[0]!.introducedBy).toMatchObject([{ from: "root", dependency: "@scope/controller", range: "^0.8.0" }]);
  });

  it("fails closed when root dependency sections disagree about one package", () => {
    const report = checkSingularAuthority(npm({
      "": { dependencies: { "@scope/controller": "^0.8.0" }, devDependencies: { "@scope/controller": "^0.7.0" } },
      "node_modules/@scope/controller": { version: "0.8.19" },
    }));
    expect(report).toMatchObject({ ok: false, results: [], findings: [{ code: "lockfile-unsupported" }] });
    expect(report.findings[0]!.message).toContain("inconsistently");
  });

  it("treats a non-root optional dependency as an introducing compatibility edge", () => {
    const report = checkSingularAuthority(npm({
      "": { dependencies: { "@scope/builder": "^0.7.0", "@scope/controller": "^0.8.0" } },
      "node_modules/@scope/builder": { version: "0.7.1", optionalDependencies: { "@scope/controller": "^0.7.0" } },
      "node_modules/@scope/controller": { version: "0.8.19" },
    }));
    expect(report.results[0]).toMatchObject({ status: "compatibility-update-required", findings: [{ code: "target-out-of-range" }] });
  });

  it("fails closed when a non-root package conflicts between dependency sections", () => {
    const report = checkSingularAuthority(npm({
      "": { dependencies: { "@scope/builder": "^0.7.0", "@scope/controller": "^0.8.0" } },
      "node_modules/@scope/builder": { version: "0.7.1", dependencies: { "@scope/controller": "^0.8.0" }, optionalDependencies: { "@scope/controller": "^0.7.0" } },
      "node_modules/@scope/controller": { version: "0.8.19" },
    }));
    expect(report).toMatchObject({ ok: false, results: [], findings: [{ code: "lockfile-unsupported" }] });
  });

  it("treats installed npm peerDependencies as introducing compatibility constraints", () => {
    const lock = (peerRange: string) => npm({
      "": { dependencies: { "@scope/builder": "^0.7.0", "@scope/controller": "^0.8.0" } },
      "node_modules/@scope/builder": { version: "0.7.1", peerDependencies: { "@scope/controller": peerRange } },
      "node_modules/@scope/controller": { version: "0.8.19" },
    });
    expect(checkSingularAuthority(lock("^0.7.0")).results[0]).toMatchObject({ status: "compatibility-update-required", findings: [{ code: "target-out-of-range" }] });
    const green = checkSingularAuthority(lock("^0.8.0"));
    expect(green.results[0]).toMatchObject({ status: "converged", ok: true });
    expect(green.results[0]!.resolved[0]!.introducedBy).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "node_modules/@scope/builder", dependency: "@scope/controller", range: "^0.8.0" }),
    ]));
  });

  it("rejects unmatched, duplicate, or lock-conflicting caller dependency constraints", () => {
    const input = npm(NPM_CONVERGED);
    const rootConstraint = { from: "root", dependency: "@scope/controller", range: "^0.8.0", to: "node_modules/@scope/controller" };
    expect(checkSingularAuthority({ ...input, dependencyConstraints: [{ ...rootConstraint, range: "^0.7.0" }] }))
      .toMatchObject({ ok: false, results: [], findings: [{ code: "constraint-lock-conflict" }] });
    expect(checkSingularAuthority({ ...input, dependencyConstraints: [{ ...rootConstraint, from: "missing" }] }))
      .toMatchObject({ ok: false, results: [], findings: [{ code: "constraint-unmatched" }] });
    expect(checkSingularAuthority({ ...input, dependencyConstraints: [rootConstraint, rootConstraint] }))
      .toMatchObject({ ok: false, results: [], findings: [{ code: "constraint-duplicate" }] });
  });

  it("requires npm lockfile v2 or v3 and never accepts an unresolved authority edge", () => {
    const unsupportedVersion = checkSingularAuthority({
      ...npm(NPM_CONVERGED),
      lockfile: { format: "npm", content: JSON.stringify({ lockfileVersion: 1, packages: NPM_CONVERGED }) },
    });
    expect(unsupportedVersion).toMatchObject({ ok: false, results: [], findings: [{ code: "lockfile-unsupported" }] });
    const unresolved = checkSingularAuthority(npm({
      "": { devDependencies: { "@scope/controller": "^0.8.0" } },
    }));
    expect(unresolved.results[0]).toMatchObject({ status: "indeterminate", findings: [{ code: "introducing-edge-unresolved" }] });
  });

  it("fails the legacy nested copy as an out-of-range compatibility update, while retaining both exact versions and edges", () => {
    const report = checkSingularAuthority(npm({
      "": { dependencies: { "@scope/builder": "^0.4.0", "@scope/controller": "^0.8.0" } },
      "node_modules/@scope/builder": { version: "0.4.0", dependencies: { "@scope/controller": "^0.7.0" } },
      "node_modules/@scope/controller": { version: "0.8.19" },
      "node_modules/@scope/builder/node_modules/@scope/controller": { version: "0.7.9" },
    }));
    expect(report.ok).toBe(false);
    expect(report.results[0]).toMatchObject({ status: "compatibility-update-required", ok: false });
    expect(report.results[0]!.resolved.map((entry) => [entry.version, entry.node])).toEqual([
      ["0.8.19", "node_modules/@scope/controller"],
      ["0.7.9", "node_modules/@scope/builder/node_modules/@scope/controller"],
    ]);
    expect(report.results[0]!.findings[0]!.message).toContain("^0.7.0");
  });

  it("fails an undisposed duplicate authority even when the frozen graph's recorded ranges do not explain the nested copy", () => {
    const report = checkSingularAuthority(npm({ ...NPM_CONVERGED, "node_modules/@scope/builder/node_modules/@scope/controller": { version: "0.7.9" } }));
    expect(report.ok).toBe(false);
    expect(report.results[0]).toMatchObject({ status: "unresolved-conflict", ok: false });
    expect(report.results[0]!.findings).toMatchObject([{ code: "duplicate-authority" }]);
  });

  it("evaluates every declaration even when only Controller has a target", () => {
    const report = checkSingularAuthority({
      ...npm({
        "": { dependencies: { "@scope/builder": "^0.7.0", "@scope/controller": "^0.8.0", "@scope/other": "^1.0.0" } },
        "node_modules/@scope/builder": { version: "0.7.1", dependencies: { "@scope/other": "^1.0.0" } },
        "node_modules/@scope/controller": { version: "0.8.19" },
        "node_modules/@scope/other": { version: "1.0.0" },
        "node_modules/@scope/builder/node_modules/@scope/other": { version: "1.1.0" },
      }),
      declarations: [...declarations, { packageName: "@scope/other", authority: "other" }],
    });
    expect(report.ok).toBe(false);
    expect(report.results.find((result) => result.authority === "controller")).toMatchObject({ status: "converged", ok: true });
    expect(report.results.find((result) => result.authority === "other")).toMatchObject({ status: "unresolved-conflict", ok: false });
  });

  it("keeps an out-of-range override indeterminate until executable compatibility proof exists", () => {
    const input = npm({
      "": { dependencies: { "@scope/builder": "^0.4.0", "@scope/controller": "^0.8.0" } },
      "node_modules/@scope/builder": { version: "0.4.0", dependencies: { "@scope/controller": "^0.7.0" } },
      "node_modules/@scope/controller": { version: "0.8.19" },
      "node_modules/@scope/builder/node_modules/@scope/controller": { version: "0.7.9" },
    });
    const report = checkSingularAuthority({ ...input, dispositions: [{ authority: "controller", node: "node_modules/@scope/builder/node_modules/@scope/controller", kind: "override", reference: "urn:example:override" }] });
    expect(report.ok).toBe(false);
    expect(report.results[0]).toMatchObject({ status: "override-proof-required", ok: false });
    expect(report.results[0]!.findings.map((finding) => finding.code)).toContain("target-out-of-range");
  });

  it("accepts an explicitly non-authoritative helper copy without calling it a single-version convergence", () => {
    const input = npm({ ...NPM_CONVERGED, "node_modules/@scope/builder/node_modules/@scope/controller": { version: "0.7.9" } });
    const report = checkSingularAuthority({ ...input, dispositions: [{ authority: "controller", node: "node_modules/@scope/builder/node_modules/@scope/controller", kind: "isolated-non-authoritative-helper", reference: "urn:example:helper-isolation" }] });
    expect(report.ok).toBe(true);
    expect(report.results[0]).toMatchObject({ status: "isolated-helper-disposed", ok: true });
  });

  it("exempts only an exact helper node's incompatible edge and refuses to dispose the requested target", () => {
    const input = npm({
      "": { dependencies: { "@scope/builder": "^0.4.0", "@scope/controller": "^0.8.0" } },
      "node_modules/@scope/builder": { version: "0.4.0", dependencies: { "@scope/controller": "^0.7.0" } },
      "node_modules/@scope/controller": { version: "0.8.19" },
      "node_modules/@scope/builder/node_modules/@scope/controller": { version: "0.7.9" },
    });
    const helper = "node_modules/@scope/builder/node_modules/@scope/controller";
    expect(checkSingularAuthority({ ...input, dispositions: [{ authority: "controller", node: helper, kind: "isolated-non-authoritative-helper", reference: "urn:example:helper" }] }).results[0])
      .toMatchObject({ status: "isolated-helper-disposed", ok: true });
    expect(checkSingularAuthority({ ...input, dispositions: [{ authority: "controller", node: "node_modules/@scope/controller", kind: "isolated-non-authoritative-helper", reference: "urn:example:bad-helper" }] }).results[0])
      .toMatchObject({ status: "indeterminate", findings: [{ code: "target-helper-disposition" }] });
  });

  it("fails closed when the requested target is absent or a range is outside the supported schema", () => {
    const absent = checkSingularAuthority({ ...npm(NPM_CONVERGED), target: { authority: "controller", version: "0.9.0" } });
    expect(absent.results[0]).toMatchObject({ status: "indeterminate", findings: [{ code: "target-not-resolved" }] });
    const undeclared = checkSingularAuthority({ ...npm(NPM_CONVERGED), target: { authority: "typo", version: "0.8.19" } });
    expect(undeclared).toMatchObject({ ok: false, results: [], findings: [{ code: "target-undeclared" }] });
    const unsupported = checkSingularAuthority(npm({
      "": { dependencies: { "@scope/builder": ">=0.7.0", "@scope/controller": "^0.8.0" } },
      "node_modules/@scope/builder": { version: "0.7.1", dependencies: { "@scope/controller": ">=0.7.0" } },
      "node_modules/@scope/controller": { version: "0.8.19" },
    }));
    expect(unsupported.results[0]).toMatchObject({ status: "indeterminate", findings: [{ code: "range-unsupported" }] });
  });

  it("implements ^0.0.x as patch-only and leaves prerelease compatibility indeterminate", () => {
    const patchOnly = (version: string) => checkSingularAuthority({
      lockfile: { format: "npm", content: JSON.stringify({ lockfileVersion: 3, packages: {
        "": { devDependencies: { "@scope/controller": "^0.0.1" } },
        "node_modules/@scope/controller": { version },
      } }) },
      declarations,
      target: { authority: "controller", version },
    });
    expect(patchOnly("0.0.1").results[0]).toMatchObject({ status: "converged", ok: true });
    expect(patchOnly("0.0.2").results[0]).toMatchObject({ status: "compatibility-update-required", ok: false });
    const prerelease = checkSingularAuthority({
      lockfile: { format: "npm", content: JSON.stringify({ lockfileVersion: 3, packages: {
        "": { devDependencies: { "@scope/controller": "^0.8.0" } },
        "node_modules/@scope/controller": { version: "0.8.20-beta.1" },
      } }) },
      declarations,
      target: { authority: "controller", version: "0.8.20-beta.1" },
    });
    expect(prerelease.results[0]).toMatchObject({ status: "indeterminate", findings: [{ code: "range-unsupported" }] });
  });
});

const pnpmConverged = [
  "lockfileVersion: '9.0'", "importers:", "  .:", "    dependencies:", "      '@scope/controller':", "        specifier: ^0.8.0", "        version: 0.8.19", "packages:", "  '@scope/controller@0.8.19':", "    resolution: {integrity: sha512-example}", "snapshots:", "  '@scope/controller@0.8.19': {}", "",
].join("\n");

describe("checkSingularAuthority — pnpm v9 bounded graph", () => {
  it("reads a compatible frozen pnpm lock and reports the importer edge", () => {
    const report = checkSingularAuthority({ lockfile: { format: "pnpm", content: pnpmConverged }, declarations, target });
    expect(report.ok).toBe(true);
    expect(report.results[0]).toMatchObject({ status: "converged", resolved: [{ node: "pnpm:@scope/controller@0.8.19", version: "0.8.19" }] });
    expect(report.results[0]!.resolved[0]!.introducedBy).toMatchObject([{ from: "pnpm-importer:.", dependency: "@scope/controller", range: "^0.8.0" }]);
  });

  it("requires pnpm lockfileVersion 9.0, rejects duplicate declarations, and makes unresolved authority edges indeterminate", () => {
    const unsupportedVersion = checkSingularAuthority({ lockfile: { format: "pnpm", content: pnpmConverged.replace("'9.0'", "'8.0'") }, declarations, target });
    expect(unsupportedVersion).toMatchObject({ ok: false, results: [], findings: [{ code: "lockfile-unsupported" }] });
    const duplicateVersion = checkSingularAuthority({ lockfile: { format: "pnpm", content: pnpmConverged.replace("importers:", "lockfileVersion: '9.0'\nimporters:") }, declarations, target });
    expect(duplicateVersion).toMatchObject({ ok: false, results: [], findings: [{ code: "lockfile-unsupported" }] });
    const duplicateDeclaration = checkSingularAuthority({ lockfile: { format: "pnpm", content: pnpmConverged }, declarations: [...declarations, declarations[0]!], target });
    expect(duplicateDeclaration).toMatchObject({ ok: false, results: [], findings: [{ code: "declaration-duplicate" }] });
    const conflictingDeclaration = checkSingularAuthority({ lockfile: { format: "pnpm", content: pnpmConverged }, declarations: [...declarations, { packageName: "@scope/controller", authority: "other" }], target });
    expect(conflictingDeclaration).toMatchObject({ ok: false, results: [], findings: [{ code: "declaration-conflict" }] });
    const unresolved = [
      "lockfileVersion: '9.0'", "importers:", "  .:", "    devDependencies:", "      '@scope/controller':", "        specifier: ^0.8.0", "        version: 0.8.19", "packages:", "  '@scope/controller@0.8.19':", "    resolution: {integrity: sha512-controller}", "snapshots:", "  '@scope/controller@0.8.19': {}", "  '@scope/controller@0.8.19': {}", "",
    ].join("\n");
    // Duplicate YAML keys are rejected rather than collapsed into one node.
    expect(checkSingularAuthority({ lockfile: { format: "pnpm", content: unresolved }, declarations, target }))
      .toMatchObject({ ok: false, results: [], findings: [{ code: "lockfile-unsupported" }] });
    const missingPeerSnapshot = pnpmConverged.replace("version: 0.8.19", "version: 0.8.19(typescript@6.0.3)");
    const report = checkSingularAuthority({ lockfile: { format: "pnpm", content: missingPeerSnapshot }, declarations, target });
    expect(report.results[0]).toMatchObject({ status: "indeterminate", findings: [{ code: "introducing-edge-unresolved" }] });
  });

  it("fails closed for malformed target records or non-array caller collections", () => {
    const malformed = checkSingularAuthority({
      lockfile: { format: "pnpm", content: pnpmConverged },
      declarations: "controller" as unknown as SingularAuthorityCheckInput["declarations"],
      target: [] as unknown as SingularAuthorityCheckInput["target"],
      dependencyConstraints: {} as unknown as SingularAuthorityCheckInput["dependencyConstraints"],
      dispositions: {} as unknown as SingularAuthorityCheckInput["dispositions"],
    });
    expect(malformed).toMatchObject({ ok: false, results: [], findings: expect.arrayContaining([
      expect.objectContaining({ code: "input-invalid" }),
    ]) });
  });

  it("requires supplied pnpm transitive ranges, then binds real peer-qualified snapshot edges exactly", () => {
    const content = [
      "lockfileVersion: '9.0'", "importers:", "  .:", "    devDependencies:", "      '@scope/builder':", "        specifier: ^0.7.0", "        version: 0.7.1", "      '@scope/controller':", "        specifier: ^0.8.0", "        version: 0.8.13(typescript@6.0.3)", "packages:", "  '@scope/builder@0.7.1':", "    resolution: {integrity: sha512-builder}", "    peerDependencies:", "      zod: ^3.25.76 || ^4.1.8", "  '@scope/controller@0.8.13':", "    resolution: {integrity: sha512-controller}", "snapshots:", "  '@scope/builder@0.7.1':", "    dependencies:", "      '@scope/controller': 0.8.13(typescript@6.0.3)", "    transitivePeerDependencies:", "      - typescript", "  '@scope/controller@0.8.13(typescript@6.0.3)': {}", "",
    ].join("\n");
    const target = { authority: "controller", version: "0.8.13" } as const;
    const input = { lockfile: { format: "pnpm" as const, content }, declarations, target };
    expect(checkSingularAuthority(input).results[0]).toMatchObject({ status: "indeterminate", findings: [{ code: "range-missing" }] });
    const constraint = { from: "pnpm:@scope/builder@0.7.1", dependency: "@scope/controller", to: "pnpm:@scope/controller@0.8.13(typescript@6.0.3)" } as const;
    expect(checkSingularAuthority({ ...input, dependencyConstraints: [{ ...constraint, range: "^0.7.0" }] }).results[0])
      .toMatchObject({ status: "compatibility-update-required", ok: false });
    const report = checkSingularAuthority({ ...input, dependencyConstraints: [{ ...constraint, range: "^0.8.0" }] });
    expect(report).toMatchObject({ ok: true, results: [{ status: "converged", resolved: [{ node: "pnpm:@scope/controller@0.8.13(typescript@6.0.3)", version: "0.8.13" }] }] });
    expect(report.results[0]!.resolved[0]!.introducedBy).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "pnpm-importer:.", dependency: "@scope/controller", range: "^0.8.0" }),
      expect.objectContaining({ from: "pnpm:@scope/builder@0.7.1", dependency: "@scope/controller" }),
    ]));
  });

  it("binds pnpm package peer ranges to the snapshot's exact peer-qualified target", () => {
    const lock = (peerRange: string) => [
      "lockfileVersion: '9.0'", "importers:", "  .:", "    dependencies:", "      '@scope/builder':", "        specifier: ^0.7.0", "        version: 0.7.1(@scope/controller@0.8.19)", "      '@scope/controller':", "        specifier: ^0.8.0", "        version: 0.8.19", "packages:", "  '@scope/builder@0.7.1':", "    peerDependencies:", `      '@scope/controller': ${peerRange}`, "  '@scope/controller@0.8.19':", "    resolution: {integrity: sha512-controller}", "snapshots:", "  '@scope/builder@0.7.1(@scope/controller@0.8.19)': {}", "  '@scope/controller@0.8.19': {}", "",
    ].join("\n");
    const input = (peerRange: string) => ({ lockfile: { format: "pnpm" as const, content: lock(peerRange) }, declarations, target });
    expect(checkSingularAuthority(input("^0.7.0")).results[0]).toMatchObject({ status: "compatibility-update-required", findings: [{ code: "target-out-of-range" }] });
    const green = checkSingularAuthority(input("^0.8.0"));
    expect(green.results[0]).toMatchObject({ status: "converged", ok: true });
    expect(green.results[0]!.resolved[0]!.introducedBy).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "pnpm:@scope/builder@0.7.1(@scope/controller@0.8.19)", dependency: "@scope/controller", range: "^0.8.0", to: "pnpm:@scope/controller@0.8.19" }),
    ]));
    const missingPeerMetadata = checkSingularAuthority({ lockfile: { format: "pnpm", content: lock("^0.8.0").replace("    peerDependencies:\n      '@scope/controller': ^0.8.0\n", "") }, declarations, target });
    expect(missingPeerMetadata.results[0]).toMatchObject({ status: "indeterminate", findings: [{ code: "introducing-edge-unresolved" }] });
  });

  it("accepts only balanced nested peer contexts and rejects unbalanced or trailing-junk suffixes", () => {
    const nested = "0.8.19(@scope/peer@1.0.0(child@2.0.0))";
    const lock = (snapshotLocator: string, importerVersion = snapshotLocator.slice("0.8.19".length)) => [
      "lockfileVersion: '9.0'", "importers:", "  .:", "    devDependencies:", "      '@scope/controller':", "        specifier: ^0.8.0", `        version: 0.8.19${importerVersion}`, "packages:", "  '@scope/controller@0.8.19':", "    resolution: {integrity: sha512-controller}", "snapshots:", `  '@scope/controller@${snapshotLocator}': {}`, "",
    ].join("\n");
    const green = checkSingularAuthority({ lockfile: { format: "pnpm", content: lock(nested, nested.slice("0.8.19".length)) }, declarations, target });
    expect(green.results[0]).toMatchObject({ status: "converged", ok: true, resolved: [{ node: `pnpm:@scope/controller@${nested}` }] });
    for (const invalid of ["0.8.19(typescript@6.0.3", "0.8.19(typescript@6.0.3)junk"]) {
      const report = checkSingularAuthority({ lockfile: { format: "pnpm", content: lock(invalid, "") }, declarations, target });
      expect(report).toMatchObject({ ok: false, results: [], findings: [{ code: "lockfile-unsupported" }] });
    }
  });

  it("accepts prerelease/build locators with nested peer contexts and bounds adversarial suffixes", () => {
    const version = "0.8.20-beta.1+build.7";
    const suffix = "(@scope/peer@1.0.0-rc.1+peer.2(child@2.0.0+build.4))";
    const content = (locator: string) => [
      "lockfileVersion: '9.0'", "importers:", "  .:", "    devDependencies:", "      '@scope/controller':",
      `        specifier: ${version}`, `        version: ${locator}`, "packages:", `  '@scope/controller@${version}':`,
      "    resolution: {integrity: sha512-controller}", "snapshots:", `  '@scope/controller@${locator}': {}`, "",
    ].join("\n");
    const exactTarget = { authority: "controller", version } as const;
    const green = checkSingularAuthority({ lockfile: { format: "pnpm", content: content(`${version}${suffix}`) }, declarations, target: exactTarget });
    expect(green.findings).toEqual([]);
    expect(green.results[0]?.resolved).toEqual([expect.objectContaining({ version, node: `pnpm:@scope/controller@${version}${suffix}` })]);

    const oversizedSuffix = `(${"(".repeat(70_000)}peer@1.0.0${")".repeat(70_001)}`;
    const rejected = checkSingularAuthority({ lockfile: { format: "pnpm", content: content(`${version}${oversizedSuffix}`) }, declarations, target: exactTarget });
    expect(rejected).toMatchObject({ ok: false, results: [], findings: [{ code: "lockfile-unsupported" }] });
  });

  it("makes a pnpm snapshot's nested legacy authority indeterminate without its retained dependency range", () => {
    const content = [
      "lockfileVersion: '9.0'", "importers:", "  .:", "    dependencies:", "      '@scope/builder':", "        specifier: ^0.4.0", "        version: 0.4.0", "      '@scope/controller':", "        specifier: ^0.8.0", "        version: 0.8.19", "packages:", "  '@scope/builder@0.4.0':", "    resolution: {integrity: sha512-builder}", "  '@scope/controller@0.7.9':", "    resolution: {integrity: sha512-old}", "  '@scope/controller@0.8.19':", "    resolution: {integrity: sha512-current}", "snapshots:", "  '@scope/builder@0.4.0':", "    dependencies:", "      '@scope/controller': 0.7.9", "  '@scope/controller@0.7.9': {}", "  '@scope/controller@0.8.19': {}", "",
    ].join("\n");
    const report = checkSingularAuthority({ lockfile: { format: "pnpm", content }, declarations, target });
    expect(report.ok).toBe(false);
    expect(report.results[0]).toMatchObject({ status: "indeterminate", resolved: [{ version: "0.7.9" }, { version: "0.8.19" }], findings: [{ code: "range-missing" }] });
  });
});
