import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const roots: string[] = [];
const sha = (character: string) => character.repeat(64);
const integrityFor = (path: string) => `sha512-${createHash("sha512").update(readFileSync(path)).digest("base64")}`;

interface PackedPackage {
  readonly name: string;
  readonly version: string;
  readonly path: string;
  readonly integrity: string;
}

function temporaryRoot(): string { const root = join(tmpdir(), `starter-pack-${Date.now()}-${Math.random().toString(16).slice(2)}`); mkdirSync(root); roots.push(root); return root; }
function run(command: string, args: readonly string[], cwd: string, timeout = 30_000): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout, maxBuffer: 4_000_000 });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout || result.error?.message}`);
  return result.stdout;
}
function runAsync(command: string, args: readonly string[], cwd: string, timeout = 30_000): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); rejectRun(error); });
    child.on("close", (status) => {
      clearTimeout(timer);
      if (status === 0) resolveRun(stdout);
      else rejectRun(new Error(`${command} ${args.join(" ")} failed (${status}): ${stderr || stdout}`));
    });
  });
}
function writeJson(path: string, value: unknown): void { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
function pack(directory: string, destination: string, name: string, version: string): PackedPackage {
  const output = run("npm", ["pack", "--json", "--pack-destination", destination, "--ignore-scripts"], directory);
  const item = JSON.parse(output) as Array<{ filename: string }>;
  const path = join(destination, item[0]?.filename ?? "");
  return { name, version, path, integrity: integrityFor(path) };
}

function assessment(target: { name: string; version: string; integrity: string; bin: string }, repository: string) {
  const evidence = [{ id: "evidence", description: "Consumer-owned proof." }];
  const action = { kind: "reconcile", ownerRef: "consumer-owner", dueAt: "2099-01-01T00:00:00Z", escalationRef: "consumer-sponsor" };
  const basis = { snapshotDigest: `sha256:${sha("a")}`, grantDigest: `sha256:${sha("b")}`, catalogDigest: `sha256:${sha("c")}`, planDigest: `sha256:${sha("d")}`, blockerDigest: `sha256:${sha("e")}`, clearanceDigest: `sha256:${sha("f")}`, conflictDigest: `sha256:${sha("1")}`, baselineDigest: `sha256:${sha("2")}`, completionDefinitionDigest: `sha256:${sha("3")}`, assessedAt: "2020-01-01T00:00:00Z", freshUntil: "2099-01-01T00:00:00Z" };
  const workItem = { id: "authorized-target", initiativeId: "initiative", targetRepositoryId: repository, deliveryOwnerRef: "delivery-owner", package: { name: target.name, version: target.version, integrity: target.integrity }, bin: target.bin, invocation: "single-json-input", placement: "consumer required check", baseline: { metricRef: "consumer-metric", value: 0, observedAt: "2020-01-01T00:00:00Z", evidence: evidence[0] }, completion: { definition: "Measure the independent consumer outcome.", independentOutcomeOwnerRef: "outcome-owner", evidenceSource: "consumer measurement", direction: "increase", setpoint: 1, windowDays: 7 }, rollback: { procedure: "Restore the prior known-good consumer lockfile.", evidenceSource: "consumer rollback record" }, mutationSurfaces: ["consumer-lockfile"] };
  const authorization = { planDigest: basis.planDigest, assessmentBasis: basis, sponsorRef: "consumer-sponsor", permittedRepositoryIds: [repository], permittedPackages: [workItem.package], permittedMutationSurfaces: ["consumer-lockfile"], grantedAt: "2020-01-01T00:00:00Z", expiresAt: "2099-01-01T00:00:00Z" };
  return {
    id: "assessment", asOf: "2026-08-27T12:00:00Z",
    engagement: { id: "engagement", status: "active", nextAction: action, assessmentBasis: basis, executionAuthorization: authorization },
    fitSignals: ["sponsor-mandate", "material-need", "offering-operating-compatibility", "expected-value-burden", "adoption-capacity", "legal-ethical-safety"].map((id) => ({ id, state: "supported", evidence })),
    prerequisiteObservations: ["scope-repository-inventory", "read-access", "authority-approval", "initiative-mutation-dependency-inventory", "immutable-artifact-access", "baseline", "independent-outcome-owner", "rollback-review-window"].map((id) => ({ id, state: "satisfied", evidence })),
    initiatives: [{ id: "initiative", status: "active", targetRepositoryIds: [repository], workstreamConflictKeys: ["workstream"], dependencyConflictKeys: ["dependency"], mutationConflictKeys: ["mutation"], authorityConflictKeys: ["authority"], scheduleConflictKeys: ["schedule"], dataOutcomeMetricConflictKeys: ["metric"] }],
    firstWave: { initiativeIds: ["initiative"], objectives: ["Run the exact installed target."], workItems: [workItem] },
    preWorkItems: ["baseline", "conflict"].map((kind) => ({ id: kind, kind, status: "satisfied", addressesReadinessCriteria: [kind === "baseline" ? "baseline" : "initiative-mutation-dependency-inventory"], targetRepositoryIds: [repository], ownerRef: `${kind}-owner`, impact: "The consumer-owned prerequisite is cleared.", evidence, nextAction: { ...action, ownerRef: `${kind}-owner` }, dependencySurfaces: ["consumer evidence"], mutationSurfaces: ["consumer-lockfile"], clearance: { authorityOwnerRef: `${kind}-authority`, evidence } })),
    reassessment: { cadenceDays: 7, triggers: ["evidence-change"] },
  };
}

async function localRegistry(packages: readonly PackedPackage[]): Promise<{ readonly url: string; close(): Promise<void> }> {
  const byName = new Map(packages.map((entry) => [entry.name, entry]));
  const byTarball = new Map(packages.map((entry) => [basename(entry.path), entry]));
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://registry.invalid").pathname;
    if (pathname.startsWith("/tarballs/")) {
      const entry = byTarball.get(decodeURIComponent(pathname.slice("/tarballs/".length)));
      if (entry === undefined) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "content-type": "application/octet-stream" }); response.end(readFileSync(entry.path)); return;
    }
    const entry = byName.get(decodeURIComponent(pathname.slice(1)));
    if (entry === undefined) { response.writeHead(404); response.end(); return; }
    const address = server.address() as AddressInfo;
    const tarball = `http://127.0.0.1:${address.port}/tarballs/${encodeURIComponent(basename(entry.path))}`;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ name: entry.name, "dist-tags": { latest: entry.version }, versions: { [entry.version]: { name: entry.name, version: entry.version, dist: { tarball, integrity: entry.integrity } } } }));
  });
  await new Promise<void>((resolveListen, rejectListen) => { server.once("error", rejectListen); server.listen(0, "127.0.0.1", resolveListen); });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((resolveClose, rejectClose) => server.close((error) => error === undefined ? resolveClose() : rejectClose(error))),
  };
}

function writeRegistryConfig(root: string, registryUrl: string): void {
  writeFileSync(join(root, ".npmrc"), `@vespeneventures:registry=${registryUrl}\n@fixture:registry=${registryUrl}\n`);
}

function identities(starter: PackedPackage, advisor: PackedPackage, target: PackedPackage) {
  return {
    starter: { name: starter.name, version: starter.version, integrity: starter.integrity, bin: "foundry-starter" },
    advisor: { name: advisor.name, version: advisor.version, integrity: advisor.integrity, bin: "advisor-execution-readiness" },
    target: { name: target.name, version: target.version, integrity: target.integrity, bin: "fixture-target-check", invocation: "single-json-input" as const },
  };
}

function invoke(root: string, packageManager: "npm" | "pnpm", installed: ReturnType<typeof identities>, targetMode: string) {
  const requestPath = join(root, "request.json"); const snapshotRoot = join(root, "snapshot"); const eventPath = join(root, "event.json"); const receiptPath = join(root, "receipt.json");
  mkdirSync(join(snapshotRoot, "evidence"), { recursive: true });
  writeJson(join(snapshotRoot, "evidence", "assessment.json"), assessment(installed.target, "consumer/repository"));
  writeJson(join(snapshotRoot, "evidence", "target.json"), { mode: targetMode });
  const files = ["assessment.json", "target.json"].map((name) => { const content = readFileSync(join(snapshotRoot, "evidence", name)); return { path: `evidence/${name}`, size: content.length, sha256: createHash("sha256").update(content).digest("hex") }; });
  writeJson(join(snapshotRoot, "snapshot.json"), { schemaVersion: 1, provider: "github-actions", eventName: "pull_request", repository: "consumer/repository", pullRequestNumber: 1, baseSha: sha("b"), headSha: sha("c"), workflowRunId: "1", artifactName: "adoption-snapshot-1", digest: sha("d"), capturedAt: new Date().toISOString(), files });
  writeJson(requestPath, { schemaVersion: 1, phase: "activation", packageManager, snapshot: { repository: "consumer/repository", maxAgeMs: 60_000 }, ...installed, evidence: { assessment: "evidence/assessment.json", targetInput: "evidence/target.json" } });
  writeJson(eventPath, { schemaVersion: 1, provider: "github-actions", eventName: "workflow_run", repository: "consumer/repository", baseSha: sha("b"), sourceWorkflowRunId: "1", sourceHeadSha: sha("c"), artifactName: "adoption-snapshot-1", sourceConclusion: "success" });
  writeJson(receiptPath, { schemaVersion: 1, packageManager, attempted: true, exitCode: 0 });
  const starterCli = join(root, "node_modules", "@vespeneventures", "starter", "dist", "cli.js");
  const result = spawnSync(process.execPath, [starterCli, "decide", requestPath, snapshotRoot, eventPath, receiptPath], { cwd: root, encoding: "utf8", timeout: 15_000, maxBuffer: 4_000_000 });
  return { status: result.status, report: JSON.parse(result.stdout || "{}") as { state: string } };
}

async function installNpmConsumer(root: string, registryUrl: string, installed: ReturnType<typeof identities>): Promise<void> {
  writeJson(join(root, "package.json"), { name: "fixture-npm-consumer", private: true, version: "1.0.0", devDependencies: Object.fromEntries(Object.values(installed).map(({ name, version }) => [name, version])) });
  writeRegistryConfig(root, registryUrl);
  await runAsync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], root);
  expect(JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")).packages[`node_modules/${installed.starter.name}`]).toMatchObject({ version: installed.starter.version, integrity: installed.starter.integrity });
  rmSync(join(root, "node_modules"), { recursive: true, force: true });
  await runAsync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], root);
}

async function installPnpmConsumer(root: string, registryUrl: string, installed: ReturnType<typeof identities>): Promise<void> {
  writeJson(join(root, "package.json"), { name: "fixture-pnpm-consumer", private: true, version: "1.0.0", packageManager: "pnpm@10.33.0", devDependencies: Object.fromEntries(Object.values(installed).map(({ name, version }) => [name, version])) });
  mkdirSync(join(root, "packages", "fixture-member"), { recursive: true });
  writeJson(join(root, "packages", "fixture-member", "package.json"), { name: "fixture-pnpm-member", private: true, version: "1.0.0" });
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
  writeRegistryConfig(root, registryUrl);
  await runAsync("pnpm", ["install", "--ignore-scripts"], root);
  expect(existsSync(join(root, "package-lock.json"))).toBe(false);
  expect(readFileSync(join(root, "pnpm-lock.yaml"), "utf8")).toContain(installed.starter.name);
  rmSync(join(root, "node_modules"), { recursive: true, force: true });
  await runAsync("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"], root);
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("packed installed activation canaries", () => {
  it("uses isolated real npm and pnpm consumers and preserves readable 0/1/2 outcomes", async () => {
    run("npm", ["run", "build", "--workspace=packages/advisor"], repoRoot);
    run("npm", ["run", "build", "--workspace=packages/starter"], repoRoot);
    const fixtureRoot = temporaryRoot(); const packed = join(fixtureRoot, "packed"); const targetPackage = join(fixtureRoot, "target-package");
    mkdirSync(packed); mkdirSync(join(targetPackage, "bin"), { recursive: true });
    writeJson(join(targetPackage, "package.json"), { name: "@fixture/starter-target", version: "1.0.0", private: true, type: "module", bin: { "fixture-target-check": "./bin/check.js" }, files: ["bin"] });
    writeFileSync(join(targetPackage, "bin", "check.js"), "#!/usr/bin/env node\nimport { readFileSync } from 'node:fs';\nconst input = JSON.parse(readFileSync(process.argv[2], 'utf8'));\nconst state = input.mode === 'violated' ? 'violated' : input.mode === 'indeterminate' ? 'indeterminate' : 'satisfied';\nconsole.log(JSON.stringify({state}));\nprocess.exit(state === 'satisfied' ? 0 : state === 'violated' ? 1 : 2);\n");
    chmodSync(join(targetPackage, "bin", "check.js"), 0o755);
    const starter = pack(join(repoRoot, "packages/starter"), packed, "@vespeneventures/starter", "0.1.0");
    const advisor = pack(join(repoRoot, "packages/advisor"), packed, "@vespeneventures/advisor", "0.1.3");
    const target = pack(targetPackage, packed, "@fixture/starter-target", "1.0.0");
    const installed = identities(starter, advisor, target); const registry = await localRegistry([starter, advisor, target]);
    try {
      const npmRoot = join(fixtureRoot, "npm-consumer"); mkdirSync(npmRoot);
      await installNpmConsumer(npmRoot, registry.url, installed);
      const npmHelp = spawnSync(process.execPath, [join(npmRoot, "node_modules", "@vespeneventures", "starter", "dist", "cli.js"), "--help"], { cwd: npmRoot, encoding: "utf8" });
      expect(npmHelp.status, npmHelp.stderr || npmHelp.error?.message).toBe(0); expect(npmHelp.stdout).toContain("Usage: foundry-starter decide");
      expect(invoke(npmRoot, "npm", installed, "satisfied")).toMatchObject({ status: 0, report: { state: "satisfied" } });
      expect(invoke(npmRoot, "npm", installed, "violated")).toMatchObject({ status: 1, report: { state: "violated" } });
      expect(invoke(npmRoot, "npm", installed, "indeterminate")).toMatchObject({ status: 2, report: { state: "indeterminate" } });

      const pnpmRoot = join(fixtureRoot, "pnpm-consumer"); mkdirSync(pnpmRoot);
      await installPnpmConsumer(pnpmRoot, registry.url, installed);
      const pnpmHelp = spawnSync(process.execPath, [join(pnpmRoot, "node_modules", "@vespeneventures", "starter", "dist", "cli.js"), "--help"], { cwd: pnpmRoot, encoding: "utf8" });
      expect(pnpmHelp.status).toBe(0); expect(pnpmHelp.stdout).toContain("Usage: foundry-starter decide");
      expect(invoke(pnpmRoot, "pnpm", installed, "satisfied")).toMatchObject({ status: 0, report: { state: "satisfied" } });
      expect(invoke(pnpmRoot, "pnpm", installed, "violated")).toMatchObject({ status: 1, report: { state: "violated" } });
      expect(invoke(pnpmRoot, "pnpm", installed, "indeterminate")).toMatchObject({ status: 2, report: { state: "indeterminate" } });
    } finally {
      await registry.close();
    }
  }, 90_000);
});
