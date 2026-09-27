import { describe, expect, it } from "vitest";
import type { LockfileInvariantPackage } from "./lockfile-invariants.js";
import { checkLockfileInvariants } from "./lockfile-invariants.js";
import { PACKAGE_SCOPE } from "./generated/package-scope.generated.js";
import type { RootPlacement } from "./lockfile-readers.js";

const SCOPE = PACKAGE_SCOPE.scope;
const REGISTRY = PACKAGE_SCOPE.registry;

function tarball(name: string, version: string): string {
  const base = name.includes("/") ? name.split("/")[1]! : name;
  return `${REGISTRY}/${name}/-/${base}-${version}.tgz`;
}

const INPUT_PACKAGE: LockfileInvariantPackage = {
  name: `${SCOPE}/fixture-a`,
  version: "1.0.0",
  integrity: "sha512-AAAA==",
  placement: "dependencies",
};

// ---------------------------------------------------------------------------
// npm fixtures
// ---------------------------------------------------------------------------

function npmLockfile(packages: Record<string, unknown>, lockfileVersion: number = 3): string {
  return JSON.stringify({ name: "root", version: "0.0.0", lockfileVersion, requires: true, packages }, null, 2);
}

function npmBasePackages(): Record<string, any> {
  return {
    "": {
      name: "root",
      version: "0.0.0",
      dependencies: { [`${SCOPE}/fixture-a`]: "1.0.0" },
      devDependencies: { [`${SCOPE}/fixture-other`]: "^2.0.0" },
    },
    [`node_modules/${SCOPE}/fixture-a`]: {
      version: "1.0.0",
      resolved: tarball(`${SCOPE}/fixture-a`, "1.0.0"),
      integrity: "sha512-AAAA==",
    },
    [`node_modules/${SCOPE}/fixture-other`]: {
      version: "2.1.0",
      resolved: tarball(`${SCOPE}/fixture-other`, "2.1.0"),
      integrity: "sha512-BBBB==",
    },
    [`node_modules/${SCOPE}/fixture-a/node_modules/nested-dep`]: {
      version: "1.0.0",
      resolved: "https://registry.npmjs.org/nested-dep/-/nested-dep-1.0.0.tgz",
      integrity: "sha512-CCCC==",
    },
  };
}

describe("npm lockfile invariants", () => {
  it("is satisfied when nothing the invariants track changed, and counts transitive churn exactly", () => {
    const base = npmBasePackages();
    const regenerated = npmBasePackages();
    // One transitive dep dropped, one added: churn the invariants don't refuse.
    delete regenerated[`node_modules/${SCOPE}/fixture-a/node_modules/nested-dep`];
    regenerated["node_modules/another-dep"] = {
      version: "1.0.0",
      resolved: "https://registry.npmjs.org/another-dep/-/another-dep-1.0.0.tgz",
      integrity: "sha512-DDDD==",
    };
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(base),
      regenerated: npmLockfile(regenerated),
      packages: [INPUT_PACKAGE],
    });
    expect(result).toEqual({ verdict: "satisfied", violations: [], transitive: { added: 1, removed: 1 } });
  });

  it("I1: violated when the input package's regenerated version differs", () => {
    const regenerated = npmBasePackages();
    regenerated[`node_modules/${SCOPE}/fixture-a`].version = "1.0.1";
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages()),
      regenerated: npmLockfile(regenerated),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict).toBe("violated");
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I1", name: `${SCOPE}/fixture-a` }]);
  });

  it("I1: violated when the input package's regenerated integrity differs", () => {
    const regenerated = npmBasePackages();
    regenerated[`node_modules/${SCOPE}/fixture-a`].integrity = "sha512-ZZZZ==";
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages()),
      regenerated: npmLockfile(regenerated),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([
      { invariant: "I1", name: `${SCOPE}/fixture-a` },
      // The same name@version with a new integrity is also I3.
      { invariant: "I3", name: `${SCOPE}/fixture-a` },
    ]);
  });

  it("I1: violated when the input package moves to a different root placement", () => {
    const regenerated = npmBasePackages();
    delete regenerated[""].dependencies[`${SCOPE}/fixture-a`];
    regenerated[""].devDependencies[`${SCOPE}/fixture-a`] = "1.0.0";
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages()),
      regenerated: npmLockfile(regenerated),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I1", name: `${SCOPE}/fixture-a` }]);
  });

  it("I1: violated when the input package resolves to a link (also I5: a new scoped link entry, fix 7)", () => {
    const regenerated = npmBasePackages();
    regenerated[`node_modules/${SCOPE}/fixture-a`] = { resolved: "../fixture-a", link: true };
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages()),
      regenerated: npmLockfile(regenerated),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([
      { invariant: "I1", name: `${SCOPE}/fixture-a` },
      { invariant: "I5", name: `${SCOPE}/fixture-a` },
    ]);
  });

  it("I2: violated when another root dep's specifier changes", () => {
    const regenerated = npmBasePackages();
    regenerated[""].devDependencies[`${SCOPE}/fixture-other`] = "^3.0.0";
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages()),
      regenerated: npmLockfile(regenerated),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I2", name: `${SCOPE}/fixture-other` }]);
  });

  it("I2: violated when another root dep's resolved version changes", () => {
    const regenerated = npmBasePackages();
    regenerated[`node_modules/${SCOPE}/fixture-other`].version = "2.2.0";
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages()),
      regenerated: npmLockfile(regenerated),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I2", name: `${SCOPE}/fixture-other` }]);
  });

  it("I2: violated when another root dep's integrity changes", () => {
    const regenerated = npmBasePackages();
    regenerated[`node_modules/${SCOPE}/fixture-other`].integrity = "sha512-EEEE==";
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages()),
      regenerated: npmLockfile(regenerated),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([
      { invariant: "I2", name: `${SCOPE}/fixture-other` },
      // The same name@version with a new integrity is also I3.
      { invariant: "I3", name: `${SCOPE}/fixture-other` },
    ]);
  });

  it("I2: violated when a root dep is added", () => {
    const regenerated = npmBasePackages();
    regenerated[""].dependencies["other-lib"] = "1.0.0";
    regenerated["node_modules/other-lib"] = {
      version: "1.0.0",
      resolved: "https://registry.npmjs.org/other-lib/-/other-lib-1.0.0.tgz",
      integrity: "sha512-FFFF==",
    };
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages()),
      regenerated: npmLockfile(regenerated),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I2", name: "other-lib" }]);
  });

  it("I2: violated when a root dep is removed", () => {
    const regenerated = npmBasePackages();
    delete regenerated[""].devDependencies[`${SCOPE}/fixture-other`];
    delete regenerated[`node_modules/${SCOPE}/fixture-other`];
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages()),
      regenerated: npmLockfile(regenerated),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I2", name: `${SCOPE}/fixture-other` }]);
  });

  it("I3: violated when a transitive package keeps its version but changes integrity", () => {
    const regenerated = npmBasePackages();
    regenerated[`node_modules/${SCOPE}/fixture-a/node_modules/nested-dep`].integrity = "sha512-9999==";
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages()),
      regenerated: npmLockfile(regenerated),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I3", name: "nested-dep" }]);
  });

  it("I4: violated when lockfileVersion changes", () => {
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages(), 3),
      regenerated: npmLockfile(npmBasePackages(), 2),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I4", name: "" }]);
  });

  it("I5: violated when a newly-resolved scoped entry comes from another host", () => {
    const regenerated = npmBasePackages();
    regenerated[`node_modules/${SCOPE}/fixture-a/node_modules/${SCOPE}/fixture-new`] = {
      version: "1.0.0",
      resolved: `https://example.com/${SCOPE}/fixture-new/-/fixture-new-1.0.0.tgz`,
      integrity: "sha512-FFFF==",
    };
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages()),
      regenerated: npmLockfile(regenerated),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I5", name: `${SCOPE}/fixture-new` }]);
  });

  it("I5: violated when a newly-resolved scoped entry is git-resolved", () => {
    const regenerated = npmBasePackages();
    regenerated[`node_modules/${SCOPE}/fixture-a/node_modules/${SCOPE}/fixture-git`] = {
      version: "1.0.0",
      resolved: "git+https://github.com/example/fixture-git.git#abcdef0",
    };
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages()),
      regenerated: npmLockfile(regenerated),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I5", name: `${SCOPE}/fixture-git` }]);
  });

  it("I5: violated when a new entry's installed (key-derived) name is scoped even though its declared name is not (scopedAlias, fix 6)", () => {
    const regenerated = npmBasePackages();
    regenerated[`node_modules/${SCOPE}/fixture-a/node_modules/${SCOPE}/fixture-b`] = {
      name: "evil",
      version: "6.6.6",
      resolved: "https://evil.example/evil-6.6.6.tgz",
      integrity: "sha512-EEEE==",
    };
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages()),
      regenerated: npmLockfile(regenerated),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I5", name: "evil" }]);
  });

  it("I5: violated when a new scoped install aliases to a declared name@version already in the base (npmAliasReuse, fix round 3)", () => {
    const regenerated = npmBasePackages();
    regenerated[`node_modules/${SCOPE}/fixture-b`] = {
      name: "nested-dep",
      version: "1.0.0",
      resolved: "https://registry.npmjs.org/nested-dep/-/nested-dep-1.0.0.tgz",
      integrity: "sha512-CCCC==",
    };
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages()),
      regenerated: npmLockfile(regenerated),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I5", name: "nested-dep" }]);
  });

  it("I5: violated when a new link entry's installed name is under the scope (scopedLink, fix 7)", () => {
    const regenerated = npmBasePackages();
    regenerated[`node_modules/${SCOPE}/fixture-b`] = { resolved: "vendor/b", link: true };
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages()),
      regenerated: npmLockfile(regenerated),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I5", name: `${SCOPE}/fixture-b` }]);
  });

  it("I5: the same link entry present identically in the base is not a violation (scopedLink, fix 7)", () => {
    const withLink = (packages: Record<string, any>): Record<string, any> => {
      packages[`node_modules/${SCOPE}/fixture-b`] = { resolved: "vendor/b", link: true };
      return packages;
    };
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(withLink(npmBasePackages())),
      regenerated: npmLockfile(withLink(npmBasePackages())),
      packages: [INPUT_PACKAGE],
    });
    expect(result).toMatchObject({ verdict: "satisfied" });
  });

  it("I5: fails closed with a violation for every new scoped entry when the publishing registry is not a URL (fix 10)", () => {
    const regenerated = npmBasePackages();
    regenerated[`node_modules/${SCOPE}/fixture-new`] = {
      version: "1.0.0",
      resolved: tarball(`${SCOPE}/fixture-new`, "1.0.0"),
      integrity: "sha512-FFFF==",
    };
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages()),
      regenerated: npmLockfile(regenerated),
      packages: [INPUT_PACKAGE],
      publishing: { scope: SCOPE, registry: "not a url" },
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I5", name: `${SCOPE}/fixture-new` }]);
  });

  it('I5: fails closed with a single violation named "" when the publishing registry is not a URL and nothing new is scoped (fix 10)', () => {
    const result = checkLockfileInvariants({
      format: "npm",
      base: npmLockfile(npmBasePackages()),
      regenerated: npmLockfile(npmBasePackages()),
      packages: [INPUT_PACKAGE],
      publishing: { scope: SCOPE, registry: "not a url" },
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I5", name: "" }]);
  });

  it("is indeterminate on the base side when the base lockfile is unreadable", () => {
    const result = checkLockfileInvariants({
      format: "npm",
      base: "not valid json {",
      regenerated: npmLockfile(npmBasePackages()),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict).toBe("indeterminate");
    expect(result.verdict === "indeterminate" && result.side).toBe("base");
  });
});

// ---------------------------------------------------------------------------
// pnpm fixtures
// ---------------------------------------------------------------------------

interface PnpmRootDep {
  readonly placement: RootPlacement;
  readonly name: string;
  readonly specifier: string;
  readonly version: string;
}

interface PnpmPackage {
  readonly key: string;
  readonly integrity?: string | null;
  readonly tarball?: string | null;
  /** Raw extra `resolution` fields, e.g. "type: git, repo: ..., commit: ...". */
  readonly extraResolution?: string;
}

const ROOT_PLACEMENTS_IN_ORDER: readonly RootPlacement[] = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

function pnpmLockfile(opts: {
  lockfileVersion?: string;
  root: readonly PnpmRootDep[];
  packages: readonly PnpmPackage[];
}): string {
  const lines: string[] = [
    `lockfileVersion: '${opts.lockfileVersion ?? "9.0"}'`,
    "",
    "settings:",
    "  autoInstallPeers: true",
    "  excludeLinksFromLockfile: false",
    "",
    "importers:",
    "",
    "  .:",
  ];
  for (const placement of ROOT_PLACEMENTS_IN_ORDER) {
    const deps = opts.root.filter((dep) => dep.placement === placement);
    if (deps.length === 0) continue;
    lines.push(`    ${placement}:`);
    for (const dep of deps) {
      lines.push(`      '${dep.name}':`, `        specifier: ${dep.specifier}`, `        version: ${dep.version}`);
    }
  }
  lines.push("", "packages:", "");
  for (const pkg of opts.packages) {
    const resolutionParts: string[] = [];
    if (pkg.integrity !== undefined && pkg.integrity !== null) resolutionParts.push(`integrity: ${pkg.integrity}`);
    if (pkg.tarball !== undefined && pkg.tarball !== null) resolutionParts.push(`tarball: ${pkg.tarball}`);
    if (pkg.extraResolution) resolutionParts.push(pkg.extraResolution);
    lines.push(`  '${pkg.key}':`, `    resolution: {${resolutionParts.join(", ")}}`, "");
  }
  lines.push("snapshots:", "");
  for (const pkg of opts.packages) lines.push(`  '${pkg.key}': {}`, "");
  return lines.join("\n");
}

function pnpmBaseRoot(): PnpmRootDep[] {
  return [
    { placement: "dependencies", name: `${SCOPE}/fixture-a`, specifier: "1.0.0", version: "1.0.0" },
    { placement: "devDependencies", name: `${SCOPE}/fixture-other`, specifier: "^2.0.0", version: "2.1.0" },
  ];
}

function pnpmBasePackages(): PnpmPackage[] {
  return [
    { key: `${SCOPE}/fixture-a@1.0.0`, integrity: "sha512-AAAA==", tarball: tarball(`${SCOPE}/fixture-a`, "1.0.0") },
    { key: `${SCOPE}/fixture-other@2.1.0`, integrity: "sha512-BBBB==", tarball: tarball(`${SCOPE}/fixture-other`, "2.1.0") },
    { key: "nested-dep@1.0.0", integrity: "sha512-CCCC==" },
  ];
}

describe("pnpm lockfile invariants", () => {
  it("is satisfied when nothing the invariants track changed, and counts transitive churn exactly", () => {
    const basePackages = pnpmBasePackages();
    const regeneratedPackages = pnpmBasePackages().filter((pkg) => pkg.key !== "nested-dep@1.0.0");
    regeneratedPackages.push({ key: "another-dep@1.0.0", integrity: "sha512-DDDD==" });
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: pnpmLockfile({ root: pnpmBaseRoot(), packages: basePackages }),
      regenerated: pnpmLockfile({ root: pnpmBaseRoot(), packages: regeneratedPackages }),
      packages: [INPUT_PACKAGE],
    });
    expect(result).toEqual({ verdict: "satisfied", violations: [], transitive: { added: 1, removed: 1 } });
  });

  it("I1: violated when the input package's regenerated version differs", () => {
    const root = pnpmBaseRoot().map((dep) => (dep.name === INPUT_PACKAGE.name ? { ...dep, version: "1.0.1" } : dep));
    const packages = pnpmBasePackages().map((pkg) =>
      pkg.key === `${SCOPE}/fixture-a@1.0.0` ? { ...pkg, key: `${SCOPE}/fixture-a@1.0.1` } : pkg,
    );
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: pnpmLockfile({ root: pnpmBaseRoot(), packages: pnpmBasePackages() }),
      regenerated: pnpmLockfile({ root, packages }),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I1", name: `${SCOPE}/fixture-a` }]);
  });

  it("I1: violated when the input package's regenerated integrity differs", () => {
    const packages = pnpmBasePackages().map((pkg) =>
      pkg.key === `${SCOPE}/fixture-a@1.0.0` ? { ...pkg, integrity: "sha512-ZZZZ==" } : pkg,
    );
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: pnpmLockfile({ root: pnpmBaseRoot(), packages: pnpmBasePackages() }),
      regenerated: pnpmLockfile({ root: pnpmBaseRoot(), packages }),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([
      { invariant: "I1", name: `${SCOPE}/fixture-a` },
      // The same name@version with a new integrity is also I3.
      { invariant: "I3", name: `${SCOPE}/fixture-a` },
    ]);
  });

  it("I1: violated when the input package moves to a different root placement", () => {
    const root = pnpmBaseRoot().map((dep) =>
      dep.name === INPUT_PACKAGE.name ? { ...dep, placement: "devDependencies" as const } : dep,
    );
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: pnpmLockfile({ root: pnpmBaseRoot(), packages: pnpmBasePackages() }),
      regenerated: pnpmLockfile({ root, packages: pnpmBasePackages() }),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I1", name: `${SCOPE}/fixture-a` }]);
  });

  it("I1: violated when the input package resolves via link: (also I5: a scoped root dependency turning into a link is itself new, fix 6)", () => {
    const root = pnpmBaseRoot().map((dep) =>
      dep.name === INPUT_PACKAGE.name ? { ...dep, specifier: "link:../fixture-a", version: "link:../fixture-a" } : dep,
    );
    const packages = pnpmBasePackages().filter((pkg) => pkg.key !== `${SCOPE}/fixture-a@1.0.0`);
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: pnpmLockfile({ root: pnpmBaseRoot(), packages: pnpmBasePackages() }),
      regenerated: pnpmLockfile({ root, packages }),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([
      { invariant: "I1", name: `${SCOPE}/fixture-a` },
      { invariant: "I5", name: `${SCOPE}/fixture-a` },
    ]);
  });

  it("I1: violated when the input package resolves via file: (also I5: a scoped root dependency turning into a file: is itself new, fix 6)", () => {
    const root = pnpmBaseRoot().map((dep) =>
      dep.name === INPUT_PACKAGE.name
        ? { ...dep, specifier: "file:../fixture-a.tgz", version: "file:../fixture-a.tgz" }
        : dep,
    );
    const packages = pnpmBasePackages().filter((pkg) => pkg.key !== `${SCOPE}/fixture-a@1.0.0`);
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: pnpmLockfile({ root: pnpmBaseRoot(), packages: pnpmBasePackages() }),
      regenerated: pnpmLockfile({ root, packages }),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([
      { invariant: "I1", name: `${SCOPE}/fixture-a` },
      { invariant: "I5", name: `${SCOPE}/fixture-a` },
    ]);
  });

  it("I2: violated when another root dep's specifier changes", () => {
    const root = pnpmBaseRoot().map((dep) => (dep.name === `${SCOPE}/fixture-other` ? { ...dep, specifier: "^3.0.0" } : dep));
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: pnpmLockfile({ root: pnpmBaseRoot(), packages: pnpmBasePackages() }),
      regenerated: pnpmLockfile({ root, packages: pnpmBasePackages() }),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I2", name: `${SCOPE}/fixture-other` }]);
  });

  it("I2: violated when another root dep's resolved version changes", () => {
    const root = pnpmBaseRoot().map((dep) => (dep.name === `${SCOPE}/fixture-other` ? { ...dep, version: "2.2.0" } : dep));
    const packages = pnpmBasePackages().map((pkg) =>
      pkg.key === `${SCOPE}/fixture-other@2.1.0` ? { ...pkg, key: `${SCOPE}/fixture-other@2.2.0` } : pkg,
    );
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: pnpmLockfile({ root: pnpmBaseRoot(), packages: pnpmBasePackages() }),
      regenerated: pnpmLockfile({ root, packages }),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I2", name: `${SCOPE}/fixture-other` }]);
  });

  it("I2: violated when another root dep's integrity changes", () => {
    const packages = pnpmBasePackages().map((pkg) =>
      pkg.key === `${SCOPE}/fixture-other@2.1.0` ? { ...pkg, integrity: "sha512-EEEE==" } : pkg,
    );
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: pnpmLockfile({ root: pnpmBaseRoot(), packages: pnpmBasePackages() }),
      regenerated: pnpmLockfile({ root: pnpmBaseRoot(), packages }),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([
      { invariant: "I2", name: `${SCOPE}/fixture-other` },
      // The same name@version with a new integrity is also I3.
      { invariant: "I3", name: `${SCOPE}/fixture-other` },
    ]);
  });

  it("I2: violated when a root dep is added", () => {
    const root = [...pnpmBaseRoot(), { placement: "dependencies" as const, name: "other-lib", specifier: "1.0.0", version: "1.0.0" }];
    const packages = [...pnpmBasePackages(), { key: "other-lib@1.0.0", integrity: "sha512-FFFF==" }];
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: pnpmLockfile({ root: pnpmBaseRoot(), packages: pnpmBasePackages() }),
      regenerated: pnpmLockfile({ root, packages }),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I2", name: "other-lib" }]);
  });

  it("I2: violated when a root dep is removed", () => {
    const root = pnpmBaseRoot().filter((dep) => dep.name !== `${SCOPE}/fixture-other`);
    const packages = pnpmBasePackages().filter((pkg) => pkg.key !== `${SCOPE}/fixture-other@2.1.0`);
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: pnpmLockfile({ root: pnpmBaseRoot(), packages: pnpmBasePackages() }),
      regenerated: pnpmLockfile({ root, packages }),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I2", name: `${SCOPE}/fixture-other` }]);
  });

  it("I3: violated when a transitive package keeps its version but changes integrity", () => {
    const packages = pnpmBasePackages().map((pkg) => (pkg.key === "nested-dep@1.0.0" ? { ...pkg, integrity: "sha512-9999==" } : pkg));
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: pnpmLockfile({ root: pnpmBaseRoot(), packages: pnpmBasePackages() }),
      regenerated: pnpmLockfile({ root: pnpmBaseRoot(), packages }),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I3", name: "nested-dep" }]);
  });

  it("I4: violated (via the unsupported-format path) when lockfileVersion changes", () => {
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: pnpmLockfile({ lockfileVersion: "9.0", root: pnpmBaseRoot(), packages: pnpmBasePackages() }),
      regenerated: pnpmLockfile({ lockfileVersion: "10.0", root: pnpmBaseRoot(), packages: pnpmBasePackages() }),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I4", name: "" }]);
    expect(result.verdict === "violated" && result.transitive).toEqual({ added: 0, removed: 0 });
  });

  it("I5: violated when a newly-resolved scoped entry comes from another host", () => {
    const packages = [
      ...pnpmBasePackages(),
      { key: `${SCOPE}/fixture-new@1.0.0`, integrity: "sha512-FFFF==", tarball: `https://example.com/${SCOPE}/fixture-new/-/fixture-new-1.0.0.tgz` },
    ];
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: pnpmLockfile({ root: pnpmBaseRoot(), packages: pnpmBasePackages() }),
      regenerated: pnpmLockfile({ root: pnpmBaseRoot(), packages }),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I5", name: `${SCOPE}/fixture-new` }]);
  });

  it("I5: violated when a newly-resolved scoped entry is git-resolved", () => {
    const packages = [
      ...pnpmBasePackages(),
      {
        key: `${SCOPE}/fixture-git@1.0.0`,
        extraResolution: "type: git, repo: https://github.com/example/fixture-git.git, commit: abcdef0123456789",
      },
    ];
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: pnpmLockfile({ root: pnpmBaseRoot(), packages: pnpmBasePackages() }),
      regenerated: pnpmLockfile({ root: pnpmBaseRoot(), packages }),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I5", name: `${SCOPE}/fixture-git` }]);
  });

  it("I5: violated when a newly-resolved scoped entry is directory-resolved", () => {
    const packages = [
      ...pnpmBasePackages(),
      { key: `${SCOPE}/fixture-dir@1.0.0`, extraResolution: "type: directory, directory: ../fixture-dir" },
    ];
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: pnpmLockfile({ root: pnpmBaseRoot(), packages: pnpmBasePackages() }),
      regenerated: pnpmLockfile({ root: pnpmBaseRoot(), packages }),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I5", name: `${SCOPE}/fixture-dir` }]);
  });

  it("I1: a pnpm (patch_hash=...) suffix on an approved package's version fails I1 (patch, fix 8)", () => {
    const target: LockfileInvariantPackage = { name: `${SCOPE}/fixture-x`, version: "2.0.0", integrity: "sha512-XXXX==", placement: "dependencies" };
    const root: PnpmRootDep[] = [{ placement: "dependencies", name: target.name, specifier: "2.0.0", version: "2.0.0(patch_hash=deadbeef)" }];
    const packages: PnpmPackage[] = [{ key: `${target.name}@${target.version}`, integrity: target.integrity }];
    const lockfile = pnpmLockfile({ root, packages });
    const result = checkLockfileInvariants({ format: "pnpm", base: lockfile, regenerated: lockfile, packages: [target] });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I1", name: target.name }]);
  });

  it("I1: an existing peer-suffix ((name@version)(...)) on an approved package's version still passes", () => {
    const target: LockfileInvariantPackage = { name: `${SCOPE}/fixture-x`, version: "2.0.0", integrity: "sha512-XXXX==", placement: "dependencies" };
    const root: PnpmRootDep[] = [{ placement: "dependencies", name: target.name, specifier: "2.0.0", version: "2.0.0(react@18.2.0)(@types/react@18.0.0)" }];
    const packages: PnpmPackage[] = [{ key: `${target.name}@${target.version}`, integrity: target.integrity }];
    const lockfile = pnpmLockfile({ root, packages });
    const result = checkLockfileInvariants({ format: "pnpm", base: lockfile, regenerated: lockfile, packages: [target] });
    expect(result).toMatchObject({ verdict: "satisfied" });
  });

  it("I5: violated when a snapshot's dependency map aliases a scoped name to a foreign package (pnpmAlias, fix 6)", () => {
    const fixtureATarball = tarball(`${SCOPE}/fixture-a`, "1.0.0");
    function lockfileText(includeAlias: boolean): string {
      const lines = [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "",
        "  .:",
        "    dependencies:",
        `      '${SCOPE}/fixture-a':`,
        "        specifier: 1.0.0",
        "        version: 1.0.0",
        "",
        "packages:",
        "",
        `  '${SCOPE}/fixture-a@1.0.0':`,
        `    resolution: {integrity: sha512-AAAA==, tarball: ${fixtureATarball}}`,
        "",
      ];
      if (includeAlias) {
        lines.push(
          "  'evil@6.6.6':",
          "    resolution: {integrity: sha512-EEEE==, tarball: https://evil.example/evil-6.6.6.tgz}",
          "",
        );
      }
      lines.push("snapshots:", "", `  '${SCOPE}/fixture-a@1.0.0':`);
      lines.push(includeAlias ? "    dependencies:" : "    dependencies: {}");
      if (includeAlias) lines.push(`      '${SCOPE}/fixture-b': evil@6.6.6`);
      lines.push("");
      if (includeAlias) lines.push("  'evil@6.6.6': {}", "");
      return lines.join("\n");
    }
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: lockfileText(false),
      regenerated: lockfileText(true),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I5", name: `${SCOPE}/fixture-b` }]);
  });

  it("I5: violated when a workspace importer's dependency map aliases a scoped name (pnpmImporterAlias, fix round 3)", () => {
    const fixtureATarball = tarball(`${SCOPE}/fixture-a`, "1.0.0");
    const fixtureOtherTarball = tarball(`${SCOPE}/fixture-other`, "2.1.0");
    function lockfileText(includeAppAlias: boolean): string {
      const lines = [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "",
        "  .:",
        "    dependencies:",
        `      '${SCOPE}/fixture-a':`,
        "        specifier: 1.0.0",
        "        version: 1.0.0",
        "    devDependencies:",
        `      '${SCOPE}/fixture-other':`,
        "        specifier: ^2.0.0",
        "        version: 2.1.0",
      ];
      if (includeAppAlias) {
        lines.push(
          "",
          "  packages/app:",
          "    dependencies:",
          `      '${SCOPE}/fixture-b':`,
          "        specifier: nested-dep@1.0.0",
          "        version: nested-dep@1.0.0",
        );
      }
      lines.push(
        "",
        "packages:",
        "",
        `  '${SCOPE}/fixture-a@1.0.0':`,
        `    resolution: {integrity: sha512-AAAA==, tarball: ${fixtureATarball}}`,
        "",
        `  '${SCOPE}/fixture-other@2.1.0':`,
        `    resolution: {integrity: sha512-BBBB==, tarball: ${fixtureOtherTarball}}`,
        "",
        "  'nested-dep@1.0.0':",
        "    resolution: {integrity: sha512-CCCC==}",
        "",
        "snapshots:",
        "",
        `  '${SCOPE}/fixture-a@1.0.0': {}`,
        "",
        `  '${SCOPE}/fixture-other@2.1.0': {}`,
        "",
        "  'nested-dep@1.0.0': {}",
        "",
      );
      return lines.join("\n");
    }
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: lockfileText(false),
      regenerated: lockfileText(true),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict === "violated" && result.violations).toEqual([{ invariant: "I5", name: `${SCOPE}/fixture-b` }]);
  });

  it("is indeterminate on the base side when the base lockfile is unreadable", () => {
    const result = checkLockfileInvariants({
      format: "pnpm",
      base: ":::: not yaml",
      regenerated: pnpmLockfile({ root: pnpmBaseRoot(), packages: pnpmBasePackages() }),
      packages: [INPUT_PACKAGE],
    });
    expect(result.verdict).toBe("indeterminate");
    expect(result.verdict === "indeterminate" && result.side).toBe("base");
  });
});
