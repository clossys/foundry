import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const roots: string[] = [];
const sha = (character: string) => character.repeat(64);
const integrityFor = (path: string) => `sha512-${createHash("sha512").update(readFileSync(path)).digest("base64")}`;

function temporaryRoot(): string { const root = mkdtempSync(join(tmpdir(), "starter-pack-")); roots.push(root); return root; }
function run(command: string, args: readonly string[], cwd: string, timeout = 30_000) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout, maxBuffer: 4_000_000 });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout || result.error?.message}`);
  return result.stdout;
}
function writeJson(path: string, value: unknown): void { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
function pack(directory: string, destination: string): { path: string; integrity: string } {
  const output = run("npm", ["pack", "--json", "--pack-destination", destination, "--ignore-scripts"], directory);
  const item = JSON.parse(output) as Array<{ filename: string }>;
  const path = join(destination, item[0]?.filename ?? "");
  return { path, integrity: integrityFor(path) };
}

function assessment(target: { name: string; version: string; integrity: string; bin: string }, repository: string, overrides: Record<string, unknown> = {}) {
  const evidence = [{ id: "evidence", description: "Consumer-owned proof." }];
  const action = { kind: "reconcile", ownerRef: "consumer-owner", dueAt: "2099-01-01T00:00:00Z", escalationRef: "consumer-sponsor" };
  const basis = { snapshotDigest: `sha256:${sha("a")}`, grantDigest: `sha256:${sha("b")}`, catalogDigest: `sha256:${sha("c")}`, planDigest: `sha256:${sha("d")}`, blockerDigest: `sha256:${sha("e")}`, clearanceDigest: `sha256:${sha("f")}`, conflictDigest: `sha256:${sha("1")}`, baselineDigest: `sha256:${sha("2")}`, completionDefinitionDigest: `sha256:${sha("3")}`, assessedAt: "2020-01-01T00:00:00Z", freshUntil: "2099-01-01T00:00:00Z" };
  const workItem = { id: "authorized-target", initiativeId: "initiative", targetRepositoryId: repository, deliveryOwnerRef: "delivery-owner", package: { name: target.name, version: target.version, integrity: target.integrity }, bin: target.bin, invocation: "single-json-input", placement: "consumer required check", baseline: { metricRef: "consumer-metric", value: 0, observedAt: "2020-01-01T00:00:00Z", evidence: evidence[0] }, completion: { definition: "Measure the independent consumer outcome.", independentOutcomeOwnerRef: "outcome-owner", evidenceSource: "consumer measurement", direction: "increase", setpoint: 1, windowDays: 7 }, rollback: { procedure: "Restore the prior known-good consumer lockfile.", evidenceSource: "consumer rollback record" }, mutationSurfaces: ["consumer-lockfile"] };
  const authorization = { planDigest: basis.planDigest, assessmentBasis: basis, sponsorRef: "consumer-sponsor", permittedRepositoryIds: [repository], permittedPackages: [workItem.package], permittedMutationSurfaces: ["consumer-lockfile"], grantedAt: "2020-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z" };
  return {
    id: "assessment",
    asOf: "2026-08-27T12:00:00Z",
    engagement: { id: "engagement", status: "active", nextAction: action, assessmentBasis: basis, executionAuthorization: authorization },
    fitSignals: ["sponsor-mandate", "material-need", "offering-operating-compatibility", "expected-value-burden", "adoption-capacity", "legal-ethical-safety"].map((id) => ({ id, state: "supported", evidence })),
    prerequisiteObservations: ["scope-repository-inventory", "read-access", "authority-approval", "initiative-mutation-dependency-inventory", "immutable-artifact-access", "baseline", "independent-outcome-owner", "rollback-review-window"].map((id) => ({ id, state: "satisfied", evidence })),
    initiatives: [{ id: "initiative", status: "active", targetRepositoryIds: [repository], workstreamConflictKeys: ["workstream"], dependencyConflictKeys: ["dependency"], mutationConflictKeys: ["mutation"], authorityConflictKeys: ["authority"], scheduleConflictKeys: ["schedule"], dataOutcomeMetricConflictKeys: ["metric"] }],
    firstWave: { initiativeIds: ["initiative"], objectives: ["Run the exact installed target."], workItems: [workItem] },
    preWorkItems: ["baseline", "conflict"].map((kind) => ({ id: kind, kind, status: "satisfied", addressesReadinessCriteria: [kind === "baseline" ? "baseline" : "initiative-mutation-dependency-inventory"], targetRepositoryIds: [repository], ownerRef: `${kind}-owner`, impact: "The consumer-owned prerequisite is cleared.", evidence, nextAction: { ...action, ownerRef: `${kind}-owner` }, dependencySurfaces: ["consumer evidence"], mutationSurfaces: ["consumer-lockfile"], clearance: { authorityOwnerRef: `${kind}-authority`, evidence } })),
    reassessment: { cadenceDays: 7, triggers: ["evidence-change"] },
    ...overrides,
  };
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("packed installed activation canary", () => {
  it("runs only the exact installed bins and preserves readable 0/1/2 outcomes", () => {
    run("npm", ["run", "build", "--workspace=packages/advisor"], repoRoot);
    run("npm", ["run", "build", "--workspace=packages/starter"], repoRoot);
    const root = temporaryRoot(); const packed = join(root, "packed"); const targetPackage = join(root, "target-package"); const consumer = join(root, "consumer");
    mkdirSync(packed); mkdirSync(join(targetPackage, "bin"), { recursive: true }); mkdirSync(consumer);
    writeJson(join(targetPackage, "package.json"), { name: "@vespeneventures/synthetic-target", version: "1.0.0", private: true, type: "module", bin: { "synthetic-target-check": "./bin/check.js" }, files: ["bin"] });
    writeFileSync(join(targetPackage, "bin", "check.js"), "#!/usr/bin/env node\nimport { readFileSync } from 'node:fs';\nconst input = JSON.parse(readFileSync(process.argv[2], 'utf8'));\nif (input.mode === 'hang') { setInterval(() => {}, 1000); } else { const state = input.mode === 'violated' ? 'violated' : input.mode === 'indeterminate' ? 'indeterminate' : 'satisfied'; console.log(JSON.stringify({state})); process.exit(state === 'satisfied' ? 0 : state === 'violated' ? 1 : 2); }\n");
    chmodSync(join(targetPackage, "bin", "check.js"), 0o755);
    const starter = pack(join(repoRoot, "packages/starter"), packed);
    const advisor = pack(join(repoRoot, "packages/advisor"), packed);
    const target = pack(targetPackage, packed);
    writeJson(join(consumer, "package.json"), { name: "consumer", private: true, version: "1.0.0" });
    run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-dev", starter.path, advisor.path, target.path], consumer);

    // The disposable install establishes the package contents and lock integrity.
    // Rewrite only local-tarball specifiers into the exact published pins that
    // the fixed adapters require from a consumer's protected base.
    const consumerManifest = JSON.parse(readFileSync(join(consumer, "package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(join(consumer, "package-lock.json"), "utf8"));
    const identities = {
      starter: { name: "@vespeneventures/starter", version: "0.1.0", integrity: starter.integrity, bin: "foundry-starter" },
      advisor: { name: "@vespeneventures/advisor", version: "0.1.3", integrity: advisor.integrity, bin: "advisor-execution-readiness" },
      target: { name: "@vespeneventures/synthetic-target", version: "1.0.0", integrity: target.integrity, bin: "synthetic-target-check", invocation: "single-json-input" },
    };
    for (const identity of Object.values(identities)) {
      consumerManifest.devDependencies[identity.name] = identity.version;
      lock.packages[""].devDependencies[identity.name] = identity.version;
      expect(lock.packages[`node_modules/${identity.name}`]).toMatchObject({ version: identity.version, integrity: identity.integrity });
    }
    writeJson(join(consumer, "package.json"), consumerManifest); writeJson(join(consumer, "package-lock.json"), lock);
    const pnpmLock = `lockfileVersion: '9.0'\nimporters:\n  .:\n    devDependencies:\n${Object.values(identities).map((identity) => `      '${identity.name}':\n        specifier: ${identity.version}\n        version: ${identity.version}`).join("\n")}\npackages:\n${Object.values(identities).map((identity) => `  '${identity.name}@${identity.version}':\n    resolution: {integrity: ${identity.integrity}}`).join("\n")}\n`;
    writeFileSync(join(consumer, "pnpm-lock.yaml"), pnpmLock);
    const requestPath = join(consumer, "request.json"); const snapshotRoot = join(consumer, "snapshot"); const eventPath = join(consumer, "event.json"); const receiptPath = join(consumer, "receipt.json");
    mkdirSync(join(snapshotRoot, "evidence"), { recursive: true });
    const bin = join(consumer, "node_modules", ".bin", "foundry-starter");
    const invoke = (targetMode: string, assessmentValue = assessment(identities.target, "consumer/repository"), requestValue: unknown = { schemaVersion: 1, phase: "activation", packageManager: "npm", snapshot: { repository: "consumer/repository", maxAgeMs: 60_000 }, ...identities, evidence: { assessment: "evidence/assessment.json", targetInput: "evidence/target.json" } }, receipt = { schemaVersion: 1, packageManager: "npm", attempted: true, exitCode: 0 }) => {
      writeJson(join(snapshotRoot, "evidence", "assessment.json"), assessmentValue); writeJson(join(snapshotRoot, "evidence", "target.json"), { mode: targetMode });
      const files = ["assessment.json", "target.json"].map((name) => { const content = readFileSync(join(snapshotRoot, "evidence", name)); return { path: `evidence/${name}`, size: content.length, sha256: createHash("sha256").update(content).digest("hex") }; });
      writeJson(join(snapshotRoot, "snapshot.json"), { schemaVersion: 1, provider: "github-actions", eventName: "pull_request", repository: "consumer/repository", pullRequestNumber: 1, baseSha: sha("b"), headSha: sha("c"), workflowRunId: "1", artifactName: "adoption-snapshot-1", digest: sha("d"), capturedAt: new Date().toISOString(), files });
      writeJson(eventPath, { schemaVersion: 1, provider: "github-actions", eventName: "workflow_run", repository: "consumer/repository", baseSha: sha("b"), sourceWorkflowRunId: "1", sourceHeadSha: sha("c"), artifactName: "adoption-snapshot-1", sourceConclusion: "success" });
      writeJson(requestPath, requestValue); writeJson(receiptPath, receipt);
      const result = spawnSync(process.execPath, [bin, "decide", requestPath, snapshotRoot, eventPath, receiptPath], { cwd: consumer, encoding: "utf8", timeout: 15_000, maxBuffer: 4_000_000 });
      return { status: result.status, report: JSON.parse(result.stdout || "{}") as { state: string; findings: Array<{ rule: string }> } };
    };

    const help = spawnSync(process.execPath, [bin, "--help"], { cwd: consumer, encoding: "utf8" });
    expect(help.status).toBe(0); expect(help.stdout).toContain("Usage: foundry-starter decide");
    expect(invoke("satisfied")).toMatchObject({ status: 0, report: { state: "satisfied" } });
    const pnpmRequest = { schemaVersion: 1, phase: "activation", packageManager: "pnpm", snapshot: { repository: "consumer/repository", maxAgeMs: 60_000 }, ...identities, evidence: { assessment: "evidence/assessment.json", targetInput: "evidence/target.json" } };
    expect(invoke("satisfied", assessment(identities.target, "consumer/repository"), pnpmRequest, { schemaVersion: 1, packageManager: "pnpm", attempted: true, exitCode: 0 })).toMatchObject({ status: 0, report: { state: "satisfied" } });
    expect(invoke("violated")).toMatchObject({ status: 1, report: { state: "violated" } });
    expect(invoke("indeterminate")).toMatchObject({ status: 2, report: { state: "indeterminate" } });
    const authorizationViolation = assessment(identities.target, "consumer/repository");
    const authorization = authorizationViolation.engagement.executionAuthorization as { permittedRepositoryIds: string[] };
    authorization.permittedRepositoryIds = ["other/repository"];
    expect(invoke("satisfied", authorizationViolation)).toMatchObject({ status: 1, report: { state: "violated" } });
    const replay = invoke("satisfied", assessment(identities.target, "other/repository"));
    expect(replay.status).toBe(1); expect(replay.report).toMatchObject({ state: "violated" }); expect(replay.report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "advisor-target-repository" })]));
    const wrongBin = assessment(identities.target, "consumer/repository"); (wrongBin.firstWave.workItems[0] as { bin: string }).bin = "other-bin";
    const binViolation = invoke("satisfied", wrongBin);
    expect(binViolation.status).toBe(1); expect(binViolation.report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "advisor-target-bin" })]));
    const wrongInvocation = assessment(identities.target, "consumer/repository"); (wrongInvocation.firstWave.workItems[0] as { invocation: string }).invocation = "different-invocation";
    const invocationViolation = invoke("satisfied", wrongInvocation);
    expect(invocationViolation.status).toBe(1); expect(invocationViolation.report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "advisor-target-invocation" })]));
    expect(invoke("satisfied", assessment(identities.target, "consumer/repository"), {})).toMatchObject({ status: 2, report: { state: "indeterminate" } });
    const timedOut = invoke("hang");
    expect(timedOut.status).toBe(2); expect(timedOut.report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "target-timeout" })]));

    const foundation = { schemaVersion: 1, phase: "foundation", packageManager: "npm", snapshot: { repository: "consumer/repository", maxAgeMs: 60_000 }, ...identities, evidence: { assessment: "evidence/assessment.json", targetInput: "evidence/target.json" } };
    const foundationResult = invoke("satisfied", assessment(identities.target, "consumer/repository"), foundation);
    expect(foundationResult.status).toBe(2); expect(foundationResult.report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "foundation-only" })]));
    const lockPath = join(consumer, "package-lock.json"); const cleanLock = readFileSync(lockPath, "utf8");
    lock.packages[`node_modules/${identities.starter.name}`].integrity = `sha512-${"x".repeat(85)}A==`;
    writeJson(lockPath, lock);
    const driftedFoundation = invoke("satisfied", assessment(identities.target, "consumer/repository"), foundation);
    expect(driftedFoundation.status).toBe(2); expect(driftedFoundation.report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "exact-install-identity" })]));
    writeFileSync(lockPath, cleanLock);
    const failedFoundation = invoke("satisfied", assessment(identities.target, "consumer/repository"), foundation, { schemaVersion: 1, packageManager: "npm", attempted: true, exitCode: 1 });
    expect(failedFoundation.status).toBe(1); expect(failedFoundation.report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ rule: "install-result" })]));
  }, 45_000);
});
