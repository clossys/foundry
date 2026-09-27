import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { admissionExitCode, evaluateAdmission, evaluateStarter, validateStarterRequest } from "./core.js";
import { main } from "./cli.js";
import { checkAdmission } from "./node-runtime.js";

/**
 * Issue #1492. The admission check calls ledgerSuccession on the corpus bytes
 * in docs/contracts/installed-ledger.fixture.json. Reading that file here is
 * test-only.
 */
const REPO = new URL("../../../", import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, REPO), "utf8");
const text = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const utf8 = (value: string): Buffer => Buffer.from(value, "utf8");

interface PackageRow { name: string; version: string; integrity: string; placement: "dependencies" | "devDependencies" }
interface Corpus {
  ledgers: { name: string; ledger: { packages: PackageRow[] } }[];
  successions: { name: string; base: string | null; head: string }[];
}
const CORPUS = JSON.parse(read("docs/contracts/installed-ledger.fixture.json")) as Corpus;
const ledger = (name: string) => CORPUS.ledgers.find((entry) => entry.name === name)!.ledger;
const bytesOf = (name: string): Buffer => utf8(text(ledger(name)));
const pair = (name: string) => CORPUS.successions.find((entry) => entry.name === name)!;

const integrity = `sha512-${"a".repeat(85)}A==`;
const starter = { name: "@clossys/starter", version: "0.1.0", integrity, bin: "foundry-starter" as const };
const advisor = { name: "@clossys/advisor", version: "0.1.3", integrity, bin: "advisor-execution-readiness" as const };
const target = { name: "@fixture/starter-target", version: "1.2.3", integrity, bin: "target-check", invocation: "single-json-input" as const };

function request(packageManager: "npm" | "pnpm" = "npm", overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    phase: "admission",
    packageManager,
    snapshot: { repository: "consumer/repository", maxAgeMs: 60_000 },
    starter, advisor, target,
    evidence: { assessment: "evidence/assessment.json", targetInput: "evidence/target.json" },
    ...overrides,
  };
}

function npmInstall(packages: readonly PackageRow[], mutate?: (manifest: { dependencies: Record<string, string>; devDependencies: Record<string, string> }, lock: { packages: Record<string, unknown> }) => void) {
  const manifest = { dependencies: {} as Record<string, string>, devDependencies: {} as Record<string, string> };
  const lockPackages: Record<string, unknown> = {};
  for (const pkg of packages) {
    manifest[pkg.placement][pkg.name] = pkg.version;
    lockPackages[`node_modules/${pkg.name}`] = { version: pkg.version, integrity: pkg.integrity };
  }
  lockPackages[""] = { dependencies: manifest.dependencies, devDependencies: manifest.devDependencies };
  const lock = { packages: lockPackages };
  mutate?.(manifest, lock);
  return { manifest, lock };
}

function pnpmInstall(packages: readonly PackageRow[], mutate?: (packages: PackageRow[]) => PackageRow[]) {
  const rows = mutate ? mutate(packages.map((pkg) => ({ ...pkg }))) : packages;
  const lines = ["lockfileVersion: '9.0'", "importers:", "  .:"];
  const manifest = { dependencies: {} as Record<string, string>, devDependencies: {} as Record<string, string> };
  for (const placement of ["dependencies", "devDependencies"] as const) {
    const group = rows.filter((pkg) => pkg.placement === placement);
    if (group.length === 0) continue;
    lines.push(`    ${placement}:`);
    for (const pkg of group) {
      manifest[placement][pkg.name] = pkg.version;
      lines.push(`      '${pkg.name}':`, `        specifier: ${pkg.version}`, `        version: ${pkg.version}`);
    }
  }
  lines.push("packages:");
  for (const pkg of rows) lines.push(`  '${pkg.name}@${pkg.version}':`, `    resolution: {integrity: ${pkg.integrity}}`);
  return { manifest, lock: `${lines.join("\n")}\n` };
}

function matchingInstall(baseName: string | null, manager: "npm" | "pnpm") {
  if (baseName === null) return null;
  const packages = ledger(baseName).packages;
  return manager === "npm" ? npmInstall(packages) : pnpmInstall(packages);
}

function exitOf(successionName: string, manager: "npm" | "pnpm" = "npm", install: { manifest: unknown; lock: unknown } | null | undefined = undefined) {
  const chosen = pair(successionName);
  const resolved = install === undefined ? matchingInstall(chosen.base, manager) : install;
  const report = evaluateAdmission({
    request: request(manager),
    baseLedger: chosen.base === null ? null : bytesOf(chosen.base),
    headLedger: bytesOf(chosen.head),
    install: resolved,
  });
  return { code: admissionExitCode(report), report };
}

describe("admission request", () => {
  it("accepts a v1 request, including phase admission, and refuses an approval or ledger bytes on the request", () => {
    for (const phase of ["foundation", "activation", "admission"] as const) {
      const parsed = validateStarterRequest(request("npm", { phase }));
      expect(parsed.request, phase).toMatchObject({ schemaVersion: 1, phase });
    }
    expect(validateStarterRequest(request("npm", { schemaVersion: 2 })).request).toBeNull();
    expect(validateStarterRequest(request("npm", { approval: { kind: "approved" } })).request).toBeNull();
    expect(validateStarterRequest(request("npm", { ledger: { generation: 1 } })).request).toBeNull();
    const activation = evaluateStarter({
      request: request("npm", { phase: "activation" }),
      snapshot: { schemaVersion: 1, provider: "github-actions", eventName: "pull_request", repository: "consumer/repository", pullRequestNumber: 1, baseSha: "b".repeat(40), headSha: "c".repeat(40), workflowRunId: "1", artifactName: "adoption-snapshot-1", digest: "d".repeat(64), capturedAt: "2026-08-27T12:00:00.000Z", files: [{ path: "evidence/assessment.json", size: 2, sha256: "e".repeat(64) }, { path: "evidence/target.json", size: 2, sha256: "f".repeat(64) }] },
      trustedEvent: { schemaVersion: 1, provider: "github-actions", eventName: "workflow_run", repository: "consumer/repository", baseSha: "b".repeat(40), sourceWorkflowRunId: "1", sourceHeadSha: "c".repeat(40), artifactName: "adoption-snapshot-1", sourceConclusion: "success" },
      install: { schemaVersion: 1, packageManager: "npm", attempted: true, exitCode: 0 },
      now: "2026-08-27T12:00:00.000Z",
      advisor: { attempted: true, exitCode: 0, stdout: JSON.stringify({ state: "satisfied" }), currentAsOf: "2026-08-27T12:00:00.000Z" },
      target: { attempted: true, exitCode: 0, stdout: JSON.stringify({ state: "satisfied" }) },
    });
    expect(activation.state).toBe("satisfied");
    const admissionPhase = evaluateStarter({ request: request(), snapshot: {}, trustedEvent: {}, install: {}, now: "2026-08-27T12:00:00.000Z" });
    expect(admissionPhase).toMatchObject({ state: "indeterminate", phase: "admission", advisor: null, target: null });
    expect(admissionPhase.findings.map((entry) => entry.rule)).toContain("admission-ledgers");
  });
});

describe("admission ledger comparison", () => {
  it("exits 0 when the ledgers are identical", () => {
    expect(exitOf("unchanged").code).toBe(0);
  });

  it("exits 0 for an admitted next generation", () => {
    expect(exitOf("admitted").code).toBe(0);
  });

  it("exits 1 for an extra act", () => {
    const result = exitOf("extra-act");
    expect(result.code).toBe(1);
    expect(result.report.findings.map((entry) => entry.rule)).toContain("ledger-pair-S3");
  });

  it("exits 1 for a different plan digest", () => {
    const result = exitOf("other-plan");
    expect(result.code).toBe(1);
    expect(result.report.findings.map((entry) => entry.rule)).toContain("ledger-head-L3");
  });

  it("exits 1 for a different subject digest", () => {
    const result = exitOf("other-subject");
    expect(result.code).toBe(1);
    expect(result.report.findings.map((entry) => entry.rule)).toContain("ledger-head-L3");
  });

  it("exits 1 for a leftover deferral", () => {
    const result = exitOf("deferred-left");
    expect(result.code).toBe(1);
    expect(result.report.findings.map((entry) => entry.rule)).toContain("ledger-head-L4");
  });

  it("exits 1 for a broken history prefix", () => {
    const result = exitOf("broken-prefix");
    expect(result.code).toBe(1);
    expect(result.report.findings.map((entry) => entry.rule)).toContain("ledger-pair-S2");
  });

  it("exits 1 when the head's last generation is labeled approved", () => {
    const result = exitOf("approved-apply");
    expect(result.code).toBe(1);
    expect(result.report.findings.map((entry) => entry.rule)).toContain("approval-claimed");
  });

  it("exits 1 when the head is another spelling of the same ledger", () => {
    const canonical = bytesOf("admitted-generation-2");
    const compact = utf8(`${JSON.stringify(JSON.parse(canonical.toString("utf8")))}\n`);
    const report = evaluateAdmission({ request: request(), baseLedger: canonical, headLedger: compact, install: matchingInstall("admitted-generation-2", "npm") });
    expect(admissionExitCode(report)).toBe(1);
    expect(report.findings.map((entry) => entry.rule)).toContain("ledger-head-bytes");
  });

  it("exits 2 when the head ledger is absent", () => {
    const report = evaluateAdmission({ request: request(), baseLedger: bytesOf("admitted-generation-2"), headLedger: null, install: matchingInstall("admitted-generation-2", "npm") });
    expect(admissionExitCode(report)).toBe(2);
    expect(report.findings.map((entry) => entry.rule)).toContain("head-ledger-absent");
  });

  it("exits 2 when the head ledger is not a readable document", () => {
    const report = evaluateAdmission({ request: request(), baseLedger: bytesOf("admitted-generation-2"), headLedger: utf8("not json"), install: matchingInstall("admitted-generation-2", "npm") });
    expect(admissionExitCode(report)).toBe(2);
    expect(report.state).toBe("indeterminate");
  });
});

describe("admission install", () => {
  it("exits 1 when the npm install does not match the ledger", () => {
    const base = "admitted-generation-2";
    const install = npmInstall(ledger(base).packages, (_manifest, lock) => {
      const entry = lock.packages[`node_modules/${ledger(base).packages[0]!.name}`] as { integrity: string };
      entry.integrity = `sha512-${"b".repeat(85)}A==`;
    });
    const result = exitOf("unchanged", "npm", install);
    expect(result.code).toBe(1);
    expect(result.report.findings.map((entry) => entry.rule)).toContain("ledger-install");
  });

  it("exits 1 when the pnpm install does not match the ledger", () => {
    const base = "admitted-generation-2";
    const install = pnpmInstall(ledger(base).packages, (rows) => rows.map((pkg, index) => index === 0 ? { ...pkg, integrity: `sha512-${"b".repeat(85)}A==` } : pkg));
    const result = exitOf("unchanged", "pnpm", install);
    expect(result.code).toBe(1);
    expect(result.report.findings.map((entry) => entry.rule)).toContain("ledger-install");
  });

  it("exits 1 when a ledger package's manifest spec is a tarball filename", () => {
    const base = "admitted-generation-2";
    const install = npmInstall(ledger(base).packages, (manifest) => {
      const pkg = ledger(base).packages[0]!;
      manifest[pkg.placement][pkg.name] = `${pkg.version}.tgz`;
    });
    const result = exitOf("unchanged", "npm", install);
    expect(result.code).toBe(1);
    expect(result.report.findings.map((entry) => entry.rule)).toContain("registry-spec");
  });
});

describe("admit command", () => {
  const directories: string[] = [];
  afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); vi.restoreAllMocks(); });

  function tree(headBytes: Buffer | null): { directory: string; requestPath: string; base: string; head: string } {
    const directory = mkdtempSync(join(tmpdir(), "starter-admission-"));
    directories.push(directory);
    const base = join(directory, "base");
    const head = join(directory, "head");
    mkdirSync(join(base, "clossys", ".state"), { recursive: true });
    mkdirSync(head, { recursive: true });
    const ledgerBytes = bytesOf("admitted-generation-2");
    writeFileSync(join(base, "clossys", ".state", "installed.json"), ledgerBytes);
    if (headBytes !== null) {
      mkdirSync(join(head, "clossys", ".state"), { recursive: true });
      writeFileSync(join(head, "clossys", ".state", "installed.json"), headBytes);
    }
    const install = npmInstall(ledger("admitted-generation-2").packages);
    writeFileSync(join(base, "package.json"), JSON.stringify(install.manifest));
    writeFileSync(join(base, "package-lock.json"), JSON.stringify(install.lock));
    const requestPath = join(directory, "request.json");
    writeFileSync(requestPath, JSON.stringify(request()));
    return { directory, requestPath, base, head };
  }

  it("exits 2 when the head ledger file is absent", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const paths = tree(null);
    expect(admissionExitCode(checkAdmission(paths.requestPath, paths.base, paths.head))).toBe(2);
    expect(main(["admit", paths.requestPath, paths.base, paths.head])).toBe(2);
  });

  it("exits 1 for a non-canonical head ledger file and 0 for the canonical file", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const canonical = bytesOf("admitted-generation-2");
    const compact = utf8(`${JSON.stringify(JSON.parse(canonical.toString("utf8")))}\n`);
    const mismatched = tree(compact);
    expect(main(["admit", mismatched.requestPath, mismatched.base, mismatched.head])).toBe(1);
    const matched = tree(canonical);
    expect(main(["admit", matched.requestPath, matched.base, matched.head])).toBe(0);
  });

  it("keeps the admit surface fixed: no registry argument", () => {
    expect(() => main(["admit", "a", "b"])).toThrow();
    expect(() => main(["admit", "a", "b", "c", "--registry", "http://127.0.0.1:9/"])).toThrow();
  });
});
