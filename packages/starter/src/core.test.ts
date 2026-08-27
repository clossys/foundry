import { describe, expect, it } from "vitest";
import { evaluateStarter, evaluateProcessResult, isNormalizedRelativePath, validateStarterRequest } from "./core.js";
import { validateNpmIdentity } from "./npm.js";
import { validatePnpmIdentity } from "./pnpm.js";

const sha = (character = "a") => character.repeat(64);
const integrity = `sha512-${"a".repeat(85)}A==`;
const now = "2026-08-27T12:00:00.000Z";
const starter = { name: "@vespeneventures/starter", version: "0.1.0", integrity, bin: "foundry-starter" as const };
const advisor = { name: "@vespeneventures/advisor", version: "0.1.3", integrity, bin: "advisor-execution-readiness" as const };
const target = { name: "@vespeneventures/target", version: "1.2.3", integrity, bin: "target-check", invocation: "single-json-input" as const };

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
    baseSha: sha("b"),
    headSha: sha("c"),
    workflowRunId: "123",
    artifactName: "adoption-snapshot-123",
    digest: sha("d"),
    capturedAt: now,
    files: [
      { path: "evidence/assessment.json", size: 2, sha256: sha("e") },
      { path: "evidence/target.json", size: 2, sha256: sha("f") },
    ],
    ...overrides,
  };
}
function event(overrides: Record<string, unknown> = {}) { return { schemaVersion: 1, provider: "github-actions", eventName: "workflow_run", repository: "consumer/repository", baseSha: sha("b"), sourceWorkflowRunId: "123", sourceHeadSha: sha("c"), artifactName: "adoption-snapshot-123", sourceConclusion: "success", ...overrides }; }
function process(state: "satisfied" | "violated" | "indeterminate", at?: string) { return { attempted: true, exitCode: state === "satisfied" ? 0 : state === "violated" ? 1 : 2, stdout: JSON.stringify({ state }), ...(at === undefined ? {} : { currentAsOf: at }) }; }
function input(overrides: Record<string, unknown> = {}) { return { request: request(), snapshot: snapshot(), trustedEvent: event(), install: { schemaVersion: 1, packageManager: "npm", attempted: true, exitCode: 0 }, now, advisor: process("satisfied", now), target: process("satisfied"), ...overrides }; }

describe("request and event boundary", () => {
  it("accepts the clean activation control and preserves target 0/1/2", () => {
    expect(evaluateStarter(input()).state).toBe("satisfied");
    expect(evaluateStarter(input({ target: process("violated") })).state).toBe("violated");
    expect(evaluateStarter(input({ target: process("indeterminate") })).state).toBe("indeterminate");
  });

  it("keeps foundation intentionally non-activation while preserving fixed install 0/1/2", () => {
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
    for (const trustedEvent of [event({ repository: "other/repository" }), event({ eventName: "pull_request" }), event({ baseSha: sha("0") }), event({ sourceHeadSha: sha("0") }), event({ artifactName: "foreign-artifact" }), event({ sourceConclusion: "skipped" })]) {
      expect(evaluateStarter(input({ trustedEvent })).state).toBe("indeterminate");
    }
    expect(evaluateStarter(input({ snapshot: snapshot({ workflowRunId: "foreign", artifactName: "adoption-snapshot-foreign" }) })).state).toBe("indeterminate");
    expect(evaluateStarter(input({ snapshot: snapshot({ ignored: "extra" }) })).state).toBe("indeterminate");
    expect(evaluateStarter(input({ trustedEvent: event({ ignored: "extra" }) })).state).toBe("indeterminate");
  });

  it("does not convert failed or skipped fixed installation into a pass", () => {
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
});
