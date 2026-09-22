import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Hermetic end-to-end coverage, same convention as
// check-workspace-links.test.mjs: every fixture is a real, throwaway
// directory under mkdtemp, and the real script is spawned exactly the way
// CI spawns it — no git repo, no npm install, no build. This gate only
// reads packages/*/package.json, package-lock.json, and an optional
// allowlist JSON file from cwd.

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-lock-workspace-versions.mjs");

function run(args, cwd) {
  try {
    const out = execFileSync(process.execPath, [scriptPath, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? "") + (error.stderr ?? "") };
  }
}

function withDir(build) {
  const root = mkdtempSync(join(tmpdir(), "lock-workspace-versions-test-"));
  try {
    build(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writePackage(root, dirName, { name, version }) {
  const pkgDir = join(root, "packages", dirName);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name, version, license: "MIT" }, null, 2) + "\n");
}

function writeLock(root, entries) {
  const packages = {};
  for (const [dirName, version] of Object.entries(entries)) {
    packages[`packages/${dirName}`] = { name: `@scope/${dirName}`, version, license: "MIT" };
  }
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }, null, 2) + "\n");
}

function writeAllowlistFile(root, path, body) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(body, null, 2) + "\n");
}

// ------------------------------------------------------------------ EMPTY SCAN

test("empty scan: no packages/ directory at all refuses a clean pass", () => {
  withDir((root) => {
    writeLock(root, {});
    const r = run(["--json"], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    assert.match(JSON.parse(r.out).error, /refusing to report a clean pass on an empty scan/);
  });
});

// ------------------------------------------------------------------ basic pass/fail

test("in-sync lock and manifest versions pass for every discovered package, derived from the tree", () => {
  withDir((root) => {
    writePackage(root, "alpha", { name: "@scope/alpha", version: "1.2.3" });
    writePackage(root, "beta", { name: "@scope/beta", version: "0.4.0" });
    writeLock(root, { alpha: "1.2.3", beta: "0.4.0" });

    const r = run(["--json"], root);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    assert.equal(report.results.length, 2);
    assert.ok(report.results.every((x) => x.status === "pass"));
  });
});

test("a stale lock entry is a finding and fails the gate", () => {
  withDir((root) => {
    writePackage(root, "writer", { name: "@scope/writer", version: "0.3.8" });
    writeLock(root, { writer: "0.3.6" });

    const r = run(["--json"], root);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const finding = report.results.find((x) => x.package === "@scope/writer");
    assert.equal(finding.status, "finding");
    assert.match(finding.detail, /records version 0\.3\.6/);
    assert.match(finding.detail, /declares 0\.3\.8/);
    assert.match(finding.detail, /npm ci/);
  });
});

test("a genuinely new twentieth package is discovered from the tree, not missed by a hand-written list", () => {
  withDir((root) => {
    // Nineteen in-sync packages plus one stale twentieth — proves the scan
    // is not bounded by any count baked into the gate (issue #907's rule).
    const entries = {};
    for (let i = 0; i < 19; i++) {
      const dirName = `pkg${i}`;
      writePackage(root, dirName, { name: `@scope/${dirName}`, version: "1.0.0" });
      entries[dirName] = "1.0.0";
    }
    writePackage(root, "twentieth", { name: "@scope/twentieth", version: "2.0.0" });
    entries.twentieth = "1.9.0";
    writeLock(root, entries);

    const r = run(["--json"], root);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    assert.equal(report.results.length, 20);
    const finding = report.results.find((x) => x.package === "@scope/twentieth");
    assert.equal(finding.status, "finding");
  });
});

test("a package missing from the lock entirely is an error, not a silent pass", () => {
  withDir((root) => {
    writePackage(root, "orphan", { name: "@scope/orphan", version: "1.0.0" });
    writeLock(root, {});

    const r = run(["--json"], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const finding = report.results.find((x) => x.package === "@scope/orphan");
    assert.equal(finding.status, "error");
    assert.match(finding.detail, /no "packages\/orphan" entry/);
  });
});

// ------------------------------------------------------------------ ratchet

test("a pinned allowlist entry waives the exact drift it names and still exits 0, but says the run is not clean", () => {
  withDir((root) => {
    writePackage(root, "writer", { name: "@scope/writer", version: "0.3.8" });
    writeLock(root, { writer: "0.3.6" });
    const allowlistPath = join(root, "governance", "known-lock-version-drift.json");
    writeAllowlistFile(root, allowlistPath, {
      issue: "#917",
      note: "test fixture",
      packages: { writer: { lockVersion: "0.3.6", manifestVersion: "0.3.8" } },
    });

    const r = run(["--json", "--allowlist", allowlistPath], root);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    assert.equal(report.results[0].status, "waived");
    assert.equal(report.waived.length, 1);
    assert.equal(report.waived[0].issue, "#917");

    const human = run(["--allowlist", allowlistPath], root);
    assert.match(human.out, /a waived run is not a clean one/);
  });
});

test("an allowlist entry pinned to a DIFFERENT pair than what is actually measured does not waive it — the pin must match exactly", () => {
  withDir((root) => {
    writePackage(root, "writer", { name: "@scope/writer", version: "0.3.8" });
    writeLock(root, { writer: "0.3.6" });
    const allowlistPath = join(root, "governance", "known-lock-version-drift.json");
    // Pinned to a stale pair from an earlier measurement (e.g. lock has
    // since regenerated further, or the manifest bumped again) — the
    // waiver must not silently cover new drift it never actually observed.
    writeAllowlistFile(root, allowlistPath, {
      issue: "#917",
      note: "test fixture",
      packages: { writer: { lockVersion: "0.3.5", manifestVersion: "0.3.7" } },
    });

    const r = run(["--json", "--allowlist", allowlistPath], root);
    // Two independent problems, both reported: the actual, unwaived drift
    // (a "finding") AND a pin that no longer matches anything (an "error",
    // see the self-cleaning-ratchet test below) — error dominates finding in
    // the worst-of aggregation, same rule check-workspace-links.mjs uses.
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const findings = report.results.filter((x) => x.status === "finding");
    assert.ok(findings.some((x) => x.package === "@scope/writer"));
    assert.equal(report.waived.length, 0);
  });
});

test("a stale allowlist entry that no longer matches ANY current drift is itself a finding (self-cleaning ratchet)", () => {
  withDir((root) => {
    // The lock and manifest now agree — the drift the allowlist entry
    // pinned has already been fixed by someone regenerating the lock — but
    // nobody deleted the now-stale waiver entry.
    writePackage(root, "writer", { name: "@scope/writer", version: "0.3.8" });
    writeLock(root, { writer: "0.3.8" });
    const allowlistPath = join(root, "governance", "known-lock-version-drift.json");
    writeAllowlistFile(root, allowlistPath, {
      issue: "#917",
      note: "test fixture",
      packages: { writer: { lockVersion: "0.3.6", manifestVersion: "0.3.8" } },
    });

    const r = run(["--json", "--allowlist", allowlistPath], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const stale = report.results.find((x) => x.package === "writer" && x.status === "error");
    assert.ok(stale, `expected a stale-allowlist-entry error, got: ${JSON.stringify(report.results)}`);
    assert.match(stale.detail, /matches nothing/);
  });
});

test("an allowlist entry naming a package directory that no longer exists is itself a finding", () => {
  withDir((root) => {
    writePackage(root, "writer", { name: "@scope/writer", version: "0.3.8" });
    writeLock(root, { writer: "0.3.8" });
    const allowlistPath = join(root, "governance", "known-lock-version-drift.json");
    writeAllowlistFile(root, allowlistPath, {
      issue: "#917",
      note: "test fixture",
      packages: { "retired-package": { lockVersion: "0.1.0", manifestVersion: "0.2.0" } },
    });

    const r = run(["--json", "--allowlist", allowlistPath], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    const stale = report.results.find((x) => x.package === "retired-package");
    assert.ok(stale, `expected a finding for the retired package's stale entry, got: ${JSON.stringify(report.results)}`);
    assert.match(stale.detail, /no such package exists under packages\//);
  });
});

test("an allowlist with no \"issue\" field is refused as not a waiver", () => {
  withDir((root) => {
    writePackage(root, "writer", { name: "@scope/writer", version: "0.3.8" });
    writeLock(root, { writer: "0.3.6" });
    const allowlistPath = join(root, "governance", "known-lock-version-drift.json");
    writeAllowlistFile(root, allowlistPath, { packages: { writer: { lockVersion: "0.3.6", manifestVersion: "0.3.8" } } });

    const r = run(["--json", "--allowlist", allowlistPath], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    assert.match(JSON.parse(r.out).error, /a waiver with nothing tracking it is not a waiver/);
  });
});

test("--no-allowlist ignores a present allowlist file and reports the raw, unwaived drift", () => {
  withDir((root) => {
    writePackage(root, "writer", { name: "@scope/writer", version: "0.3.8" });
    writeLock(root, { writer: "0.3.6" });
    const allowlistPath = join(root, "governance", "known-lock-version-drift.json");
    writeAllowlistFile(root, allowlistPath, {
      issue: "#917",
      note: "test fixture",
      packages: { writer: { lockVersion: "0.3.6", manifestVersion: "0.3.8" } },
    });

    const r = run(["--json", "--no-allowlist"], root);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}: ${r.out}`);
    const report = JSON.parse(r.out);
    assert.equal(report.results[0].status, "finding");
  });
});

// ------------------------------------------------------------------ malformed input

test("a missing package-lock.json is an error, never a silent pass", () => {
  withDir((root) => {
    writePackage(root, "writer", { name: "@scope/writer", version: "0.3.8" });
    const r = run(["--json"], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    assert.match(JSON.parse(r.out).error, /no package-lock\.json found/);
  });
});

test("a package-lock.json with no \"packages\" key is refused as unreadable", () => {
  withDir((root) => {
    writePackage(root, "writer", { name: "@scope/writer", version: "0.3.8" });
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }, null, 2) + "\n");
    const r = run(["--json"], root);
    assert.equal(r.code, 2, `expected exit 2, got ${r.code}: ${r.out}`);
    assert.match(JSON.parse(r.out).error, /not an npm lockfile/);
  });
});
