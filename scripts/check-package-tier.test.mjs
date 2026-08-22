import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { collectClaims, evaluate, lifecycleStatuses, parseArgs } from "./check-package-tier.mjs";

// Two layers, the same split check-package-visibility.test.mjs uses:
//
//   1. UNIT — imports the real exported functions and feeds them fabricated
//      manifests and contracts. No filesystem, no spawn.
//   2. CLI — spawns the real script against a fabricated repository in a temp
//      directory, proving all THREE exit codes are reachable end to end. A
//      gate whose failure paths are only unit-tested has never been observed
//      to actually fail, which is the state this repository's own history
//      says not to trust (see docs/DECISIONS.md 4).

const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), "check-package-tier.mjs");
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ------------------------------------------------------------------ helpers

function manifest(name, extra = {}) {
  return { pkgDir: `packages/${name.split("/").pop()}`, name, private: false, ...extra };
}

function tierWith({ programs = [], primitives = [], awaitingProgram } = {}) {
  const tier = { schemaVersion: 1, programs, primitives };
  if (awaitingProgram) tier.awaitingProgram = awaitingProgram;
  return tier;
}

function program(name, packages) {
  return { name, addresses: "a repository", status: "cut", packages };
}

function primitive(name) {
  return { name, shipsGate: false, reason: "no addressee, therefore no role, therefore no gate" };
}

function awaiting(name) {
  return {
    name,
    shipsGate: false,
    reason: "published, no program yet, gate known-missing",
    resolvedBy: "docs/DECISIONS.md 11, then the cut",
  };
}

function statusesFor(entries) {
  return lifecycleStatuses({ schemaVersion: 1, packages: entries });
}

function findings(results) {
  return results.filter((r) => r.status === "finding");
}

/** Builds a throwaway repository: packages/<n>/package.json + both contracts. */
function fixtureRepo({ packages, tier, lifecycle }) {
  const dir = mkdtempSync(join(tmpdir(), "package-tier-"));
  for (const [name, pkg] of Object.entries(packages)) {
    const pkgDir = join(dir, "packages", name);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify(pkg, null, 2));
  }
  mkdirSync(join(dir, "docs", "contracts"), { recursive: true });
  if (tier !== undefined) {
    writeFileSync(join(dir, "docs/contracts/package-tier.json"), JSON.stringify(tier, null, 2));
  }
  writeFileSync(
    join(dir, "docs/contracts/package-lifecycle.json"),
    JSON.stringify(lifecycle ?? { schemaVersion: 1, packages: [] }, null, 2),
  );
  return dir;
}

/** Runs the real CLI in `cwd`, returning { code, stdout }. Never throws. */
function runCli(cwd, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [scriptPath, ...args], { cwd, encoding: "utf8" });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status, stdout: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

// -------------------------------------------------------------------- unit

test("a package classified in a program passes", () => {
  const { results } = evaluate({
    manifests: [manifest("@scope/builder")],
    statuses: statusesFor([{ name: "@scope/builder", status: "published" }]),
    tier: tierWith({ programs: [program("operation", ["@scope/builder"])] }),
  });
  assert.deepEqual(findings(results), []);
});

test("a package classified nowhere is a finding — the drift this gate exists for", () => {
  const { results } = evaluate({
    manifests: [manifest("@scope/builder"), manifest("@scope/newcomer")],
    statuses: statusesFor([
      { name: "@scope/builder", status: "published" },
      { name: "@scope/newcomer", status: "published" },
    ]),
    tier: tierWith({ programs: [program("operation", ["@scope/builder"])] }),
  });
  const found = findings(results);
  assert.equal(found.length, 1);
  assert.equal(found[0].package, "@scope/newcomer");
  assert.match(found[0].detail, /not classified/);
});

test("a package with no lifecycle entry at all still has to be classified", () => {
  const { results } = evaluate({
    manifests: [manifest("@scope/newcomer")],
    statuses: statusesFor([]),
    tier: tierWith({ programs: [program("operation", ["@scope/other"])] }),
  });
  assert.equal(findings(results).some((r) => r.package === "@scope/newcomer"), true);
});

test("the primitive tier is a valid classification, not an absence", () => {
  const { results } = evaluate({
    manifests: [manifest("@scope/domain")],
    statuses: statusesFor([{ name: "@scope/domain", status: "published" }]),
    tier: tierWith({ primitives: [primitive("@scope/domain")] }),
  });
  assert.deepEqual(findings(results), []);
});

test("awaitingProgram is a valid classification — the three known-missing gates do not fail this gate", () => {
  const { results } = evaluate({
    manifests: [manifest("@scope/auth"), manifest("@scope/comms"), manifest("@scope/consent")],
    statuses: statusesFor([
      { name: "@scope/auth", status: "published" },
      { name: "@scope/comms", status: "published" },
      { name: "@scope/consent", status: "published" },
    ]),
    tier: tierWith({
      awaitingProgram: [awaiting("@scope/auth"), awaiting("@scope/comms"), awaiting("@scope/consent")],
    }),
  });
  assert.deepEqual(findings(results), []);
});

test("an awaitingProgram entry with no resolvedBy is a finding — no standing exemption without an expiry", () => {
  const entry = awaiting("@scope/auth");
  delete entry.resolvedBy;
  const { results } = evaluate({
    manifests: [manifest("@scope/auth")],
    statuses: statusesFor([{ name: "@scope/auth", status: "published" }]),
    tier: tierWith({ awaitingProgram: [entry] }),
  });
  assert.match(findings(results).map((r) => r.detail).join("\n"), /resolvedBy/);
});

test("a primitive that does not declare shipsGate:false is a finding", () => {
  const { malformed } = collectClaims(
    tierWith({ primitives: [{ name: "@scope/domain", reason: "because", shipsGate: true }] }),
  );
  assert.match(malformed.join("\n"), /shipsGate/);
});

test("a program with no addressee is a finding — a program is identified by who it addresses", () => {
  const { malformed } = collectClaims(tierWith({ programs: [{ name: "operation", packages: [] }] }));
  assert.match(malformed.join("\n"), /addresses/);
});

test("classifying one package twice is a finding, in one program or across two", () => {
  const { results } = evaluate({
    manifests: [manifest("@scope/domain")],
    statuses: statusesFor([{ name: "@scope/domain", status: "published" }]),
    tier: tierWith({
      programs: [program("operation", ["@scope/domain"])],
      primitives: [primitive("@scope/domain")],
    }),
  });
  const found = findings(results);
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /classified 2 times/);
});

test("a declared name with no package directory is a finding — a rename cannot leave the contract stale", () => {
  const { results } = evaluate({
    manifests: [manifest("@scope/builder")],
    statuses: statusesFor([{ name: "@scope/builder", status: "published" }]),
    tier: tierWith({ programs: [program("operation", ["@scope/builder", "@scope/ghost"])] }),
  });
  const found = findings(results);
  assert.equal(found.length, 1);
  assert.equal(found[0].package, "@scope/ghost");
});

test("a deprecated donor is not required to claim a program", () => {
  const { results } = evaluate({
    manifests: [manifest("@scope/ui")],
    statuses: statusesFor([{ name: "@scope/ui", status: "deprecated" }]),
    tier: tierWith({ programs: [program("expression", [])] }),
  });
  assert.deepEqual(findings(results), []);
});

test("a private manifest is not a package this repository classifies", () => {
  const { results } = evaluate({
    manifests: [manifest("@scope/internal", { private: true })],
    statuses: statusesFor([]),
    tier: tierWith({ primitives: [primitive("@scope/domain")] }),
  });
  // The private package produces no finding; the declared-but-absent
  // @scope/domain still does, which is what proves the scan ran at all.
  assert.deepEqual(findings(results).map((r) => r.package), ["@scope/domain"]);
});

test("an unreadable manifest is an error, never a silent skip", () => {
  const { results } = evaluate({
    manifests: [{ pkgDir: "packages/broken", error: "packages/broken/package.json is not valid JSON" }],
    statuses: statusesFor([]),
    tier: tierWith({ primitives: [] }),
  });
  assert.equal(results.some((r) => r.status === "error"), true);
});

test("parseArgs rejects an unrecognised flag rather than ignoring it", () => {
  assert.equal(parseArgs(["--tier", "x.json"]).args.tier, "x.json");
  assert.match(parseArgs(["--nope"]).error, /unrecognised/);
});

// --------------------------------------------------------------------- CLI

test("CLI exit 0: every live package classified exactly once", () => {
  const dir = fixtureRepo({
    packages: { builder: { name: "@scope/builder" }, domain: { name: "@scope/domain" } },
    tier: tierWith({
      programs: [program("operation", ["@scope/builder"])],
      primitives: [primitive("@scope/domain")],
    }),
    lifecycle: {
      schemaVersion: 1,
      packages: [
        { name: "@scope/builder", status: "published" },
        { name: "@scope/domain", status: "published" },
      ],
    },
  });
  try {
    const { code, stdout } = runCli(dir);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /PACKAGE TIER OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI exit 1: an unclassified package fails the gate", () => {
  const dir = fixtureRepo({
    packages: { builder: { name: "@scope/builder" }, newcomer: { name: "@scope/newcomer" } },
    tier: tierWith({ programs: [program("operation", ["@scope/builder"])] }),
    lifecycle: {
      schemaVersion: 1,
      packages: [
        { name: "@scope/builder", status: "published" },
        { name: "@scope/newcomer", status: "published" },
      ],
    },
  });
  try {
    const { code, stdout } = runCli(dir);
    assert.equal(code, 1, stdout);
    assert.match(stdout, /PACKAGE TIER FAIL/);
    assert.match(stdout, /@scope\/newcomer/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI exit 2: a missing contract file cannot be reported as a clean pass", () => {
  const dir = fixtureRepo({ packages: { builder: { name: "@scope/builder" } }, tier: undefined });
  try {
    const { code, stdout } = runCli(dir);
    assert.equal(code, 2, stdout);
    assert.match(stdout, /could not read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI exit 2: an empty scan is never a clean pass", () => {
  const dir = fixtureRepo({ packages: {}, tier: tierWith({ primitives: [primitive("@scope/domain")] }) });
  try {
    const { code, stdout } = runCli(dir);
    assert.equal(code, 2, stdout);
    assert.match(stdout, /empty scan/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI exit 2: a contract that classifies nothing is never a clean pass", () => {
  const dir = fixtureRepo({
    packages: { ui: { name: "@scope/ui" } },
    tier: tierWith({ programs: [program("expression", [])] }),
    lifecycle: { schemaVersion: 1, packages: [{ name: "@scope/ui", status: "deprecated" }] },
  });
  try {
    const { code, stdout } = runCli(dir);
    assert.equal(code, 2, stdout);
    assert.match(stdout, /classifies no package names/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI exit 0 against this repository's own tree", () => {
  const { code, stdout } = runCli(repoRoot);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /PACKAGE TIER OK/);
});
