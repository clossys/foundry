import { readFileSync } from "node:fs";
import { serializeInstalledLedger } from "./ledger.js";
import type { InstalledLedger } from "./ledger.js";
import {unambiguousPnpmAdoptionMetadata} from "./pnpm.js";
import { describe, expect, it } from "vitest";
import { evaluateAdmission, evaluateStarter, evaluateProcessResult, isNormalizedRelativePath, validateStarterRequest } from "./core.js";
import { validateNpmIdentity } from "./npm.js";
import { validatePnpmIdentity } from "./pnpm.js";

const gitSha = (character = "a") => character.repeat(40);
const sha256 = (character = "a") => character.repeat(64);
const integrity = `sha512-${"a".repeat(85)}A==`;
const now = "2026-08-27T12:00:00.000Z";
const starter = { name: "@clossys/starter", version: "0.1.0", integrity, bin: "foundry-starter" as const };
const advisor = { name: "@clossys/advisor", version: "0.1.3", integrity, bin: "advisor-execution-readiness" as const };
const target = { name: "@fixture/starter-target", version: "1.2.3", integrity, bin: "target-check", invocation: "single-json-input" as const };

function request(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    phase: "activation",
    packageManager: "npm",
    snapshot: { repository: "consumer/repository", maxAgeMs: 60_000 },
    starter,
    advisor,
    target,
    evidence: { assessment: "evidence/assessment.json", targetInput: "evidence/target.json" },
    ...overrides,
  };
}
function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    provider: "github-actions",
    eventName: "pull_request",
    repository: "consumer/repository",
    pullRequestNumber: 42,
    baseSha: gitSha("b"),
    headSha: gitSha("c"),
    workflowRunId: "123",
    artifactName: "adoption-snapshot-123",
    digest: sha256("d"),
    capturedAt: now,
    files: [
      { path: "evidence/assessment.json", size: 2, sha256: sha256("e") },
      { path: "evidence/target.json", size: 2, sha256: sha256("f") },
    ],
    ...overrides,
  };
}
function event(overrides: Record<string, unknown> = {}) { return { schemaVersion: 1, provider: "github-actions", eventName: "workflow_run", repository: "consumer/repository", baseSha: gitSha("b"), sourceWorkflowRunId: "123", sourceHeadSha: gitSha("c"), artifactName: "adoption-snapshot-123", sourceConclusion: "success", ...overrides }; }
function process(state: "satisfied" | "violated" | "indeterminate", at?: string) { return { attempted: true, exitCode: state === "satisfied" ? 0 : state === "violated" ? 1 : 2, stdout: JSON.stringify({ state }), ...(at === undefined ? {} : { currentAsOf: at }) }; }
function input(overrides: Record<string, unknown> = {}) { return { request: request(), snapshot: snapshot(), trustedEvent: event(), install: { schemaVersion: 1, packageManager: "npm", attempted: true, exitCode: 0 }, now, advisor: process("satisfied", now), target: process("satisfied"), ...overrides }; }
const planDigest = (character = "a") => `sha256:${sha256(character)}`;
function inputWithoutAdvisor(overrides: Record<string, unknown> = {}) {
  const { advisor: _advisor, ...baseRequest } = request();
  const digest = planDigest("a");
  return input({ request: baseRequest, authorization: { planDigest: digest }, ledgerPlanDigest: digest, advisor: undefined, ...overrides });
}

describe("request and event boundary", () => {
  it("accepts the clean activation control and preserves target 0/1/2", () => {
    expect(evaluateStarter(input()).state).toBe("satisfied");
    expect(evaluateStarter(input({ target: process("violated") })).state).toBe("violated");
    expect(evaluateStarter(input({ target: process("indeterminate") })).state).toBe("indeterminate");
  });

  it("treats hub evidence as caller-supplied, non-blocking, and absent-safe", () => {
    const hub = { owner: "hub-owner", repository: "workspace" };
    const withoutHub = evaluateStarter(input());
    expect(withoutHub.state).toBe("satisfied");
    expect(withoutHub.findings.map((entry) => entry.rule)).not.toContain("not-hub-inventoried");

    const inventoried = evaluateStarter(input({ request: request({ hub: { ...hub, inventoried: true } }) }));
    expect(inventoried.state).toBe("satisfied");
    expect(inventoried.findings.map((entry) => entry.rule)).not.toContain("not-hub-inventoried");

    const notInventoried = evaluateStarter(input({ request: request({ hub: { ...hub, inventoried: false } }) }));
    expect(notInventoried.state).toBe("satisfied");
    expect(notInventoried.findings.map((entry) => entry.rule)).toContain("not-hub-inventoried");

    const foundation = evaluateStarter(input({ request: request({ phase: "foundation", hub: { ...hub, inventoried: false } }) }));
    expect(foundation.state).toBe("indeterminate");
    expect(foundation.findings.map((entry) => entry.rule)).toEqual(expect.arrayContaining(["foundation-only", "not-hub-inventoried"]));

    const rejected = validateStarterRequest(request({ hub: { ...hub, inventoried: "yes" } }));
    expect(rejected.request).toBeNull();
    expect(rejected.findings.map((entry) => entry.rule)).toContain("hub-evidence");
    expect(validateStarterRequest(request({ hub: { ...hub, extra: 1 } })).findings.map((entry) => entry.rule)).toContain("hub-evidence");
  });

  it("keeps Starter and Advisor exact while allowing a neutral target package fixture", () => {
    expect(validateStarterRequest(request()).request).not.toBeNull();
    expect(validateStarterRequest(request({ starter: { ...starter, name: "@fixture/starter" } })).findings.map((entry) => entry.rule)).toContain("starter-contract");
    expect(validateStarterRequest(request({ advisor: { ...advisor, name: "@fixture/advisor" } })).findings.map((entry) => entry.rule)).toContain("advisor-contract");
  });

  it("keeps foundation intentionally non-activation while the pure evaluator preserves supplied receipt states", () => {
    const clean = evaluateStarter(input({ request: request({ phase: "foundation" }) }));
    expect(clean).toMatchObject({ state: "indeterminate", phase: "foundation" });
    expect(clean.findings.map((entry) => entry.rule)).toContain("foundation-only");
    const failed = evaluateStarter(input({ request: request({ phase: "foundation" }), install: { schemaVersion: 1, packageManager: "npm", attempted: true, exitCode: 1 } }));
    expect(failed).toMatchObject({ state: "violated", phase: "foundation" });
    expect(failed.findings.map((entry) => entry.rule)).toContain("install-result");
    const unable = evaluateStarter(input({ request: request({ phase: "foundation" }), install: { schemaVersion: 1, packageManager: "npm", attempted: true, exitCode: 2 } }));
    expect(unable).toMatchObject({ state: "indeterminate", phase: "foundation" });
    expect(unable.findings.map((entry) => entry.rule)).toContain("install-result");
  });

  it("accepts real GitHub 40-hex commit OIDs for foundation-only evidence", () => {
    const report = evaluateStarter(input({ request: request({ phase: "foundation" }) }));
    expect(report).toMatchObject({ state: "indeterminate", phase: "foundation" });
    expect(report.findings.map((entry) => entry.rule)).toEqual(["foundation-only"]);
  });

  it("rejects traversal, absolute paths, shell commands, custom CLI paths, and custom arguments", () => {
    for (const evidence of [{ assessment: "../assessment.json", targetInput: "evidence/target.json" }, { assessment: "/assessment.json", targetInput: "evidence/target.json" }]) {
      expect(evaluateStarter(input({ request: request({ evidence }) })).state).toBe("indeterminate");
    }
    expect(validateStarterRequest(request({ command: "npm ci" })).findings.map((entry) => entry.rule)).toContain("request-shape");
    expect(validateStarterRequest(request({ target: { ...target, cliPath: "../../bin" } })).findings.map((entry) => entry.rule)).toContain("target-contract");
    expect(validateStarterRequest(request({ target: { ...target, arguments: ["--ignore"] } })).findings.map((entry) => entry.rule)).toContain("target-contract");
    expect(validateStarterRequest(request({ advisor: { ...advisor, invocation: "ignored" } })).findings.map((entry) => entry.rule)).toContain("package-shape");
  });

  it("accepts only strict semver and one correctly encoded SHA-512 SRI digest", () => {
    for (const version of ["1.2", "01.2.3", "1.2.3-01", "v1.2.3", "1.2.3.4"]) {
      expect(validateStarterRequest(request({ starter: { ...starter, version } })).findings.map((entry) => entry.rule)).toContain("package-identity");
    }
    for (const badIntegrity of ["sha512-a", `sha512-${"a".repeat(85)}==`, `sha512-${"a".repeat(86)}=`, `sha512-${"a".repeat(86)}==`, `sha512-${"a".repeat(85)}A==x`]) {
      expect(validateStarterRequest(request({ starter: { ...starter, integrity: badIntegrity } })).findings.map((entry) => entry.rule)).toContain("package-identity");
    }
  });

  it("refuses stale or foreign snapshots and every broken provider/event/base/head/digest join", () => {
    expect(evaluateStarter(input({ snapshot: snapshot({ capturedAt: "2026-08-27T11:58:00.000Z" }) })).findings.map((entry) => entry.rule)).toContain("snapshot-expired");
    for (const trustedEvent of [event({ repository: "other/repository" }), event({ eventName: "pull_request" }), event({ baseSha: gitSha("0") }), event({ sourceHeadSha: gitSha("0") }), event({ artifactName: "foreign-artifact" }), event({ sourceConclusion: "skipped" })]) {
      expect(evaluateStarter(input({ trustedEvent })).state).toBe("indeterminate");
    }
    expect(evaluateStarter(input({ snapshot: snapshot({ workflowRunId: "foreign", artifactName: "adoption-snapshot-foreign" }) })).state).toBe("indeterminate");
    expect(evaluateStarter(input({ snapshot: snapshot({ ignored: "extra" }) })).state).toBe("indeterminate");
    expect(evaluateStarter(input({ trustedEvent: event({ ignored: "extra" }) })).state).toBe("indeterminate");
  });

  it("refuses non-canonical provider commit OIDs without weakening SHA-256 evidence digests", () => {
    const invalidCommitOids = [sha256("a"), "not-a-sha", gitSha("A"), "a".repeat(39), "a".repeat(41)];
    for (const commitOid of invalidCommitOids) {
      expect(evaluateStarter(input({ snapshot: snapshot({ baseSha: commitOid }) })).findings.map((entry) => entry.rule)).toContain("snapshot-shape");
      expect(evaluateStarter(input({ snapshot: snapshot({ headSha: commitOid }) })).findings.map((entry) => entry.rule)).toContain("snapshot-shape");
      expect(evaluateStarter(input({ trustedEvent: event({ baseSha: commitOid }) })).findings.map((entry) => entry.rule)).toContain("trusted-event-shape");
      expect(evaluateStarter(input({ trustedEvent: event({ sourceHeadSha: commitOid }) })).findings.map((entry) => entry.rule)).toContain("trusted-event-shape");
    }
    expect(evaluateStarter(input({ snapshot: snapshot({ digest: gitSha("d") }) })).findings.map((entry) => entry.rule)).toContain("snapshot-shape");
    expect(evaluateStarter(input({ snapshot: snapshot({ files: [{ path: "evidence/assessment.json", size: 2, sha256: gitSha("e") }, { path: "evidence/target.json", size: 2, sha256: sha256("f") }] }) })).findings.map((entry) => entry.rule)).toContain("snapshot-file");
  });

  it("refuses array and object coercion at provider and digest boundaries", () => {
    const hostileCommitOids: unknown[] = [[gitSha("a")], { toString: () => gitSha("a") }];
    const hostileDigests: unknown[] = [[sha256("a")], { toString: () => sha256("a") }];
    for (const value of hostileCommitOids) {
      expect(evaluateStarter(input({ snapshot: snapshot({ baseSha: value }) })).findings.map((entry) => entry.rule)).toContain("snapshot-shape");
      expect(evaluateStarter(input({ snapshot: snapshot({ headSha: value }) })).findings.map((entry) => entry.rule)).toContain("snapshot-shape");
      expect(evaluateStarter(input({ trustedEvent: event({ baseSha: value }) })).findings.map((entry) => entry.rule)).toContain("trusted-event-shape");
      expect(evaluateStarter(input({ trustedEvent: event({ sourceHeadSha: value }) })).findings.map((entry) => entry.rule)).toContain("trusted-event-shape");
    }
    for (const value of hostileDigests) {
      expect(evaluateStarter(input({ snapshot: snapshot({ digest: value }) })).findings.map((entry) => entry.rule)).toContain("snapshot-shape");
      expect(evaluateStarter(input({ snapshot: snapshot({ files: [{ path: "evidence/assessment.json", size: 2, sha256: value }, { path: "evidence/target.json", size: 2, sha256: sha256("f") }] }) })).findings.map((entry) => entry.rule)).toContain("snapshot-file");
    }
  });

  it("does not convert a supplied non-success or skipped receipt into a pass", () => {
    expect(evaluateStarter(input({ install: { schemaVersion: 1, packageManager: "npm", attempted: true, exitCode: 1 } })).state).toBe("violated");
    const report = evaluateStarter(input({ install: { schemaVersion: 1, packageManager: "npm", attempted: false, exitCode: 0 } }));
    expect(report).toMatchObject({ state: "indeterminate" });
    expect(report.findings.map((entry) => entry.rule)).toContain("install-skipped");
  });

  it("preserves missing phases, malformed output, and inconsistent output/exit pairs as indeterminate", () => {
    expect(evaluateStarter(input({ advisor: undefined })).state).toBe("indeterminate");
    expect(evaluateProcessResult({ attempted: true, exitCode: 0, stdout: "not json" }, "target").state).toBe("indeterminate");
    expect(evaluateProcessResult({ attempted: true, exitCode: null, stdout: "", timedOut: true }, "target").state).toBe("indeterminate");
    expect(evaluateProcessResult({ attempted: true, exitCode: 0, stdout: JSON.stringify({ state: "violated" }) }, "target").state).toBe("indeterminate");
    expect(evaluateStarter(input({ advisor: process("satisfied", "2026-08-27T12:00:01.000Z") })).state).toBe("indeterminate");
  });

  it("recognizes only portable normalized relative paths", () => {
    expect(isNormalizedRelativePath("evidence/a.json")).toBe(true);
    for (const path of ["", "./a", "a//b", "a/../b", "C:\\a", "/a"]) expect(isNormalizedRelativePath(path)).toBe(false);
  });
});

describe("plan digest activation without advisor", () => {
  it("accepts a schemaVersion 1 request with no advisor block", () => {
    const { advisor: _advisor, ...withoutAdvisor } = request();
    expect(validateStarterRequest(withoutAdvisor).request).not.toBeNull();
  });

  it("satisfies activation when digests match and the target is satisfied, with advisor null in the report", () => {
    const evaluation = inputWithoutAdvisor();
    expect(evaluation.request).not.toHaveProperty("advisor");
    const report = evaluateStarter(evaluation);
    expect(report.findings.map((entry) => entry.rule)).toEqual([]);
    expect(report).toMatchObject({ state: "satisfied", advisor: null, target: "satisfied" });
  });

  it("stays indeterminate when authorization or ledger digests are absent", () => {
    expect(evaluateStarter(inputWithoutAdvisor({ authorization: undefined, ledgerPlanDigest: undefined })).state).toBe("indeterminate");
    expect(evaluateStarter(inputWithoutAdvisor({ authorization: { planDigest: planDigest("a") }, ledgerPlanDigest: undefined })).state).toBe("indeterminate");
    expect(evaluateStarter(inputWithoutAdvisor({ authorization: undefined, ledgerPlanDigest: planDigest("a") })).state).toBe("indeterminate");
    expect(evaluateStarter(inputWithoutAdvisor({ authorization: undefined, ledgerPlanDigest: undefined })).state).not.toBe("satisfied");
  });

  it("violates when both digests are well formed but unequal", () => {
    const report = evaluateStarter(inputWithoutAdvisor({ ledgerPlanDigest: planDigest("b") }));
    expect(report).toMatchObject({ state: "violated" });
    expect(report.findings.map((entry) => entry.rule)).toContain("plan-digest-mismatch");
  });

  it("treats a non-canonical digest prefix as unreadable", () => {
    const bad = `SHA256:${sha256("a")}`;
    expect(evaluateStarter(inputWithoutAdvisor({ authorization: { planDigest: bad }, ledgerPlanDigest: bad })).state).toBe("indeterminate");
    expect(evaluateStarter(inputWithoutAdvisor({ authorization: { planDigest: bad }, ledgerPlanDigest: bad })).findings.map((entry) => entry.rule)).toContain("plan-digest-unreadable");
  });

  it("keeps a skipped advisor process indeterminate when the request includes advisor", () => {
    expect(evaluateStarter(input({ advisor: undefined })).state).toBe("indeterminate");
  });
});

describe("fixed install adapters", () => {
  const manifest = { devDependencies: { [starter.name]: starter.version, [advisor.name]: advisor.version, [target.name]: target.version } };
  it("accepts a clean npm manifest and package-lock control", () => {
    const lock = { packages: { "": manifest, [`node_modules/${starter.name}`]: { version: starter.version, integrity }, [`node_modules/${advisor.name}`]: { version: advisor.version, integrity }, [`node_modules/${target.name}`]: { version: target.version, integrity } } };
    expect(validateNpmIdentity(manifest, lock, starter)).toEqual([]);
    expect(validateNpmIdentity(manifest, lock, advisor)).toEqual([]);
    expect(validateNpmIdentity(manifest, lock, target)).toEqual([]);
  });
  it("accepts a clean pnpm manifest and lock control", () => {
    const lock = `lockfileVersion: '9.0'\nimporters:\n  other:\n    devDependencies:\n      '${advisor.name}':\n        specifier: ${advisor.version}\n        version: ${advisor.version}\n  .:\n    devDependencies:\n      '${starter.name}':\n        specifier: ${starter.version}\n        version: ${starter.version}\n      '${advisor.name}':\n        specifier: ${advisor.version}\n        version: ${advisor.version}\n      '${target.name}':\n        specifier: ${target.version}\n        version: ${target.version}\npackages:\n  '${starter.name}@${starter.version}':\n    resolution:\n      integrity: ${integrity}\n  '${advisor.name}@${advisor.version}':\n    resolution: {integrity: ${integrity}}\n  '${target.name}@${target.version}':\n    resolution: {integrity: ${integrity}}\n`;
    expect(validatePnpmIdentity(manifest, lock, starter)).toEqual([]);
    expect(validatePnpmIdentity(manifest, lock, advisor)).toEqual([]);
    expect(validatePnpmIdentity(manifest, lock, target)).toEqual([]);
  });
  it("accepts a peer-qualified pnpm importer resolution with an exact package entry", () => {
    const lock = `lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      '${advisor.name}':\n        specifier: ${advisor.version}\n        version: ${advisor.version}(typescript@6.0.3)\npackages:\n  '${advisor.name}@${advisor.version}':\n    resolution: {integrity: ${integrity}}\n`;
    expect(validatePnpmIdentity(manifest, lock, advisor)).toEqual([]);
  });
  it("accepts real-shaped nested balanced peer contexts while preserving the exact importer specifier", () => {
    const lock = `lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      '${advisor.name}':\n        specifier: '${advisor.version}'\n        version: ${advisor.version}(typescript@6.0.3(@types/node@24.0.0))(react@19.1.1)\npackages:\n  '${advisor.name}@${advisor.version}':\n    resolution: {integrity: ${integrity}}\n`;
    expect(validatePnpmIdentity(manifest, lock, advisor)).toEqual([]);
  });
  it("rejects malformed or unbalanced nested peer contexts", () => {
    for (const suffix of [
      "(typescript@6.0.3(@types/node@24.0.0)",
      "(typescript@6.0.3(@types/node@24.0.0)))",
      "(typescript@6.0.3(()))",
      "typescript@6.0.3(@types/node@24.0.0)",
      "(junk)",
      "( )",
      "(@)",
      "(typescript@)",
      "(@types/node)",
      "(typescript@6.0.3)(junk)",
      "(typescript@6.0.3@junk)",
    ]) {
      const lock = `lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      '${advisor.name}':\n        specifier: ${advisor.version}\n        version: ${advisor.version}${suffix}\npackages:\n  '${advisor.name}@${advisor.version}':\n    resolution: {integrity: ${integrity}}\n`;
      expect(validatePnpmIdentity(manifest, lock, advisor)).toContain(`pnpm root importer devDependencies does not pin ${advisor.name} at exact ${advisor.version}`);
    }
  });
  it("refuses a wrong pnpm base version hidden by a peer suffix", () => {
    const lock = `lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      '${advisor.name}':\n        specifier: ${advisor.version}\n        version: 0.1.2(typescript@6.0.3)\npackages:\n  '${advisor.name}@${advisor.version}':\n    resolution: {integrity: ${integrity}}\n`;
    expect(validatePnpmIdentity(manifest, lock, advisor)).toContain(`pnpm root importer devDependencies does not pin ${advisor.name} at exact ${advisor.version}`);
  });
  it("refuses lock drift rather than accepting an installed-looking version", () => {
    const lock = { packages: { "": manifest, [`node_modules/${advisor.name}`]: { version: advisor.version, integrity: `sha512-${"b".repeat(85)}A==` } } };
    expect(validateNpmIdentity(manifest, lock, advisor)).not.toEqual([]);
  });
  it("does not borrow exact pins from another root dependency section or pnpm importer", () => {
    const wrongSection = { dependencies: { [advisor.name]: advisor.version }, devDependencies: {} };
    const npmLock = { packages: { "": wrongSection, [`node_modules/${advisor.name}`]: { version: advisor.version, integrity } } };
    expect(validateNpmIdentity(wrongSection, npmLock, advisor)).not.toEqual([]);
    const pnpmLock = `lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      unrelated:\n        specifier: 1.0.0\n        version: 1.0.0\n    dependencies:\n      '${advisor.name}':\n        specifier: ${advisor.version}\n        version: ${advisor.version}\n  other:\n    devDependencies:\n      '${advisor.name}':\n        specifier: ${advisor.version}\n        version: ${advisor.version}\npackages:\n  '${advisor.name}@${advisor.version}':\n    resolution: {integrity: ${integrity}}\n`;
    expect(validatePnpmIdentity(wrongSection, pnpmLock, advisor)).not.toEqual([]);
  });
  it("refuses ranges even when the installed lock entry resolves to the expected version", () => {
    const ranged = { devDependencies: { [advisor.name]: `^${advisor.version}` } };
    const lock = { packages: { "": ranged, [`node_modules/${advisor.name}`]: { version: advisor.version, integrity } } };
    expect(validateNpmIdentity(ranged, lock, advisor)).not.toEqual([]);
    const pnpmLock = `lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      '${advisor.name}':\n        specifier: ^${advisor.version}\n        version: ${advisor.version}\npackages:\n  '${advisor.name}@${advisor.version}':\n    resolution: {integrity: ${integrity}}\n`;
    expect(validatePnpmIdentity(manifest, pnpmLock, advisor)).not.toEqual([]);
  });
  it("refuses a ranged pnpm manifest and a wrong-SRI package entry independently", () => {
    const rangedManifest = { devDependencies: { [advisor.name]: `^${advisor.version}` } };
    const exactImporterWrongSri = `lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n      '${advisor.name}':\n        specifier: ${advisor.version}\n        version: ${advisor.version}(typescript@6.0.3(@types/node@24.0.0))\npackages:\n  '${advisor.name}@${advisor.version}':\n    resolution: {integrity: sha512-${"b".repeat(85)}A==}\n`;
    expect(validatePnpmIdentity(rangedManifest, exactImporterWrongSri, advisor)).toEqual(expect.arrayContaining([
      `package.json devDependencies does not declare ${advisor.name} at exact ${advisor.version}`,
      `pnpm package entry for ${advisor.name} does not match exact resolution integrity`,
    ]));
  });
});

describe("new proof native pnpm serialization subset",()=>{
  it.each([
    "importers: {}\n'importers': {}\n",
    "root:\n  resolution: {integrity: example, 'integrity': other}\n",
    "root: &anchor {}\n",
    "root: *anchor\n",
    "root:\n  '<<': {}\n",
    "root: [*anchor]\n",
    "root:\n  - *anchor\n",
    "root: {integrity: *anchor}\n",
    "root: {nested: {integrity: example}}\n",
    "root: !!str example\n",
    "!!str importers: {}\nimporters: {}\n",
    "01: {}\n'1': {}\n",
    ".5: {}\n",
    ".5: {}\n'0.5': {}\n",
    "@scope/package: {}\n",
    "root: |\n  example\n",
    '"ro\\ot": {}\n',
  ])("refuses ambiguous or unsupported serialization #%#",text=>{
    expect(unambiguousPnpmAdoptionMetadata(text)).toBe(false);
  });
  it("accepts native mapping, simple keys, scalar sequences and flat inline maps",()=>{
    expect(unambiguousPnpmAdoptionMetadata("lockfileVersion: '9.0'\nimporters:\n  .: {}\nroot:\n  resolution: {integrity: sha512-example}\n  cpu: [arm64, x64]\n  peers:\n    - '@scope/package'\n")).toBe(true);
  });
});


// Use valid canonical corpus succession as the public admission boundary, not a private helper stub.
const corpus = JSON.parse(readFileSync(new URL("../../../docs/contracts/installed-ledger.fixture.json", import.meta.url), "utf8")) as {
  ledgers: { name: string; ledger: InstalledLedger }[];
};
type Mutable<T> = T extends readonly (infer Row)[] ? Mutable<Row>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;
type Placement = "dependencies" | "devDependencies";

function adoptionFixture(placement: Placement = "dependencies") {
  const load = (name: string): Mutable<InstalledLedger> => JSON.parse(
    JSON.stringify(corpus.ledgers.find(entry => entry.name === name)!.ledger)
      .replaceAll("@example/strategist", "@clossys/strategist")
      .replaceAll("@example~1strategist", "@clossys~1strategist"),
  );
  const base = load("setup-generation-1");
  const head = load("admitted-generation-2");
  const name = "@clossys/strategist";
  const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
  for (const ledger of [base, head]) {
    for (const rows of [ledger.packages, ledger.deferred]) {
      for (const row of rows) if (row.name === name) row.placement = placement;
    }
    for (const row of ledger.keys) {
      if (row.pointer.endsWith("@clossys~1strategist")) row.pointer = row.pointer.replace("/devDependencies/", `/${placement}/`);
    }
    ledger.packages.sort((a, b) => compare(a.planItem, b.planItem));
    ledger.deferred.sort((a, b) => compare(a.planItem, b.planItem));
    ledger.keys.sort((a, b) => compare(a.pointer, b.pointer));
  }
  const pkg = base.deferred.find(row => row.name === name)!;
  const {changeSet, reason: _reason, ...desired} = pkg;
  const row = {
    file: "package.json" as const, placement, name, beforeVersion: "1.4.0",
    beforeResolved: {name, version: "1.4.0", integrity: pkg.integrity}, desired,
    observedBaseCommit: base.history[0]!.baseCommit,
    desiredSnapshotDigest: `sha256:${"a".repeat(64)}`,
    consent: "adopt-existing-declaration" as const, changeSet,
  };
  base.existingDeclarationAdoptions = [row];
  head.existingDeclarationAdoptions = [structuredClone(row)];
  const bytes = (ledger: InstalledLedger) => Buffer.from(serializeInstalledLedger(ledger));
  function install(rows: readonly {name: string; version: string; integrity: string; placement: Placement}[]) {
    const manifest: Record<Placement, Record<string, string>> = {dependencies: {}, devDependencies: {}};
    for (const pkg of rows) manifest[pkg.placement][pkg.name] = pkg.version;
    const lock = {packages: {
      "": structuredClone(manifest),
      ...Object.fromEntries(rows.map(pkg => [`node_modules/${pkg.name}`, {version: pkg.version, integrity: pkg.integrity}])),
    }};
    return {manifest, lock};
  }
  return {base, head, input: {
    request: request({phase: "admission"}), baseLedger: bytes(base), headLedger: bytes(head),
    install: install([...base.packages, pkg]), headInstall: install(head.packages),
  }};
}

describe("adoption manifest own-property boundaries", () => {
  for (const placement of ["dependencies", "devDependencies"] as const) {
    it(`${placement}: accepts ordinary own declaration sections and package names`, () => {
      expect(evaluateAdmission(adoptionFixture(placement).input).state).toBe("satisfied");
    });
    it(`${placement}: refuses an inherited declaration section`, () => {
      const {input} = adoptionFixture(placement);
      const bucket = input.headInstall.manifest[placement];
      delete input.headInstall.manifest[placement];
      Object.setPrototypeOf(input.headInstall.manifest, {[placement]: bucket});
      expect(evaluateAdmission(input).state).toBe("violated");
      expect(Object.hasOwn(bucket, "@clossys/strategist")).toBe(true);
    });
    it(`${placement}: refuses an inherited package declaration`, () => {
      const {input} = adoptionFixture(placement);
      const bucket = input.headInstall.manifest[placement];
      const value = bucket["@clossys/strategist"];
      delete bucket["@clossys/strategist"];
      Object.setPrototypeOf(bucket, {"@clossys/strategist": value});
      expect(evaluateAdmission(input).state).toBe("violated");
    });
    it(`${placement}: never mutates a bucket inherited from Object.prototype`, () => {
      const {input} = adoptionFixture(placement);
      const shared = input.install.manifest[placement];
      const before = structuredClone(shared);
      delete input.install.manifest[placement];
      delete input.headInstall.manifest[placement];
      const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, placement);
      try {
        Object.defineProperty(Object.prototype, placement, {value: shared, writable: true, enumerable: false, configurable: true});
        expect(evaluateAdmission(input).state).toBe("violated");
        expect(shared).toEqual(before);
      } finally {
        if (descriptor) Object.defineProperty(Object.prototype, placement, descriptor);
        else Reflect.deleteProperty(Object.prototype, placement);
      }
    });
  }
  it.each(["__proto__", "constructor", "prototype"])("refuses unsupported ledger placement %s before manifest traversal", placement => {
    const {input,base} = adoptionFixture();
    (base.deferred[0]! as unknown as {placement: string}).placement = placement;
    expect(evaluateAdmission({...input,baseLedger:Buffer.from(JSON.stringify(base,null,2)+"\n")}).state).toBe("violated");
  });
});
