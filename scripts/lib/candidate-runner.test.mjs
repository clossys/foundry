import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { assertCredentialFree, installNpmrc, runCandidateQualification, runProcess, wildcardCapture } from "./candidate-runner.mjs";

const execFile = promisify(execFileCallback);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function syntheticPackage({ mismatch = false, exports = undefined, runtimePeer = false, peerInstall = undefined } = {}) {
  const root = await mkdtemp(join(tmpdir(), "foundry-runner-test-"));
  const source = join(root, "source");
  const fixturesDir = join(root, "fixtures");
  const packed = join(root, "packed");
  await mkdir(source);
  await mkdir(fixturesDir);
  await mkdir(packed);
  await writeFile(join(source, "package.json"), JSON.stringify({
    name: "@acme/synthetic",
    version: "1.0.0",
    type: "module",
    exports: exports ?? { ".": { types: "./index.d.ts", import: "./index.js" }, "./asset": "./asset.txt", "./static/*": "./static/*.txt" },
    files: ["index.js", "index.d.ts", "cli.js", "asset.txt", "static"],
    bin: { "synthetic-check": "cli.js" },
    scripts: { preinstall: "node -e \"require('fs').writeFileSync('preinstall-marker','ran')\"" },
    ...(runtimePeer ? { peerDependencies: { typescript: "~6.0.0" }, peerDependenciesMeta: { typescript: { optional: true } } } : {}),
  }, null, 2));
  await writeFile(join(source, "index.js"), `${runtimePeer ? "import 'typescript';\n" : ""}export const synthetic = true;\n`);
  await writeFile(join(source, "index.d.ts"), "export declare const synthetic: boolean;\n");
  await writeFile(join(source, "asset.txt"), "static asset\n");
  await mkdir(join(source, "static"));
  await writeFile(join(source, "static", "one.txt"), "one\n");
  await writeFile(join(source, "static", "two.txt"), "two\n");
  await writeFile(join(source, "cli.js"), [
    "import { readFileSync } from 'node:fs';",
    "const credentials = ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'GH_PACKAGES_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN'];",
    "if (credentials.some((key) => process.env[key])) process.exit(9);",
    "if (process.argv[2] === '--help') { console.log('synthetic help'); process.exit(0); }",
    "const item = JSON.parse(readFileSync(process.argv[2], 'utf8'));",
    "if (item.mode === 'hang') setTimeout(() => process.exit(item.actual), 60_000);",
    "console.log(item.id); process.exit(item.actual);",
    "",
  ].join("\n"));
  const entries = [
    ["green.json", { id: "green", actual: 0 }],
    ["red.json", { id: "red", actual: mismatch ? 0 : 1 }],
    ["indeterminate.json", { id: "indeterminate", actual: 2 }],
  ];
  for (const [name, body] of entries) await writeFile(join(fixturesDir, name), JSON.stringify(body));
  const packedResult = await execFile("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", packed], { cwd: source });
  const tarball = join(packed, JSON.parse(packedResult.stdout)[0].filename);
  const fixtureNames = entries.map(([name]) => name);
  const fixtures = Object.fromEntries(await Promise.all(fixtureNames.map(async (name) => {
    const path = join(fixturesDir, name);
    return [name, { path, type: "file", symlink: false, tracked: true, size: (await readFile(path)).length }];
  })));
  const policy = {
    schemaVersion: 1, protocol: "foundry-candidate-qualification-v1", packages: { "@acme/synthetic": {
    packageKey: "synthetic", recordStem: "synthetic", packageDir: "packages/synthetic", adapterPath: "governance/release-qualification-adapters/synthetic/current-direct.json", fixturePath: "governance/release-qualification-fixtures/synthetic/current-direct", archetypes: {
      "current-direct": { status: "required" },
      "prior-minor": { status: "unsupported", reason: "not supplied" },
      "oldest-supported": { status: "unsupported", reason: "not supplied" },
      "control-plane": { status: "unsupported", reason: "not supplied" },
    },
    dimensions: { position: { status: "unsupported", reason: "none" }, completion: { status: "unsupported", reason: "none" }, rollback: { status: "required" }, duplicate: { status: "required" }, cadence: { status: "unsupported", reason: "none" }, closeWindow: { status: "unsupported", reason: "none" } },
    } },
  };
  const adapter = {
    schemaVersion: 1,
    package: "@acme/synthetic",
    archetype: "current-direct",
    ...(peerInstall ? { peerInstall } : {}),
    bins: { "synthetic-check": 0 },
    fixtures: fixtureNames,
    cases: [
      { id: "green", bin: "synthetic-check", fixtureArgs: ["green.json"], exitCode: 0, group: "authority" },
      { id: "red", bin: "synthetic-check", fixtureArgs: ["red.json"], exitCode: 1, group: "authority" },
      { id: "indeterminate", bin: "synthetic-check", fixtureArgs: ["indeterminate.json"], exitCode: 2, group: "authority" },
    ],
    dimensionEvidence: { rollback: "restoration", duplicate: "authority" },
  };
  return { root, source, tarball, policy, adapter, fixtures, manifestBins: { "synthetic-check": "cli.js" }, registry: { scope: "@acme", registry: "https://registry.npmjs.org/" } };
}

test("runner isolates a packed candidate and produces a deterministic complete transcript", async (t) => {
  const fixture = await syntheticPackage();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  // The checkout changes after packing; only the supplied tarball is eligible for execution.
  await writeFile(join(fixture.source, "cli.js"), "process.exit(9);\n");
  const first = await runCandidateQualification(fixture);
  const second = await runCandidateQualification(fixture);
  assert.equal(first.ok, true);
  assert.equal(first.schema, "foundry-candidate-qualification-transcript-v1");
  assert.deepEqual(first, second);
  assert.equal(first.coverage.lifecycleScriptsDisabled, true);
  assert.equal(first.coverage.bins, 1);
  assert.equal(first.restoration.manifestRestored, true);
  assert.equal(first.restoration.lockfileRestored, true);
  assert.equal(first.restoration.packageAbsentAfterUninstall, true);
  assert.deepEqual(first.observations.map((item) => item.id), [
    "install", "import:0", "help:synthetic-check", "case:green", "case:red", "case:indeterminate", "uninstall", "reinstall",
  ]);
  assert.deepEqual(first.coverage, {
    declaredExportKeys: 3,
    concreteTargets: 5,
    runtimeImports: 1,
    staticTargets: 4,
    failed: 0,
    installedManifestSha256: first.coverage.installedManifestSha256,
    bins: 1,
    lifecycleScriptsDisabled: true,
  });
  assert.ok(first.observations.filter((item) => item.kind === "help" || item.kind === "case").every((item) => item.launch === "node-direct"));
  assert.equal(JSON.stringify(first).includes(fixture.root), false);
  const { canonicalSha256, ...canonical } = first;
  assert.equal(canonicalSha256, sha256(JSON.stringify(canonical)));
});

test("qualification refuses credential-bearing parents and npm configuration carries no credential", () => {
  const registry = { scope: "@acme", registry: "https://registry.example.test/npm/" };
  assert.equal(installNpmrc(registry), "@acme:registry=https://registry.example.test/npm/\n");
  assert.throws(() => assertCredentialFree({ NODE_AUTH_TOKEN: "secret" }), /credential-bearing/);
  assert.doesNotThrow(() => assertCredentialFree({}));
});

async function addConsumerOverlay(fixture, target) {
  const name = "overlay-package.json";
  const path = join(fixture.root, "fixtures", name);
  const bytes = "{\"name\":\"@fixture/overlay\",\"version\":\"1.0.0\"}\n";
  await writeFile(path, bytes);
  fixture.adapter.fixtures.push(name);
  fixture.fixtures[name] = { path, type: "file", symlink: false, tracked: true, size: Buffer.byteLength(bytes) };
  fixture.adapter.consumerOverlay = [{ fixture: name, target }];
}

test("consumer overlays restore new roots and refuse to overwrite an installed optional peer", async (t) => {
  const clean = await syntheticPackage();
  const collision = await syntheticPackage({ runtimePeer: true, peerInstall: { typescript: "6.0.3" } });
  t.after(() => Promise.all([clean, collision].map((item) => rm(item.root, { recursive: true, force: true }))));

  await addConsumerOverlay(clean, "node_modules/@fixture/overlay/package.json");
  assert.equal((await runCandidateQualification(clean)).ok, true);

  await addConsumerOverlay(collision, "node_modules/typescript/package.json");
  await assert.rejects(
    () => runCandidateQualification(collision),
    /consumer overlay refuses to overwrite: target package root already exists/,
  );
});

test("runner collects all case observations before reporting a case mismatch", async (t) => {
  const fixture = await syntheticPackage({ mismatch: true });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const transcript = await runCandidateQualification(fixture);
  assert.equal(transcript.ok, false);
  assert.deepEqual(transcript.mismatches, ["case:red"]);
  assert.deepEqual(transcript.observations.filter((item) => item.kind === "case").map((item) => item.id), ["case:green", "case:red", "case:indeterminate"]);
});

test("tarball bytes, malformed candidate launch, and timeout outcomes fail closed", async (t) => {
  const fixture = await syntheticPackage();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const baseline = await runCandidateQualification(fixture);
  const changed = join(fixture.root, "changed.tgz");
  await copyFile(fixture.tarball, changed);
  await appendFile(changed, "trailing-bytes");
  assert.notEqual(baseline.tarball.sha256, sha256(await readFile(changed)));
  const missing = await runProcess("foundry-command-that-does-not-exist", []);
  assert.equal(missing.launchError, true);
  const timedOut = await runProcess(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { timeout: 20 });
  assert.ok(timedOut.signal === "SIGKILL" || timedOut.launchError || timedOut.exitCode !== 0);
});

test("runner rejects escaping, unexpanded, and unsupported export mappings", async (t) => {
  const escaping = await syntheticPackage({ exports: { ".": "../outside.js" } });
  const emptyWildcard = await syntheticPackage({ exports: { "./missing/*": "./missing/*.js" } });
  const unknownCondition = await syntheticPackage({ exports: { ".": { require: "./index.js" } } });
  t.after(() => Promise.all([escaping, emptyWildcard, unknownCondition].map((item) => rm(item.root, { recursive: true, force: true }))));
  await assert.rejects(() => runCandidateQualification(escaping), /invalid export target/);
  await assert.rejects(() => runCandidateQualification(emptyWildcard), /no packaged files/);
  await assert.rejects(() => runCandidateQualification(unknownCondition), /unsupported export conditions/);
});

test("wildcard matching is literal, bounded, and independent of regular-expression metacharacters", () => {
  assert.equal(wildcardCapture("./static+[/*.txt", "./static+[/name[0]+.txt"), "name[0]+");
  assert.equal(wildcardCapture("./static/*.txt", "./static/name.txt.extra.txt"), "name.txt.extra");
  assert.equal(wildcardCapture("./static/*.txt", "./static/name.js"), null);
  assert.equal(wildcardCapture("./static/*.txt", `${"x".repeat(200_000)}.txt`), null);
  assert.throws(() => wildcardCapture("./static/no-wildcard.txt", "./static/no-wildcard.txt"), /exactly one wildcard/);
  assert.throws(() => wildcardCapture("./static/**.txt", "./static/name.txt"), /exactly one wildcard/);
});

test("optional peer runtime exports stay red until an exact compatible peer is installed", async (t) => {
  const absent = await syntheticPackage({ runtimePeer: true });
  const present = await syntheticPackage({ runtimePeer: true, peerInstall: { typescript: "6.0.3" } });
  t.after(() => Promise.all([absent, present].map((item) => rm(item.root, { recursive: true, force: true }))));
  const red = await runCandidateQualification(absent);
  assert.equal(red.ok, false);
  assert.ok(red.mismatches.includes("import:0"));
  const green = await runCandidateQualification(present);
  assert.equal(green.ok, true);
  assert.deepEqual(green.peerInstall, { typescript: "6.0.3" });
  assert.equal(green.observations.find((item) => item.id === "install").expectedExitCode, 0);
});
