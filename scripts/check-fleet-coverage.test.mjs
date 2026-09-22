// check-fleet-coverage.test.mjs — hermetic end-to-end coverage for
// scripts/check-fleet-coverage.mjs, same convention as
// check-lock-workspace-versions.test.mjs: every fixture is a real,
// throwaway directory under mkdtemp, and the real script is spawned exactly
// the way a caller (or a future ci.yml step) would invoke it — no in-process
// import of its internals.
//
// This suite needs the REAL, BUILT `@clossys/observer` (the script imports
// it by bare specifier, exactly like scripts/gate-run-history.mjs already
// does for the same package) — it is not part of `check:gates`, which runs
// in the dependency-free `safety` job before any workspace build exists.
// Wired into ci.yml's post-build "build and test" job instead, next to
// "Gate run-history reader".

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-fleet-coverage.mjs");

function run(args, cwd) {
  try {
    const out = execFileSync(process.execPath, [scriptPath, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? "") + (error.stderr ?? "") };
  }
}

function withDir(build) {
  const root = mkdtempSync(join(tmpdir(), "fleet-coverage-test-"));
  try {
    return build(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

function writeCatalog(root, packages) {
  const path = join(root, "packages.json");
  writeJson(path, { packages });
  return path;
}

function writeManifest(repoRoot, relativePath, manifest) {
  writeJson(join(repoRoot, relativePath), manifest);
}

function writeDeclaration(repoRoot, declaration) {
  // Written as raw text, exactly like a real committed file — proves the
  // script reads the file's own bytes rather than assuming a pre-parsed
  // object, matching @clossys/observer's own documented "raw fetched
  // string" transport.
  writeJson(join(repoRoot, "clossys", "coverage.json"), declaration);
}

test("installed-in-root: a root-manifest pin resolves to installed, recording package.json as the carrying path", () => {
  withDir((root) => {
    const catalog = writeCatalog(root, ["@clossys/observer"]);
    const repoRoot = join(root, "repo-a");
    writeManifest(repoRoot, "package.json", { name: "repo-a", dependencies: { "@clossys/observer": "^0.4.0" } });

    const result = run(["--packages", catalog, "--format", "json", repoRoot]);
    assert.equal(result.code, 0, result.out);
    const report = JSON.parse(result.out);
    assert.equal(report.result.verdict, "satisfied");
    const cell = report.cells.find((entry) => entry.package === "@clossys/observer");
    assert.equal(cell.state, "installed");
    assert.equal(cell.repository, "repo-a");
    assert.deepEqual(cell.manifestPaths, ["package.json"]);
  });
});

test("installed-in-workspace-package: a pin inside a nested workspace manifest resolves to installed, recording that manifest's path (#395's any-manifest decision)", () => {
  withDir((root) => {
    const catalog = writeCatalog(root, ["@clossys/observer"]);
    const repoRoot = join(root, "repo-b");
    // The root manifest exists and does NOT pin the fleet package — proving
    // this is genuinely an any-manifest result, not an accidental
    // root-manifest one.
    writeManifest(repoRoot, "package.json", { name: "repo-b", private: true, workspaces: ["packages/*"] });
    writeManifest(repoRoot, "packages/product/package.json", { name: "product", dependencies: { "@clossys/observer": "^0.4.0" } });

    const result = run(["--packages", catalog, "--format", "json", repoRoot]);
    assert.equal(result.code, 0, result.out);
    const report = JSON.parse(result.out);
    assert.equal(report.result.verdict, "satisfied");
    const cell = report.cells.find((entry) => entry.package === "@clossys/observer");
    assert.equal(cell.state, "installed");
    assert.deepEqual(cell.manifestPaths, ["packages/product/package.json"]);
  });
});

test("declared-absent with reason: a well-formed declaration resolves to declared-absent and satisfies the matrix", () => {
  withDir((root) => {
    const catalog = writeCatalog(root, ["@clossys/observer"]);
    const repoRoot = join(root, "repo-c");
    writeManifest(repoRoot, "package.json", { name: "repo-c" });
    // The exact fixture docs/contracts/coverage-declaration.fixture.json
    // ships — proving that fixture parses through the real, built parser
    // this script actually calls, not merely a hand-written shape that
    // happens to look similar.
    writeDeclaration(repoRoot, {
      schemaVersion: 1,
      repository: "repo-c",
      declaredAbsences: [
        {
          package: "@clossys/observer",
          reason: "This repository has no telemetry lane: it ships no gate whose efficacy would be measured.",
        },
      ],
    });

    const result = run(["--packages", catalog, "--format", "json", repoRoot]);
    assert.equal(result.code, 0, result.out);
    const report = JSON.parse(result.out);
    assert.equal(report.result.verdict, "satisfied");
    const cell = report.cells.find((entry) => entry.package === "@clossys/observer");
    assert.equal(cell.state, "declared-absent");
    assert.match(cell.reason, /no telemetry lane/);
  });
});

test("declared-absent without reason is invalid: the whole declaration fails validation and the cell is unclassified (exit 2)", () => {
  withDir((root) => {
    const catalog = writeCatalog(root, ["@clossys/observer"]);
    const repoRoot = join(root, "repo-d");
    writeManifest(repoRoot, "package.json", { name: "repo-d" });
    writeDeclaration(repoRoot, {
      schemaVersion: 1,
      repository: "repo-d",
      declaredAbsences: [{ package: "@clossys/observer", reason: "" }],
    });

    const result = run(["--packages", catalog, "--format", "json", repoRoot]);
    assert.equal(result.code, 2, result.out);
    const report = JSON.parse(result.out);
    assert.equal(report.result.verdict, "indeterminate");
    const cell = report.cells.find((entry) => entry.package === "@clossys/observer");
    assert.equal(cell.state, "unclassified");
    assert.equal(cell.reason, "declaration-unreadable");
  });
});

test("unclassified: no manifest pin and no declaration at all fails closed with exit 2, never a silent pass", () => {
  withDir((root) => {
    const catalog = writeCatalog(root, ["@clossys/observer"]);
    const repoRoot = join(root, "repo-e");
    writeManifest(repoRoot, "package.json", { name: "repo-e" });

    const result = run(["--packages", catalog, "--format", "json", repoRoot]);
    assert.equal(result.code, 2, result.out);
    const report = JSON.parse(result.out);
    assert.equal(report.result.verdict, "indeterminate");
    const cell = report.cells.find((entry) => entry.package === "@clossys/observer");
    assert.equal(cell.state, "unclassified");
    assert.equal(cell.reason, "not-installed-and-not-declared");
  });
});

test("zero repositories supplied is indeterminate, never a vacuous pass", () => {
  withDir((root) => {
    const catalog = writeCatalog(root, ["@clossys/observer"]);
    const result = run(["--packages", catalog, "--format", "json"]);
    assert.equal(result.code, 2, result.out);
    const report = JSON.parse(result.out);
    assert.equal(report.result.verdict, "indeterminate");
    assert.equal(report.result.reason, "no-cells-to-grade");
    assert.deepEqual(report.cells, []);
  });
});

test("a repository both installed and declared-absent for the same package is violated (exit 1), and never names a competing package", () => {
  withDir((root) => {
    const catalog = writeCatalog(root, ["@clossys/observer"]);
    const repoRoot = join(root, "repo-f");
    // A real-shaped competitor: a non-catalog package pinned alongside the
    // fleet one, mirroring #504's own "one repository installs a package
    // from the other scope covering the same role, AND the role package
    // itself" scenario. This script must never surface its name anywhere.
    writeManifest(repoRoot, "package.json", {
      name: "repo-f",
      dependencies: { "@clossys/observer": "^0.4.0", "@other-scope/telemetry-package": "^2.0.0" },
    });
    writeDeclaration(repoRoot, {
      schemaVersion: 1,
      repository: "repo-f",
      declaredAbsences: [{ package: "@clossys/observer", reason: "stale entry -- should have been removed when this was installed" }],
    });

    const result = run(["--packages", catalog, "--format", "json", repoRoot]);
    assert.equal(result.code, 1, result.out);
    const report = JSON.parse(result.out);
    assert.equal(report.result.verdict, "violated");
    assert.equal(report.contradictions.length, 1);
    assert.equal(report.contradictions[0].package, "@clossys/observer");
    assert.doesNotMatch(JSON.stringify(report), /other-scope/);
    // The rendered text report must carry only the fleet's own package name
    // and the repository's own declared reason -- never a second,
    // competing package name this script itself would have had to discover,
    // even though that competing package really is sitting in the manifest
    // this script read.
    const textResult = run(["--packages", catalog, repoRoot]);
    assert.doesNotMatch(textResult.out, /other-scope/);
  });
});

test("--repo <id>=<path> assigns an explicit repository id, distinct from the checkout directory's own basename", () => {
  withDir((root) => {
    const catalog = writeCatalog(root, ["@clossys/observer"]);
    const repoRoot = join(root, "some-directory-name");
    writeManifest(repoRoot, "package.json", { name: "irrelevant", dependencies: { "@clossys/observer": "^0.4.0" } });

    const result = run(["--packages", catalog, "--format", "json", "--repo", `chosen-id=${repoRoot}`]);
    assert.equal(result.code, 0, result.out);
    const report = JSON.parse(result.out);
    assert.equal(report.cells[0].repository, "chosen-id");
  });
});

test("--inventory + --root resolves each inventory id to <root>/<id>, the hub inventory shape @clossys/launcher writes", () => {
  withDir((root) => {
    const catalog = writeCatalog(root, ["@clossys/observer"]);
    const checkoutsRoot = join(root, "checkouts");
    writeManifest(join(checkoutsRoot, "app"), "package.json", { name: "app", dependencies: { "@clossys/observer": "^0.4.0" } });
    const inventoryPath = join(root, "inventory.json");
    writeJson(inventoryPath, { schemaVersion: 1, repositories: [{ id: "app" }] });

    const result = run(["--packages", catalog, "--format", "json", "--inventory", inventoryPath, "--root", checkoutsRoot]);
    assert.equal(result.code, 0, result.out);
    const report = JSON.parse(result.out);
    assert.equal(report.cells[0].repository, "app");
    assert.equal(report.cells[0].state, "installed");
  });
});

test("a duplicate repository id across sources is a usage error (exit 2), not a silently-merged pass", () => {
  withDir((root) => {
    const catalog = writeCatalog(root, ["@clossys/observer"]);
    const repoRoot = join(root, "dup");
    writeManifest(repoRoot, "package.json", { name: "dup" });

    const result = run(["--packages", catalog, repoRoot, "--repo", `dup=${repoRoot}`]);
    assert.equal(result.code, 2, result.out);
    assert.match(result.out, /duplicate repository id/);
  });
});

test("a checkout directory that does not exist on disk at all is installed-inventory-unreadable, not silently zero", () => {
  withDir((root) => {
    const catalog = writeCatalog(root, ["@clossys/observer"]);
    const missing = join(root, "does-not-exist");

    const result = run(["--packages", catalog, "--format", "json", missing]);
    assert.equal(result.code, 2, result.out);
    const report = JSON.parse(result.out);
    const cell = report.cells.find((entry) => entry.package === "@clossys/observer");
    assert.equal(cell.state, "unclassified");
    assert.equal(cell.reason, "installed-inventory-unreadable");
  });
});

test("missing --packages is a usage error, exit 2, with usage text", () => {
  withDir((root) => {
    const result = run([root]);
    assert.equal(result.code, 2);
    assert.match(result.out, /--packages is required/);
  });
});
