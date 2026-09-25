import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Hermetic end-to-end coverage: every fixture is a real, throwaway directory
// under mkdtemp, and the real script is spawned exactly the way CI spawns
// it — no git repo needed (unlike check-release-readiness.mjs), since this
// gate only reads packages/*/package.json and package-lock.json from cwd.

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-workspace-links.mjs");

function run(args, cwd) {
  try {
    const out = execFileSync(process.execPath, [scriptPath, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? "") + (error.stderr ?? "") };
  }
}

function withDir(build) {
  const root = mkdtempSync(join(tmpdir(), "workspace-links-test-"));
  try {
    build(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writePackage(root, { name, version, dependencies, peerDependencies, optionalDependencies, devDependencies }) {
  const shortName = name.split("/").pop();
  const pkgDir = join(root, "packages", shortName);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify(
      {
        name,
        version,
        license: "MIT",
        ...(dependencies ? { dependencies } : {}),
        ...(peerDependencies ? { peerDependencies } : {}),
        ...(optionalDependencies ? { optionalDependencies } : {}),
        ...(devDependencies ? { devDependencies } : {}),
      },
      null,
      2,
    ) + "\n",
  );
  return pkgDir;
}

// Builds package-lock.json's "packages" map with a local-link entry for
// every given package, at both the root node_modules path AND every other
// package's node_modules path (npm hoists everything to root in the real
// lockfile, but the gate also matches nested paths — see the "hoisted vs.
// nested" test below for a nested-only case). It also writes the workspace
// member's OWN mirror entry, "packages/<shortName>", with a "version" field
// read straight off that package's real on-disk manifest — the exact entry
// the version-record check (checkLockVersions, issue #366) reads — so every
// existing fixture stays clean-by-default under that check without having
// to say so explicitly. `overrides` replaces or adds specific keys,
// used to plant a remote-URL/malformed node_modules entry OR a drifted
// "packages/<shortName>" version (see the version-record tests below).
function writeLockfile(root, names, overrides = {}) {
  const packages = {};
  for (const name of names) {
    const shortName = name.split("/").pop();
    packages[`node_modules/${name}`] = { resolved: `packages/${shortName}`, link: true };
    const manifest = JSON.parse(readFileSync(join(root, "packages", shortName, "package.json"), "utf8"));
    packages[`packages/${shortName}`] = { name, version: manifest.version, license: manifest.license ?? "MIT" };
  }
  Object.assign(packages, overrides);
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }, null, 2) + "\n");
}

// -------------------------------------------------------------------- link check

test("link check: a satisfied caret range passes", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/policy", version: "0.1.0" });
    writePackage(root, { name: "@scope/governance", version: "0.3.0", dependencies: { "@scope/policy": "^0.1.0" } });
    writeLockfile(root, ["@scope/policy", "@scope/governance"]);

    const r = run(["--json"], root);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const finding = report.results.find((x) => x.check === "link" && x.dependency === "@scope/policy");
    assert.equal(finding.status, "pass");
  });
});

test("link check: a 0.x minor bump breaks a caret range (^0.3.0 does not cover 0.4.0)", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/governance", version: "0.4.0" });
    writePackage(root, { name: "@scope/catalog", version: "0.2.0", dependencies: { "@scope/governance": "^0.3.0" } });
    writeLockfile(root, ["@scope/governance", "@scope/catalog"]);

    const r = run(["--json"], root);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const finding = report.results.find((x) => x.check === "link" && x.dependency === "@scope/governance");
    assert.equal(finding.status, "finding");
    assert.match(finding.detail, /0\.4\.0/);
    assert.match(finding.detail, /minor-locked/);
    assert.match(finding.detail, /fall back to resolving it from the registry/);
  });
});

test("link check: a 0.x minor bump breaks a tilde range (~0.3.0 does not cover 0.4.0)", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/copy", version: "0.4.0" });
    writePackage(root, { name: "@scope/surface", version: "0.1.2", dependencies: { "@scope/copy": "~0.3.0" } });
    writeLockfile(root, ["@scope/copy", "@scope/surface"]);

    const r = run(["--json"], root);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const finding = report.results.find((x) => x.check === "link" && x.dependency === "@scope/copy");
    assert.equal(finding.status, "finding");
    assert.match(finding.detail, /0\.4\.0/);
  });
});

test("link check: a tilde range still covers a 0.x PATCH bump (0.3.0 -> 0.3.1)", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/copy", version: "0.3.1" });
    writePackage(root, { name: "@scope/surface", version: "0.1.2", dependencies: { "@scope/copy": "~0.3.0" } });
    writeLockfile(root, ["@scope/copy", "@scope/surface"]);

    const r = run(["--json"], root);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
  });
});

test("link check: a caret range on >=1.0.0 is major-locked, not minor-locked (unlike 0.x)", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/policy", version: "1.4.0" });
    writePackage(root, { name: "@scope/governance", version: "0.3.0", dependencies: { "@scope/policy": "^1.2.0" } });
    writeLockfile(root, ["@scope/policy", "@scope/governance"]);

    const r = run(["--json"], root);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
  });
});

test("link check: an exact pin only satisfies the literal version", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/policy", version: "0.1.1" });
    writePackage(root, { name: "@scope/governance", version: "0.3.0", dependencies: { "@scope/policy": "0.1.0" } });
    writeLockfile(root, ["@scope/policy", "@scope/governance"]);

    const r = run(["--json"], root);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const finding = report.results.find((x) => x.check === "link" && x.dependency === "@scope/policy");
    assert.equal(finding.status, "finding");
  });
});

test("link check: an unparseable range is a finding, not a pass", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/policy", version: "0.1.0" });
    writePackage(root, { name: "@scope/governance", version: "0.3.0", dependencies: { "@scope/policy": ">=0.1.0 <0.2.0" } });
    writeLockfile(root, ["@scope/policy", "@scope/governance"]);

    const r = run(["--json"], root);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const finding = report.results.find((x) => x.check === "link" && x.dependency === "@scope/policy");
    assert.equal(finding.status, "finding");
    assert.match(finding.detail, /not a range form this gate parses/);
  });
});

test("link check: a dependency naming a package outside this workspace scan is not evaluated", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/governance", version: "0.3.0", dependencies: { resend: "^6.19.0" } });
    writePackage(root, { name: "@scope/policy", version: "0.1.0", dependencies: { "@scope/other-not-discovered": "^1.0.0" } });
    writeLockfile(root, ["@scope/governance", "@scope/policy"]);

    // Both deps are outside the discovered set, so there are zero first-party
    // edges -> exit 2 (empty scan), not a false pass.
    const r = run(["--json"], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
  });
});

test("link check: an unreadable/unparseable package.json is a result, never a silent skip", () => {
  withDir((root) => {
    const pkgDir = join(root, "packages", "broken");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), "{ not valid json");
    writePackage(root, { name: "@scope/policy", version: "0.1.0" });
    writePackage(root, { name: "@scope/governance", version: "0.3.0", dependencies: { "@scope/policy": "^0.1.0" } });
    writeLockfile(root, ["@scope/policy", "@scope/governance"]);

    const r = run(["--json"], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const brokenResult = report.results.find((x) => x.check === "link" && String(x.package).includes("broken"));
    assert.ok(brokenResult, `expected a result naming the broken package, got ${r.out}`);
    assert.equal(brokenResult.status, "error");
  });
});

// -------------------------------------------------------------------- empty scan

test("empty scan: no packages/ directory at all exits 2, never a clean pass", () => {
  withDir((root) => {
    const r = run([], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    assert.match(r.out, /refusing to report a clean pass on an empty scan/);
  });
});

test("empty scan: packages/ exists but is empty exits 2, never a clean pass", () => {
  withDir((root) => {
    mkdirSync(join(root, "packages"), { recursive: true });
    const r = run(["--json"], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    assert.ok(report.error, `expected a JSON "error" key, got ${r.out}`);
  });
});

test("empty scan: packages exist but have zero first-party dependency edges exits 2, never a clean pass", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/policy", version: "0.1.0" });
    writePackage(root, { name: "@scope/ui", version: "0.7.2" });
    writeLockfile(root, ["@scope/policy", "@scope/ui"]);

    const r = run(["--json"], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const zeroEdges = report.results.find((x) => x.check === "link" && x.package === "(workspace)");
    assert.ok(zeroEdges, `expected a zero-edges error result, got ${r.out}`);
    assert.equal(zeroEdges.status, "error");
  });
});

// -------------------------------------------------------------------- lockfile check

test("lockfile check: an entry resolved from a remote registry URL is caught", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/copy", version: "0.4.0" });
    writePackage(root, { name: "@scope/surface", version: "0.1.3", dependencies: { "@scope/copy": "~0.4.0" } });
    writeLockfile(root, ["@scope/copy", "@scope/surface"], {
      "packages/surface/node_modules/@scope/copy": {
        version: "0.3.1",
        resolved: "https://registry.npmjs.org/download/@scope/copy/0.3.1/deadbeef",
        integrity: "sha512-abc",
      },
    });

    const r = run(["--json"], root);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const finding = report.results.find(
      (x) => x.check === "lockfile" && x.package === "@scope/copy" && x.status === "finding",
    );
    assert.ok(finding, `expected a lockfile finding for @scope/copy, got ${r.out}`);
    assert.match(finding.detail, /remote registry URL/);
    assert.match(finding.detail, /registry\.npmjs\.org/);
  });
});

test("lockfile check: a nested (non-root-hoisted) local link entry still passes", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/copy", version: "0.4.0" });
    writePackage(root, { name: "@scope/surface", version: "0.1.3", dependencies: { "@scope/copy": "~0.4.0" } });
    writeLockfile(root, ["@scope/copy", "@scope/surface"], {
      "packages/surface/node_modules/@scope/copy": { resolved: "packages/copy", link: true },
    });

    const r = run(["--json"], root);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
  });
});

test("lockfile check: an unrecognised entry shape (neither link:true nor a URL) is a finding, not a pass", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/policy", version: "0.1.0" });
    writePackage(root, { name: "@scope/governance", version: "0.3.0", dependencies: { "@scope/policy": "^0.1.0" } });
    writeLockfile(root, ["@scope/policy", "@scope/governance"], {
      "node_modules/@scope/policy": { version: "0.1.0" }, // no "link", no "resolved" at all
    });

    const r = run(["--json"], root);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const finding = report.results.find((x) => x.check === "lockfile" && x.package === "@scope/policy");
    assert.equal(finding.status, "finding");
    assert.match(finding.detail, /neither a recognised local workspace link/);
  });
});

test("lockfile check: a missing package-lock.json is an error (exit 2), not a silent skip", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/policy", version: "0.1.0" });
    writePackage(root, { name: "@scope/governance", version: "0.3.0", dependencies: { "@scope/policy": "^0.1.0" } });
    // no writeLockfile() call

    const r = run(["--json"], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const lockError = report.results.find((x) => x.check === "lockfile");
    assert.ok(lockError, `expected a lockfile result, got ${r.out}`);
    assert.equal(lockError.status, "error");
    assert.match(lockError.detail, /no package-lock\.json found/);
  });
});

// -------------------------------------------------------------------- combined / clean

test("a fully clean workspace (satisfied ranges, every first-party entry locally linked) exits 0", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/policy", version: "0.1.0" });
    writePackage(root, { name: "@scope/governance", version: "0.3.0", dependencies: { "@scope/policy": "^0.1.0" } });
    writePackage(root, { name: "@scope/ledger", version: "0.1.1", dependencies: { "@scope/policy": "~0.1.0" } });
    writePackage(root, { name: "@scope/catalog", version: "0.2.0", dependencies: { "@scope/governance": "^0.3.0" } });
    writeLockfile(root, ["@scope/policy", "@scope/governance", "@scope/ledger", "@scope/catalog"]);

    const r = run([], root);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    assert.match(r.out, /WORKSPACE LINKS OK/);
  });
});

test("this repository's own current tree passes the gate cleanly", () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const r = run(["--json"], repoRoot);
  assert.equal(r.code, 0, `expected exit 0 against this repo's real tree, got ${r.code}: ${r.out}`);
});

// ------------------------------------------------------- peer/optional sections (#1340)

test("link check: a peerDependencies range is scanned, not just dependencies", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/governance", version: "0.4.0" });
    writePackage(root, { name: "@scope/catalog", version: "0.2.0", peerDependencies: { "@scope/governance": "^0.3.0" } });
    writeLockfile(root, ["@scope/governance", "@scope/catalog"]);

    const r = run(["--json"], root);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const finding = report.results.find((x) => x.check === "link" && x.dependency === "@scope/governance");
    assert.ok(finding, `expected a peerDependencies finding, got ${r.out}`);
    assert.equal(finding.status, "finding");
    assert.equal(finding.section, "peerDependencies");
    assert.match(finding.detail, /peerDependencies/);
  });
});

test("link check: an optionalDependencies range is scanned, not just dependencies", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/governance", version: "0.4.0" });
    writePackage(root, { name: "@scope/catalog", version: "0.2.0", optionalDependencies: { "@scope/governance": "^0.3.0" } });
    writeLockfile(root, ["@scope/governance", "@scope/catalog"]);

    const r = run(["--json"], root);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const finding = report.results.find((x) => x.check === "link" && x.dependency === "@scope/governance");
    assert.ok(finding, `expected an optionalDependencies finding, got ${r.out}`);
    assert.equal(finding.status, "finding");
    assert.equal(finding.section, "optionalDependencies");
  });
});

test("link check: a satisfied peerDependencies range still passes", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/governance", version: "0.3.0" });
    writePackage(root, { name: "@scope/catalog", version: "0.2.0", peerDependencies: { "@scope/governance": "^0.3.0" } });
    writeLockfile(root, ["@scope/governance", "@scope/catalog"]);

    const r = run(["--json"], root);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
  });
});

test("link check: a stale devDependencies range is deliberately NOT scanned (out of scope, issue #1340)", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/governance", version: "0.4.0" });
    writePackage(root, { name: "@scope/catalog", version: "0.2.0", devDependencies: { "@scope/governance": "^0.3.0" } });
    // Only devDependencies edges exist; the link check's edge count only
    // counts DEPENDENCY_RANGE_SECTIONS, so this is an empty scan (exit 2),
    // not a false "satisfied" pass on a range this gate never looked at.
    writeLockfile(root, ["@scope/governance", "@scope/catalog"]);

    const r = run(["--json"], root);
    assert.equal(r.code, 2, `expected exit 2 (empty scan: no dependencies/peerDependencies/optionalDependencies edges), got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const devFinding = report.results.find((x) => x.dependency === "@scope/governance" && x.check === "link");
    assert.ok(!devFinding, `expected no link-check result for the devDependencies-only edge, got ${r.out}`);
  });
});

test("link check: the same dependency in two sections with different ranges is evaluated independently", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/governance", version: "0.3.0" });
    writePackage(root, {
      name: "@scope/catalog",
      version: "0.2.0",
      dependencies: { "@scope/governance": "^0.3.0" }, // satisfied
      peerDependencies: { "@scope/governance": "^0.2.0" }, // NOT satisfied (0.3.0 outside 0.2.x)
    });
    writeLockfile(root, ["@scope/governance", "@scope/catalog"]);

    const r = run(["--json"], root);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const depsResult = report.results.find((x) => x.check === "link" && x.section === "dependencies" && x.dependency === "@scope/governance");
    const peerResult = report.results.find((x) => x.check === "link" && x.section === "peerDependencies" && x.dependency === "@scope/governance");
    assert.equal(depsResult.status, "pass");
    assert.equal(peerResult.status, "finding");
  });
});

// --------------------------------------------------------- version-record check (#366)

test("version-record check: a stale lock version is a finding EVEN when the range is satisfied and the link is local (the exact #366 falsifier)", () => {
  withDir((root) => {
    // `integrator` has no sibling depending on it at all -- exactly the
    // shape #366 was filed against: the link check has no range to evaluate
    // against it (nothing to fail), and the lockfile check sees a perfectly
    // valid local link (nothing to fail there either). Only the
    // version-record check can see this. `policy`/`governance` exist only
    // so the workspace has at least one ordinary dependency edge and this
    // tree is not itself an empty scan (issue #366's own falsifier tree was
    // never an empty one -- `integrator` sat alongside a full workspace).
    writePackage(root, { name: "@scope/policy", version: "0.1.0" });
    writePackage(root, { name: "@scope/governance", version: "0.3.0", dependencies: { "@scope/policy": "^0.1.0" } });
    writePackage(root, { name: "@scope/integrator", version: "0.4.0" });
    writeLockfile(root, ["@scope/policy", "@scope/governance", "@scope/integrator"], {
      "packages/integrator": { name: "@scope/integrator", version: "0.3.0", license: "MIT" },
    });

    const r = run(["--json"], root);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);

    const linkResult = report.results.find((x) => x.check === "link" && x.package === "@scope/integrator");
    assert.ok(!linkResult, `expected no link-check result to exist for a package nothing depends on, got ${r.out}`);

    const lockfileResult = report.results.find((x) => x.check === "lockfile" && x.package === "@scope/integrator");
    assert.equal(lockfileResult.status, "pass", `expected the lockfile (resolution) check to still pass, got ${r.out}`);

    const versionResult = report.results.find((x) => x.check === "version" && x.package === "@scope/integrator");
    assert.ok(versionResult, `expected a version-record result, got ${r.out}`);
    assert.equal(versionResult.status, "finding");
    assert.match(versionResult.detail, /0\.4\.0/);
    assert.match(versionResult.detail, /0\.3\.0/);
  });
});

test("version-record check: a lock version matching the manifest passes (the falsifier's other tree)", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/policy", version: "0.1.0" });
    writePackage(root, { name: "@scope/governance", version: "0.3.0", dependencies: { "@scope/policy": "^0.1.0" } });
    writePackage(root, { name: "@scope/integrator", version: "0.4.0" });
    // writeLockfile's default packages/<shortName> mirror already records
    // 0.4.0 for integrator (read straight off the manifest just written) --
    // no override needed to make this the "after the fix" tree from #366's
    // own falsifier.
    writeLockfile(root, ["@scope/policy", "@scope/governance", "@scope/integrator"]);

    const r = run(["--json"], root);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const versionResult = report.results.find((x) => x.check === "version" && x.package === "@scope/integrator");
    assert.equal(versionResult.status, "pass");
  });
});

test("version-record check: a workspace member with no \"packages/<dir>\" lock entry at all is an error, not a silent pass", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/integrator", version: "0.4.0" });
    writeLockfile(root, ["@scope/integrator"], {
      "packages/integrator": undefined, // JSON.stringify drops undefined-valued keys entirely
    });

    const r = run(["--json"], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const versionResult = report.results.find((x) => x.check === "version" && x.package === "@scope/integrator");
    assert.ok(versionResult, `expected a version-record result, got ${r.out}`);
    assert.equal(versionResult.status, "error");
    assert.match(versionResult.detail, /no "packages\/integrator" entry/);
  });
});

test("version-record check: a \"packages/<dir>\" entry with no \"version\" field is an error, not a silent pass", () => {
  withDir((root) => {
    writePackage(root, { name: "@scope/integrator", version: "0.4.0" });
    writeLockfile(root, ["@scope/integrator"], {
      "packages/integrator": { name: "@scope/integrator", license: "MIT" }, // no "version"
    });

    const r = run(["--json"], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const versionResult = report.results.find((x) => x.check === "version" && x.package === "@scope/integrator");
    assert.equal(versionResult.status, "error");
    assert.match(versionResult.detail, /no "version" field/);
  });
});
