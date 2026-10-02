import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// Starter's own source in this repository, read by this test only: the
// validator and the admission judge the rendered request must satisfy. Launcher
// has no runtime dependency on Starter and the renderer imports none of it.
import { admissionExitCode, evaluateAdmission, validateStarterRequest } from "../../starter/src/core.js";
import { renderProductCiWorkflow, renderStarterRequest } from "./setup-templates.js";

/*
 * The request Launcher writes, parsed back and handed to Starter: it must
 * validate with no findings, and the admission check must judge the ledger
 * fixtures the same way it does for a hand-written request. The fixture corpus
 * is docs/contracts/installed-ledger.fixture.json, read here by this test only,
 * with the same helpers packages/starter/src/admission.test.ts uses.
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

const INTEGRITY = `sha512-${"a".repeat(85)}A==`;
const input = (packageManager: "npm" | "pnpm", starter: Record<string, unknown> = {}) => ({
  packageManager,
  repository: "consumer/repository",
  starter: { name: "@clossys/starter", version: "0.2.3", integrity: INTEGRITY, ...starter },
});

function rendered(packageManager: "npm" | "pnpm"): unknown {
  const result = renderStarterRequest(input(packageManager));
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.refusal)}`);
  return JSON.parse(result.files[0]!.bytes);
}

function npmInstall(packages: readonly PackageRow[]) {
  const manifest = { dependencies: {} as Record<string, string>, devDependencies: {} as Record<string, string> };
  const lockPackages: Record<string, unknown> = {};
  for (const pkg of packages) {
    manifest[pkg.placement][pkg.name] = pkg.version;
    lockPackages[`node_modules/${pkg.name}`] = { version: pkg.version, integrity: pkg.integrity };
  }
  lockPackages[""] = { dependencies: manifest.dependencies, devDependencies: manifest.devDependencies };
  return { manifest, lock: { packages: lockPackages } };
}

function pnpmInstall(packages: readonly PackageRow[]) {
  const lines = ["lockfileVersion: '9.0'", "importers:", "  .:"];
  const manifest = { dependencies: {} as Record<string, string>, devDependencies: {} as Record<string, string> };
  for (const placement of ["dependencies", "devDependencies"] as const) {
    const group = packages.filter((pkg) => pkg.placement === placement);
    if (group.length === 0) continue;
    lines.push(`    ${placement}:`);
    for (const pkg of group) {
      manifest[placement][pkg.name] = pkg.version;
      lines.push(`      '${pkg.name}':`, `        specifier: ${pkg.version}`, `        version: ${pkg.version}`);
    }
  }
  lines.push("packages:");
  for (const pkg of packages) lines.push(`  '${pkg.name}@${pkg.version}':`, `    resolution: {integrity: ${pkg.integrity}}`);
  return { manifest, lock: `${lines.join("\n")}\n` };
}

function matchingInstall(baseName: string | null, manager: "npm" | "pnpm") {
  if (baseName === null) return null;
  const packages = ledger(baseName).packages;
  return manager === "npm" ? npmInstall(packages) : pnpmInstall(packages);
}

function judge(request: unknown, base: string | null, head: string, manager: "npm" | "pnpm") {
  const report = evaluateAdmission({
    request,
    baseLedger: base === null ? null : bytesOf(base),
    headLedger: bytesOf(head),
    install: matchingInstall(base, manager),
  });
  return { code: admissionExitCode(report), report };
}

describe.each(["npm", "pnpm"] as const)("the rendered request against Starter (%s)", (manager) => {
  it("validates with no findings and keeps its shape", () => {
    const parsed = validateStarterRequest(rendered(manager));
    expect(parsed.findings).toEqual([]);
    expect(parsed.request).toMatchObject({ schemaVersion: 1, phase: "admission", packageManager: manager });
    expect(parsed.request).not.toHaveProperty("advisor");
    expect(parsed.request).not.toHaveProperty("hub");
  });

  it("exits 0 when the ledgers are identical", () => {
    const result = judge(rendered(manager), "setup-generation-1", "setup-generation-1", manager);
    expect(result.code).toBe(0);
    expect(result.report.findings).toEqual([]);
  });

  it("exits 0 for the admitted next generation", () => {
    const chosen = pair("admitted");
    expect(judge(rendered(manager), chosen.base, chosen.head, manager).code).toBe(0);
  });

  it("exits 1, approval-claimed, for a next generation labelled approved", () => {
    const chosen = pair("approved-apply");
    const result = judge(rendered(manager), chosen.base, chosen.head, manager);
    expect(result.code).toBe(1);
    expect(result.report.findings.map((entry) => entry.rule)).toContain("approval-claimed");
  });

  it("exits 1 when the base install does not hold the ledger's packages", () => {
    const chosen = pair("admitted");
    const other = ledger(chosen.base!).packages.map((pkg, index) => (index === 0 ? { ...pkg, integrity: `sha512-${"b".repeat(85)}A==` } : pkg));
    const report = evaluateAdmission({
      request: rendered(manager),
      baseLedger: bytesOf(chosen.base!),
      headLedger: bytesOf(chosen.head),
      install: manager === "npm" ? npmInstall(other) : pnpmInstall(other),
    });
    expect(admissionExitCode(report)).toBe(1);
  });
});

describe("a pin outside the supported range", () => {
  it("is refused by the renderer, so nothing reaches Starter", () => {
    for (const version of ["0.1.9", "0.4.0", "0.2.0-rc.1", "1.0.0"]) {
      const result = renderStarterRequest(input("npm", { version }));
      expect(result).toEqual({ ok: false, refusal: { reason: "starter-pin-unsupported", at: "starter.version" } });
    }
    // Starter itself accepts these; only the renderer's range refuses them.
    const outside = { ...(rendered("npm") as object), starter: { name: "@clossys/starter", version: "0.4.0", integrity: INTEGRITY, bin: "foundry-starter" } };
    expect(validateStarterRequest(outside).findings.map((entry) => entry.rule)).not.toContain("starter-contract");
  });
});

describe("integrity spelling parity", () => {
  it("accepts and refuses exactly what Starter's validator does", () => {
    const candidates: string[] = [
      INTEGRITY,
      ...["A", "Q", "g", "w", "B", "R", "h", "x", "+", "/", "0", "z", "-"].map((last) => `sha512-${"c".repeat(85)}${last}==`),
      `sha512-${"c".repeat(84)}A==`,
      `sha512-${"c".repeat(86)}A==`,
      `sha512-${"c".repeat(85)}A=`,
      `sha512-${"c".repeat(85)}A===`,
      `sha256-${"c".repeat(85)}A==`,
      `sha512-${"+/".repeat(42)}+A==`,
      `sha512-${"_".repeat(85)}A==`,
      `sha512-${"c".repeat(85)}A==\n`,
      "",
    ];
    for (const integrity of candidates) {
      const starterSide = validateStarterRequest({ ...(rendered("npm") as object), starter: { name: "@clossys/starter", version: "0.2.3", integrity, bin: "foundry-starter" } }).findings.some((entry) => entry.rule === "package-identity");
      const launcherSide = renderStarterRequest(input("npm", { integrity }));
      expect(launcherSide.ok, JSON.stringify(integrity)).toBe(!starterSide);
    }
  });
});

describe("the product CI workflow", () => {
  const CONTROLLER_TEMPLATE = "packages/controller/conventions/templates/product-ci-workflow.yml";
  const source = read(CONTROLLER_TEMPLATE);
  const bytes = renderProductCiWorkflow();

  it("is byte-identical to Controller's shipped template", () => {
    expect(bytes).toBe(source);
  });

  it("names no pull_request_target and pins every action to a 40-hex commit", () => {
    expect(bytes).not.toContain("pull_request_target");
    const uses = bytes.split("\n").filter((line) => /^\s*(?:- )?uses:/u.test(line));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) expect(line).toMatch(/uses: [A-Za-z0-9._-]+\/[A-Za-z0-9._-]+@[0-9a-f]{40}(?: # .+)?$/u);
  });

  it("is packed into this package's contracts directory by exactly one row", () => {
    const packed = JSON.parse(readFileSync(new URL("../scripts/packed-copies.json", import.meta.url), "utf8")) as { copies: { copy: string; source: string }[] };
    expect(packed.copies.filter((row) => row.copy === "contracts/product-ci-workflow.yml")).toEqual([{ copy: "contracts/product-ci-workflow.yml", source: CONTROLLER_TEMPLATE }]);
    expect(read(packed.copies.find((row) => row.copy === "contracts/product-ci-workflow.yml")!.source)).toBe(bytes);
  });
});
