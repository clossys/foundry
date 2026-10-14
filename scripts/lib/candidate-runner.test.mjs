import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { QUALIFICATION_PHASE_TIMEOUTS, WINDOWS_BIN_LAUNCH_REASON, assertCredentialFree, candidateNotInstalledMessage, containedRegularFile, installNpmrc, normalizedStream, packedFrameworkContexts, runCandidateQualification, runProcess, runtimeImportArguments, wildcardCapture } from "./candidate-runner.mjs";
import { BY_DESIGN_REFUSALS } from "./packed-consumer-readiness.mjs";
import { RELEASE_RUNTIME } from "./release-runtime.mjs";

const execFile = promisify(execFileCallback);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const releaseRuntimeRun = (file, args) => {
  if (args[0] === "--version") return { status: 0, stdout: file === process.execPath ? `${RELEASE_RUNTIME.node}\n` : `${RELEASE_RUNTIME.npm}\n`, stderr: "" };
  if (args[0] === "-p") return { status: 0, stdout: `${RELEASE_RUNTIME.zlib}\n`, stderr: "" };
  throw new Error(`unexpected release runtime probe ${file} ${args.join(" ")}`);
};
async function syntheticPackage({ mismatch = false, exports = undefined, runtimePeer = false, peerInstall = undefined, rawStarter = false, mutateCaseEvidence = null, unresolvedArgvGuard = false, binName = "synthetic-check", extraFiles = {}, name = undefined } = {}) {
  const root = await mkdtemp(join(tmpdir(), "foundry-runner-test-"));
  const source = join(root, "source");
  const fixturesDir = join(root, "fixtures");
  const packed = join(root, "packed");
  await mkdir(source);
  await mkdir(fixturesDir);
  await mkdir(packed);
  const packageName = name ?? (rawStarter ? "@clossys/starter" : "@acme/synthetic");
  // The policy bindings follow the package name: scope "@acme" and key
  // "synthetic" give recordStem "acme-synthetic" and packageDir
  // "packages/synthetic", exactly as before this option existed.
  const [packageScope, packageKey] = packageName.slice(1).split("/");
  await writeFile(join(source, "package.json"), JSON.stringify({
    name: packageName,
    version: "1.0.0",
    type: "module",
    exports: exports ?? { ".": { types: "./index.d.ts", import: "./index.js" }, "./asset": "./asset.txt", "./static/*": "./static/*.txt" },
    files: ["index.js", "react-server.js", "index.d.ts", "cli.js", "asset.txt", "static", ...Object.keys(extraFiles)],
    bin: { [binName]: "cli.js" },
    scripts: { preinstall: "node -e \"require('fs').writeFileSync('preinstall-marker','ran')\"" },
    ...(runtimePeer ? { peerDependencies: { typescript: "~6.0.0" }, peerDependenciesMeta: { typescript: { optional: true } } } : {}),
  }, null, 2));
  await writeFile(join(source, "index.js"), `${runtimePeer ? "import 'typescript';\n" : ""}export const synthetic = true;\n`);
  await writeFile(join(source, "react-server.js"), "export const synthetic = 'react-server';\n");
  await writeFile(join(source, "index.d.ts"), "export declare const synthetic: boolean;\n");
  await writeFile(join(source, "asset.txt"), "static asset\n");
  for (const [name, body] of Object.entries(extraFiles)) await writeFile(join(source, name), body);
  await mkdir(join(source, "static"));
  await writeFile(join(source, "static", "one.txt"), "one\n");
  await writeFile(join(source, "static", "two.txt"), "two\n");
  await writeFile(join(source, "cli.js"), [
    "import { readFileSync, writeFileSync } from 'node:fs';",
    ...(unresolvedArgvGuard ? [
      "import { fileURLToPath } from 'node:url';",
      "import { resolve } from 'node:path';",
      "function detectMainModule() { return fileURLToPath(import.meta.url) === resolve(process.argv[1]); }",
      "if (!detectMainModule()) process.exit(0);",
    ] : []),
    "const credentials = ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'GH_PACKAGES_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN'];",
    "if (credentials.some((key) => process.env[key])) process.exit(9);",
    "if (process.argv[2] === '--help') { console.log('synthetic help'); process.exit(0); }",
    "const item = JSON.parse(readFileSync(process.argv[2], 'utf8'));",
    ...(mutateCaseEvidence === "input" ? ["writeFileSync(process.argv[2], JSON.stringify({ ...item, mutated: true }));"] : []),
    ...(mutateCaseEvidence === "future-input" ? ["writeFileSync('fixtures/red.json', JSON.stringify({ id: 'red', actual: 1, mutated: true }));"] : []),
    ...(mutateCaseEvidence === "overlay-source" ? ["writeFileSync('fixtures/overlay/advisor-package.json', 'mutated overlay source');"] : []),
    ...(mutateCaseEvidence === "overlay-target" ? ["writeFileSync('node_modules/@clossys/advisor/package.json', 'mutated overlay target');"] : []),
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
  const overlayEntries = rawStarter ? [
    ["overlay/package.json", '{"private":true,"dependencies":{"@clossys/starter":"1.0.0"}}\n'],
    ["overlay/package-lock.json", '{"name":"raw-starter-consumer","lockfileVersion":3,"packages":{}}\n'],
    ["overlay/advisor-package.json", '{"name":"@clossys/advisor","version":"1.0.0","type":"module"}\n'],
    ["overlay/advisor-cli.js", "#!/usr/bin/env node\nprocess.exit(2);\n"],
    ["overlay/target-package.json", '{"name":"@fixture/qualification-target","version":"1.0.0","type":"module"}\n'],
    ["overlay/target-cli.js", "#!/usr/bin/env node\nprocess.exit(0);\n"],
  ] : [];
  for (const [name, body] of overlayEntries) {
    await mkdir(join(fixturesDir, "overlay"), { recursive: true });
    await writeFile(join(fixturesDir, name), body);
  }
  const packedResult = await execFile("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", packed], { cwd: source });
  const tarball = join(packed, JSON.parse(packedResult.stdout)[0].filename);
  const fixtureNames = [...entries, ...overlayEntries].map(([name]) => name);
  const fixtures = Object.fromEntries(await Promise.all(fixtureNames.map(async (name) => {
    const path = join(fixturesDir, name);
    return [name, { path, type: "file", symlink: false, tracked: true, size: (await readFile(path)).length }];
  })));
  const policy = {
    schemaVersion: 1, protocol: "foundry-candidate-qualification-v1", packages: { [packageName]: {
    packageKey, recordStem: `${packageScope}-${packageKey}`, packageDir: `packages/${packageKey}`, adapterPath: `governance/release-qualification-adapters/${packageKey}/current-direct.json`, fixturePath: `governance/release-qualification-fixtures/${packageKey}/current-direct`, archetypes: {
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
    package: packageName,
    archetype: "current-direct",
    ...(rawStarter ? {
      retainRawCaseEvidence: true,
      consumerOverlay: [
        { fixture: "overlay/package.json", target: "package.json" },
        { fixture: "overlay/package-lock.json", target: "package-lock.json" },
        { fixture: "overlay/advisor-package.json", target: "node_modules/@clossys/advisor/package.json" },
        { fixture: "overlay/advisor-cli.js", target: "node_modules/@clossys/advisor/dist/execution-readiness-cli.js" },
        { fixture: "overlay/target-package.json", target: "node_modules/@fixture/qualification-target/package.json" },
        { fixture: "overlay/target-cli.js", target: "node_modules/@fixture/qualification-target/dist/check.js" },
      ],
    } : {}),
    ...(peerInstall ? { peerInstall } : {}),
    bins: { [binName]: 0 },
    fixtures: fixtureNames,
    cases: [
      { id: "green", bin: binName, fixtureArgs: ["green.json"], exitCode: 0, group: "authority" },
      { id: "red", bin: binName, fixtureArgs: ["red.json"], exitCode: 1, group: "authority" },
      { id: "indeterminate", bin: binName, fixtureArgs: ["indeterminate.json"], exitCode: 2, group: "authority" },
    ],
    dimensionEvidence: { rollback: "restoration", duplicate: "authority" },
  };
  return { root, source, tarball, policy, adapter, fixtures, manifestBins: { [binName]: "cli.js" }, registry: { scope: `@${packageScope}`, registry: "https://registry.npmjs.org/" }, releaseRuntimeRun };
}

test("runner isolates a packed candidate and produces a deterministic complete transcript", async (t) => {
  const fixture = await syntheticPackage();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  // The checkout changes after packing; only the supplied tarball is eligible for execution.
  await writeFile(join(fixture.source, "cli.js"), "process.exit(9);\n");
  const first = await runCandidateQualification(fixture);
  const second = await runCandidateQualification(fixture);
  assert.equal(first.ok, true);
  assert.equal(first.schema, "foundry-candidate-qualification-transcript-v3");
  assert.equal(first.version, 3);
  assert.deepEqual(first, second);
  assert.equal(first.coverage.lifecycleScriptsDisabled, true);
  assert.equal(first.coverage.bins, 1);
  assert.equal(first.restoration.manifestRestored, true);
  assert.equal(first.restoration.lockfileRestored, true);
  assert.equal(first.restoration.packageAbsentAfterUninstall, true);
  assert.deepEqual(first.observations.map((item) => item.id), [
    "install", "import:import:@acme/synthetic", "help:synthetic-check", "case:green", "case:red", "case:indeterminate", "uninstall", "reinstall",
  ]);
  assert.deepEqual(first.coverage, {
    declaredExportKeys: 3,
    concreteTargets: 5,
    runtimeImports: 1,
    reactServerImports: 0,
    staticTargets: 4,
    frameworkExports: 0,
    frameworkBuilds: 0,
    failed: 0,
    installedManifestSha256: first.coverage.installedManifestSha256,
    bins: 1,
    lifecycleScriptsDisabled: true,
  });
  assert.ok(first.observations.filter((item) => item.kind === "import").every((item) => item.launch === "node-direct"));
  assert.ok(first.observations.filter((item) => item.kind === "help" || item.kind === "case").every((item) => item.launch === "installed-bin"));
  assert.equal(JSON.stringify(first).includes(fixture.root), false);
  const { canonicalSha256, ...canonical } = first;
  assert.equal(canonicalSha256, sha256(JSON.stringify(canonical)));
});

test("Starter v3 retains only bounded tokenized raw case commands, inputs, exits, and outputs", async (t) => {
  const fixture = await syntheticPackage({ rawStarter: true });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const transcript = await runCandidateQualification(fixture);
  assert.equal(transcript.ok, true);
  assert.match(transcript.fixtureMaterializedAt, /^\d{4}-\d{2}-\d{2}T/);
  const cases = transcript.observations.filter((item) => item.kind === "case");
  assert.deepEqual(cases.map((item) => item.rawCaseEvidence.exitCode), [0, 1, 2]);
  for (const item of cases) {
    const raw = item.rawCaseEvidence;
    assert.deepEqual(raw.argv.slice(0, 2), ["$NODE", "$TEMP/node_modules/.bin/synthetic-check"]);
    assert.equal(raw.argv.some((argument) => argument.includes(fixture.root)), false);
    assert.equal(raw.materializedInputs.length, 1);
    assert.match(raw.materializedInputs[0].path, /^\$TEMP\/fixtures\//);
    assert.equal(raw.materializedInputs[0].sha256, sha256(raw.materializedInputs[0].bytes));
    assert.deepEqual(raw.consumerOverlay.map(({ sourcePath, targetPath }) => [sourcePath, targetPath]), [
      ["$TEMP/fixtures/overlay/advisor-cli.js", "$TEMP/node_modules/@clossys/advisor/dist/execution-readiness-cli.js"],
      ["$TEMP/fixtures/overlay/advisor-package.json", "$TEMP/node_modules/@clossys/advisor/package.json"],
      ["$TEMP/fixtures/overlay/package-lock.json", "$TEMP/package-lock.json"],
      ["$TEMP/fixtures/overlay/package.json", "$TEMP/package.json"],
      ["$TEMP/fixtures/overlay/target-cli.js", "$TEMP/node_modules/@fixture/qualification-target/dist/check.js"],
      ["$TEMP/fixtures/overlay/target-package.json", "$TEMP/node_modules/@fixture/qualification-target/package.json"],
    ]);
    assert.ok(raw.consumerOverlay.every((overlay) => overlay.sha256 === sha256(overlay.bytes)));
    assert.equal(raw.consumerOverlay.some((overlay) => overlay.bytes.includes("/usr/bin/env")), false);
    assert.equal(raw.consumerOverlay.filter((overlay) => overlay.sourcePath.endsWith("-cli.js")).every((overlay) => overlay.bytes.includes("$ENV")), true);
    assert.equal(item.stdoutSha256, sha256(raw.stdout));
    assert.equal(item.stderrSha256, sha256(raw.stderr));
  }
  assert.ok(transcript.observations.filter((item) => item.kind !== "case").every((item) => !Object.hasOwn(item, "rawCaseEvidence")));
  assert.equal(JSON.stringify(transcript).includes(fixture.root), false);
});

test("packed hostile Starter cases cannot rewrite command inputs or overlay bytes after reading their original IDs", async (t) => {
  const probes = [
    { mutation: "input", id: "green", exitCode: 0 },
    { mutation: "future-input", id: "green", exitCode: 0 },
    { mutation: "overlay-source", id: "red", exitCode: 1 },
    { mutation: "overlay-target", id: "indeterminate", exitCode: 2 },
  ];
  for (const probe of probes) {
    const fixture = await syntheticPackage({ rawStarter: true, mutateCaseEvidence: probe.mutation });
    t.after(() => rm(fixture.root, { recursive: true, force: true }));
    fixture.adapter.cases.sort((left, right) => Number(right.id === probe.id) - Number(left.id === probe.id));
    await assert.rejects(
      () => runCandidateQualification(fixture),
      new RegExp(`candidate mutated raw case evidence inputs during execution after observed exit ${probe.exitCode}`),
    );
  }
});

test("qualification refuses credential-bearing parents and npm configuration carries no credential", () => {
  const registry = { scope: "@acme", registry: "https://registry.example.test/npm/" };
  assert.equal(installNpmrc(registry), "@acme:registry=https://registry.example.test/npm/\n");
  assert.throws(() => assertCredentialFree({ NODE_AUTH_TOKEN: "secret" }), /credential-bearing/);
  assert.doesNotThrow(() => assertCredentialFree({}));
});

test("qualification refuses a mismatched release runtime before reading candidate bytes", async (t) => {
  const fixture = await syntheticPackage();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const mismatch = (file, args) => {
    if (args[0] === "--version") return { status: 0, stdout: `${file === process.execPath ? "v24.15.0" : RELEASE_RUNTIME.npm}\n`, stderr: "" };
    if (args[0] === "-p") return { status: 0, stdout: `${RELEASE_RUNTIME.zlib}\n`, stderr: "" };
    throw new Error("unexpected release runtime probe");
  };
  await assert.rejects(() => runCandidateQualification({ ...fixture, releaseRuntimeRun: mismatch, tarball: join(fixture.root, "does-not-exist.tgz") }), /observed node v24\.15\.0/);
});

test("production qualification phases use separate reviewed bounds", () => {
  assert.deepEqual(QUALIFICATION_PHASE_TIMEOUTS, { npm: 180_000, framework: 120_000, probe: 30_000 });
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

test("preinstalled aggregate children run sequentially without child installs and restore Starter overlays after failure", async (t) => {
  const starter = await syntheticPackage({ rawStarter: true });
  const sibling = await syntheticPackage({ binName: "synthetic-sibling" });
  const failingStarter = await syntheticPackage({ rawStarter: true, mutateCaseEvidence: "input" });
  const roots = [starter, sibling, failingStarter];
  t.after(() => Promise.all(roots.map((item) => rm(item.root, { recursive: true, force: true }))));
  const consumer = join(starter.root, "shared-consumer");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), '{"name":"shared","private":true,"type":"module"}\n');
  await execFile("npm", ["install", "--ignore-scripts", "--save-exact", `file:${starter.tarball}`, `file:${sibling.tarball}`], { cwd: consumer });
  const overlays = [
    ["@clossys/advisor/package.json", "advisor-original\n"], ["@clossys/advisor/dist/execution-readiness-cli.js", "advisor-cli-original\n"],
    ["@fixture/qualification-target/package.json", "target-original\n"], ["@fixture/qualification-target/dist/check.js", "target-cli-original\n"],
  ];
  for (const [path, bytes] of overlays) { await mkdir(join(consumer, "node_modules", path, ".."), { recursive: true }); await writeFile(join(consumer, "node_modules", path), bytes); }
  const baseline = await Promise.all(["package.json", "package-lock.json", ...overlays.map(([path]) => `node_modules/${path}`)].map(async (path) => [path, await readFile(join(consumer, path), "utf8")]));
  const aggregateArgs = (fixture) => ({ ...fixture, consumerRoot: consumer, skipRollback: true, restoreConsumerOverlay: true });
  const first = await runCandidateQualification(aggregateArgs(starter));
  const second = await runCandidateQualification(aggregateArgs(sibling));
  assert.equal(first.ok, true); assert.equal(second.ok, true);
  assert.ok([first, second].every((run) => run.observations.every((observation) => !["install", "uninstall", "reinstall"].includes(observation.kind))));
  await writeFile(join(consumer, "node_modules", "@clossys", "starter", "cli.js"), await readFile(join(failingStarter.source, "cli.js"), "utf8"));
  await assert.rejects(() => runCandidateQualification(aggregateArgs(failingStarter)), /candidate mutated raw case evidence/);
  for (const [path, bytes] of baseline) assert.equal(await readFile(join(consumer, path), "utf8"), bytes, `${path} restored after aggregate child failure`);
});

test("runner collects all case observations before reporting a case mismatch", async (t) => {
  const fixture = await syntheticPackage({ mismatch: true });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const transcript = await runCandidateQualification(fixture);
  assert.equal(transcript.ok, false);
  assert.deepEqual(transcript.mismatches, ["case:red"]);
  assert.deepEqual(transcript.observations.filter((item) => item.kind === "case").map((item) => item.id), ["case:green", "case:red", "case:indeterminate"]);
});

test("a bin whose main-module guard does not realpath argv[1] is a help mismatch when launched through .bin", async (t) => {
  const fixture = await syntheticPackage({ unresolvedArgvGuard: true });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const transcript = await runCandidateQualification(fixture);
  assert.equal(transcript.ok, false);
  assert.ok(transcript.mismatches.includes("help:synthetic-check"));
  const help = transcript.observations.find((item) => item.id === "help:synthetic-check");
  assert.equal(help.launch, "installed-bin");
  assert.equal(help.observedExitCode, 0);
  assert.equal(help.launchError, false);
});

function withPlatform(value) {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value, configurable: true });
  return () => Object.defineProperty(process, "platform", original);
}

test("win32 has no node_modules/.bin symlink: help and case probes fail closed with a distinct, self-describing mismatch rather than a silent pass", async (t) => {
  const fixture = await syntheticPackage();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  t.after(withPlatform("win32"));
  const transcript = await runCandidateQualification(fixture);
  assert.equal(transcript.ok, false);
  // Distinct from `installed-bin:<bin>` (a real, on-platform install defect):
  // this is a known platform gap, never silently folded into a pass and never
  // reported under the same id as a genuine missing-symlink defect.
  assert.ok(transcript.mismatches.includes("platform-unsupported:synthetic-check"));
  assert.equal(transcript.mismatches.some((item) => item.startsWith("installed-bin:")), false);
  assert.deepEqual(transcript.mismatches.filter((item) => item.startsWith("case:")).sort(), ["case:green", "case:indeterminate", "case:red"]);
  const help = transcript.observations.find((item) => item.id === "help:synthetic-check");
  assert.equal(help.launchError, true);
  assert.equal(help.stderrSha256, sha256(WINDOWS_BIN_LAUNCH_REASON));
  const cases = transcript.observations.filter((item) => item.kind === "case");
  assert.equal(cases.length, 3);
  assert.ok(cases.every((item) => item.launchError === true));
  assert.ok(cases.every((item) => item.stderrSha256 === sha256(WINDOWS_BIN_LAUNCH_REASON)));
});

test("the win32 platform gate is scoped to win32: a genuinely working bin still passes qualification off that platform", async (t) => {
  const fixture = await syntheticPackage();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  assert.notEqual(process.platform, "win32", "this test's own runner must not already be win32 for the assertion below to be meaningful");
  const transcript = await runCandidateQualification(fixture);
  assert.equal(transcript.ok, true);
  assert.equal(transcript.mismatches.some((item) => item.startsWith("platform-unsupported:")), false);
  assert.ok(transcript.observations.filter((item) => item.kind === "help" || item.kind === "case").every((item) => item.launch === "installed-bin"));
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

test("a timed-out Unix process group cannot leave a grandchild that writes after return", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "foundry-process-tree-timeout-"));
  const marker = join(root, "descendant-wrote");
  t.after(() => rm(root, { recursive: true, force: true }));
  const grandchild = `const fs=require('node:fs'); setTimeout(()=>fs.writeFileSync(${JSON.stringify(marker)},'escaped'),4000); setInterval(()=>{},1000);`;
  const parent = `const {spawn}=require('node:child_process'); spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'}); process.stdout.write('grandchild-spawned'); setInterval(()=>{},1000);`;
  // Timeout 2000 covers boot, spawn, and the stdout write; delay 4000 is after that timeout; wait 4500 is after the delay.
  const result = await runProcess(process.execPath, ["-e", parent], { timeout: 2000 });
  assert.equal(result.signal, "SIGKILL");
  assert.equal(result.stdout, "grandchild-spawned");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 4500));
  await assert.rejects(() => readFile(marker), /ENOENT/);
});

test("a normally exiting Unix parent cannot leave a same-group descendant after return", { skip: process.platform === "win32" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "foundry-process-tree-normal-"));
  const marker = join(root, "descendant-wrote");
  t.after(() => rm(root, { recursive: true, force: true }));
  const grandchild = `const fs=require('node:fs'); setTimeout(()=>fs.writeFileSync(${JSON.stringify(marker)},'escaped'),500); setInterval(()=>{},1000);`;
  // stdio: ignore ensures `close` is not merely waiting on an inherited pipe;
  // this exercises normal parent exit rather than timeout/overflow cleanup.
  const parent = `const {spawn}=require('node:child_process'); spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'}); process.exit(0);`;
  const result = await runProcess(process.execPath, ["-e", parent], { timeout: 5_000 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.launchError, false);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 800));
  await assert.rejects(() => readFile(marker), /ENOENT/);
});

test("runner rejects escaping, unexpanded, and unsupported export mappings", async (t) => {
  const escaping = await syntheticPackage({ exports: { ".": "../outside.js" } });
  const emptyWildcard = await syntheticPackage({ exports: { "./missing/*": "./missing/*.js" } });
  const repeatedWildcard = await syntheticPackage({ exports: { "./static/*/*": "./static/*/*.txt" } });
  const unknownCondition = await syntheticPackage({ exports: { ".": { require: "./index.js" } } });
  t.after(() => Promise.all([escaping, emptyWildcard, repeatedWildcard, unknownCondition].map((item) => rm(item.root, { recursive: true, force: true }))));
  await assert.rejects(() => runCandidateQualification(escaping), /invalid export target/);
  await assert.rejects(() => runCandidateQualification(emptyWildcard), /no packaged files/);
  await assert.rejects(() => runCandidateQualification(repeatedWildcard), /at most one wildcard/);
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

test("packed framework contexts are closed against exact declared runtime exports", () => {
  const runtime = ["@example/pkg", "@example/pkg/client", "@example/pkg/proxy", "@example/pkg/server"];
  const manifest = {
    name: "@example/pkg",
    foundryReleaseVerification: { next: {
      clientSubpaths: ["./client"],
      serverSubpaths: ["./server"],
      proxySubpaths: ["./proxy"],
    } },
  };
  assert.deepEqual(packedFrameworkContexts(manifest, runtime), {
    client: ["@example/pkg/client"],
    server: ["@example/pkg/server"],
    proxy: ["@example/pkg/proxy"],
    all: ["@example/pkg/client", "@example/pkg/proxy", "@example/pkg/server"],
  });
  assert.deepEqual(packedFrameworkContexts({ name: "@example/pkg" }, runtime), { client: [], server: [], proxy: [], all: [] });

  const hostile = [
    [{ next: { clientSubpaths: ["./client"] }, stale: {} }, /unsupported or missing context row/],
    [{ next: { clientSubpaths: ["./client"], edgeSubpaths: ["./server"] } }, /unsupported context row/],
    [{ next: { clientSubpaths: [] } }, /nonempty array/],
    [{ next: { clientSubpaths: ["./client", "./client"] } }, /duplicates/],
    [{ next: { clientSubpaths: ["./client"], serverSubpaths: ["./client"] } }, /duplicates/],
    [{ next: { clientSubpaths: ["./missing"] } }, /undeclared runtime export/],
    [{ next: { clientSubpaths: ["./client path"] } }, /exact package-relative subpath/],
    [{ next: { clientSubpaths: ["./client"], serverSubpaths: [] } }, /nonempty array/],
    [{ next: {} }, /declares no framework exports/],
  ];
  for (const [foundryReleaseVerification, expected] of hostile) {
    assert.throws(() => packedFrameworkContexts({ name: "@example/pkg", foundryReleaseVerification }, runtime), expected);
  }
});

test("framework replay normalization equates module and plain Next config labels", () => {
  const plain = "✓ Running next.config took 8ms\n✓ Compiled successfully in 2.5s\n";
  const moduleConfig = "✓ Running next.config.mjs took 17ms\n✓ Compiled successfully in 3.1s\n";
  assert.equal(normalizedStream("/tmp/consumer", plain, "framework"), normalizedStream("/tmp/consumer", moduleConfig, "framework"));
});

test("runtime import arguments distinguish the explicit react-server condition", () => {
  const ordinary = runtimeImportArguments("import", "@example/pkg/web", "/tmp/pkg/web.js", "/tmp/pkg");
  assert.deepEqual(ordinary.slice(0, 2), ["--input-type=module", "--eval"]);
  assert.match(ordinary[2], /import\.meta\.resolve/);
  assert.match(ordinary[2], /\/tmp\/pkg\/web\.js/);
  const reactServer = runtimeImportArguments("react-server", "@example/pkg/web", "/tmp/pkg/web.react-server.js", "/tmp/pkg");
  assert.deepEqual(reactServer.slice(0, 3), ["--conditions=react-server", "--input-type=module", "--eval"]);
  assert.match(reactServer[3], /import\.meta\.resolve/);
  assert.throws(() => runtimeImportArguments("browser", "@example/pkg/web", "/tmp/pkg/web.js", "/tmp/pkg"), /unsupported runtime export condition/);
  assert.throws(() => runtimeImportArguments("react-server", "", "/tmp/pkg/web.js", "/tmp/pkg"), /unsupported runtime export condition/);
});

test("contained executable resolution canonicalizes a root alias and rejects an escaping symlink", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "foundry-contained-bin-"));
  const outside = await mkdtemp(join(tmpdir(), "foundry-contained-outside-"));
  const aliasParent = await mkdtemp(join(tmpdir(), "foundry-contained-alias-"));
  const alias = join(aliasParent, "installed");
  t.after(() => Promise.all([root, outside, aliasParent].map((path) => rm(path, { recursive: true, force: true }))));
  await writeFile(join(root, "cli.js"), "export {};\n");
  await writeFile(join(outside, "escape.js"), "export {};\n");
  await symlink(root, alias, "dir");
  await symlink(join(outside, "escape.js"), join(root, "escape.js"));
  assert.equal(await containedRegularFile(alias, "cli.js"), await realpath(join(root, "cli.js")));
  assert.equal(await containedRegularFile(alias, "escape.js"), null);
});

test("react-server qualification fails when export key order resolves the ordinary target", async (t) => {
  const fixture = await syntheticPackage({ exports: { ".": { import: "./index.js", "react-server": "./react-server.js" } } });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const transcript = await runCandidateQualification(fixture);
  assert.equal(transcript.ok, false);
  assert.ok(transcript.mismatches.includes("import:react-server:@acme/synthetic"));
  assert.equal(transcript.observations.find((item) => item.id === "import:react-server:@acme/synthetic").observedExitCode, 1);
});

test("optional peer runtime exports stay red until an exact compatible peer is installed", async (t) => {
  const absent = await syntheticPackage({ runtimePeer: true });
  const present = await syntheticPackage({ runtimePeer: true, peerInstall: { typescript: "6.0.3" } });
  t.after(() => Promise.all([absent, present].map((item) => rm(item.root, { recursive: true, force: true }))));
  const red = await runCandidateQualification(absent);
  assert.equal(red.ok, false);
  assert.ok(red.mismatches.includes("import:import:@acme/synthetic"));
  const green = await runCandidateQualification(present);
  assert.equal(green.ok, true);
  assert.deepEqual(green.peerInstall, { typescript: "6.0.3" });
  assert.equal(green.observations.find((item) => item.id === "install").expectedExitCode, 0);
});

// A module that must never be evaluated by the qualification runner's plain
// Node import probe: if it is, the probe exits non-zero and the run goes red.
const NEVER_EVALUATED = "throw new Error('evaluated under plain node');\nexport {};\n";
const refusalModule = (message) => `throw new Error(${JSON.stringify(message)});\nexport {};\n`;
const importIds = (transcript) => transcript.observations.filter((item) => item.kind === "import").map((item) => item.id).sort();

test("development and browser targets are verified packaged files but never Node-imported; the entry's default target is the import", async (t) => {
  const fixture = await syntheticPackage({
    exports: {
      ".": { types: "./index.d.ts", import: "./index.js" },
      "./copy": { types: "./index.d.ts", browser: "./browser-only.js", default: "./server.js" },
      "./dev": { types: "./index.d.ts", development: "./dev-only.js", default: "./index.js" },
    },
    extraFiles: { "browser-only.js": NEVER_EVALUATED, "dev-only.js": NEVER_EVALUATED, "server.js": "export const server = true;\n" },
  });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const transcript = await runCandidateQualification({ ...fixture, refusals: {} });
  assert.deepEqual(transcript.mismatches, []);
  assert.equal(transcript.ok, true);
  assert.deepEqual(importIds(transcript), ["import:default:@acme/synthetic/copy", "import:default:@acme/synthetic/dev", "import:import:@acme/synthetic"]);
  assert.deepEqual({ ...transcript.coverage, installedManifestSha256: null }, {
    declaredExportKeys: 3,
    concreteTargets: 8,
    runtimeImports: 3,
    reactServerImports: 0,
    staticTargets: 5,
    frameworkExports: 0,
    frameworkBuilds: 0,
    failed: 0,
    installedManifestSha256: null,
    bins: 1,
    lifecycleScriptsDisabled: true,
  });
});

test("a missing development or browser target fails export coverage rather than being skipped", async (t) => {
  const browser = await syntheticPackage({ exports: { ".": { browser: "./missing-browser.js", default: "./index.js" } } });
  const development = await syntheticPackage({ exports: { ".": { development: "./missing-development.js", default: "./index.js" } } });
  t.after(() => Promise.all([browser, development].map((item) => rm(item.root, { recursive: true, force: true }))));
  for (const fixture of [browser, development]) {
    const transcript = await runCandidateQualification({ ...fixture, refusals: {} });
    assert.equal(transcript.ok, false);
    assert.ok(transcript.mismatches.includes("export-coverage"));
    assert.equal(transcript.coverage.failed, 1);
    assert.deepEqual(importIds(transcript), ["import:default:@acme/synthetic"]);
  }
});

test("declared by-design refusal targets are probed to throw their declared refusal instead of being imported as runtime evidence", async (t) => {
  const messages = {
    previewDefault: "The preview subpath resolves only under the development condition; this build did not set it.",
    previewReactServer: "The preview subpath is client-only and refuses the react-server condition.",
    consentReactServer: "The consent subpath is client-only and refuses the react-server condition.",
    copyBrowser: "The copy subpath is server-only and refuses the browser condition.",
  };
  const fixture = await syntheticPackage({
    exports: {
      ".": { types: "./index.d.ts", import: "./index.js" },
      "./preview": { types: "./index.d.ts", "react-server": "./preview-refuse-react-server.js", development: "./index.js", default: "./preview-refuse-default.js" },
      "./consent": { types: "./index.d.ts", "react-server": "./consent-refuse-react-server.js", default: "./index.js" },
      "./copy": { types: "./index.d.ts", browser: "./copy-refuse-browser.js", default: "./index.js" },
    },
    extraFiles: {
      "preview-refuse-default.js": refusalModule(messages.previewDefault),
      "preview-refuse-react-server.js": refusalModule(messages.previewReactServer),
      "consent-refuse-react-server.js": refusalModule(messages.consentReactServer),
      "copy-refuse-browser.js": refusalModule(messages.copyBrowser),
    },
  });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const refusals = { "@acme/synthetic": {
    "@acme/synthetic/preview": { default: "resolves only under the development condition", "react-server": "is client-only and refuses the react-server condition" },
    "@acme/synthetic/consent": { "react-server": "is client-only and refuses the react-server condition" },
    "@acme/synthetic/copy": { browser: "is server-only and refuses the browser condition" },
  } };
  const transcript = await runCandidateQualification({ ...fixture, refusals });
  assert.deepEqual(transcript.mismatches, []);
  assert.equal(transcript.ok, true);
  // Every import observation is a successful ordinary import; a refusal is
  // never recorded as runtime import evidence, and no react-server import
  // remains to pair with an ordinary one.
  assert.deepEqual(importIds(transcript), ["import:default:@acme/synthetic/consent", "import:default:@acme/synthetic/copy", "import:import:@acme/synthetic"]);
  assert.equal(transcript.coverage.runtimeImports, 3);
  assert.equal(transcript.coverage.reactServerImports, 0);
  assert.equal(transcript.coverage.staticTargets, 9);
  assert.equal(transcript.coverage.concreteTargets, 12);
  assert.equal(transcript.coverage.failed, 0);
});

test("a declared refusal that imports or throws another error is red, and an undeclared refusing target still fails its import", async (t) => {
  const marker = "is client-only and refuses the react-server condition";
  const exports = { ".": { types: "./index.d.ts", "react-server": "./refuse.js", default: "./index.js" } };
  const stale = await syntheticPackage({ exports: { ".": { types: "./index.d.ts", "react-server": "./react-server.js", default: "./index.js" } } });
  const different = await syntheticPackage({ exports, extraFiles: { "refuse.js": refusalModule("something else broke") } });
  const undeclared = await syntheticPackage({ exports, extraFiles: { "refuse.js": refusalModule(`The root ${marker}.`) } });
  t.after(() => Promise.all([stale, different, undeclared].map((item) => rm(item.root, { recursive: true, force: true }))));
  const declared = { "@acme/synthetic": { "@acme/synthetic": { "react-server": marker } } };
  for (const fixture of [stale, different]) {
    const transcript = await runCandidateQualification({ ...fixture, refusals: declared });
    assert.equal(transcript.ok, false);
    assert.ok(transcript.mismatches.includes("refusal:react-server:@acme/synthetic"));
    assert.ok(transcript.mismatches.includes("export-coverage"));
    assert.equal(transcript.coverage.failed, 1);
  }
  const red = await runCandidateQualification({ ...undeclared, refusals: {} });
  assert.equal(red.ok, false);
  assert.ok(red.mismatches.includes("import:react-server:@acme/synthetic"));
});

// The refusal probe runs under the refusal's own condition for every
// condition a refusal can be declared under, not only react-server. A
// declared `default` refusal is the target a plain Node consumer resolves and
// a declared `browser` refusal is never Node-imported otherwise, so a probe
// skipped for either would let a target that imports normally or is broken
// for another reason qualify on file presence alone.
const CONDITION_REFUSALS = {
  default: {
    exports: { ".": { types: "./index.d.ts", development: "./index.js", default: "./refuse.js" } },
    marker: "resolves only under the development condition",
    imports: [],
  },
  browser: {
    exports: { ".": { types: "./index.d.ts", browser: "./refuse.js", default: "./index.js" } },
    marker: "is server-only and refuses the browser condition",
    imports: ["import:default:@acme/synthetic"],
  },
};

test("a declared default or browser refusal that imports or throws another error is red, and a correct one qualifies", async (t) => {
  for (const [condition, { exports, marker, imports }] of Object.entries(CONDITION_REFUSALS)) {
    const [stale, different, correct] = await Promise.all([
      "export const synthetic = 'imports normally';\n",
      refusalModule("something else broke"),
      refusalModule(`The root ${marker}.`),
    ].map((body) => syntheticPackage({ exports, extraFiles: { "refuse.js": body } })));
    t.after(() => Promise.all([stale, different, correct].map((item) => rm(item.root, { recursive: true, force: true }))));
    const refusals = { "@acme/synthetic": { "@acme/synthetic": { [condition]: marker } } };
    for (const [label, fixture] of [["stale", stale], ["different", different]]) {
      const transcript = await runCandidateQualification({ ...fixture, refusals });
      const where = `${condition} ${label}`;
      assert.equal(transcript.ok, false, where);
      assert.deepEqual(transcript.mismatches.filter((item) => item.startsWith("refusal:")), [`refusal:${condition}:@acme/synthetic`], where);
      assert.ok(transcript.mismatches.includes("export-coverage"), where);
      assert.equal(transcript.coverage.failed, 1, where);
      assert.deepEqual(importIds(transcript), imports, where);
    }
    const green = await runCandidateQualification({ ...correct, refusals });
    assert.deepEqual(green.mismatches, [], `${condition} correct`);
    assert.equal(green.ok, true, `${condition} correct`);
    assert.equal(green.coverage.failed, 0, `${condition} correct`);
    assert.deepEqual(importIds(green), imports, `${condition} correct`);
  }
});

test("a declared refusal that hangs fails coverage at the probe bound, and a slow one that refuses within that bound qualifies", async (t) => {
  const { exports, marker } = CONDITION_REFUSALS.default;
  // The hanging module keeps its process alive (an unsettled top-level await
  // alone would end it with exit 13) so only the probe timeout can end it.
  // The slow module refuses after the import helper's own 5 s default and well
  // within the runner's reviewed probe bound, so it qualifies only while the
  // runner passes that bound to the probe.
  const [hang, slow] = await Promise.all([
    "setInterval(() => {}, 1000);\nawait new Promise(() => {});\nexport {};\n",
    `await new Promise((resolveDelay) => setTimeout(resolveDelay, 6000));\nthrow new Error(${JSON.stringify(`The root ${marker}.`)});\nexport {};\n`,
  ].map((body) => syntheticPackage({ exports, extraFiles: { "refuse.js": body } })));
  t.after(() => Promise.all([hang, slow].map((item) => rm(item.root, { recursive: true, force: true }))));
  const refusals = { "@acme/synthetic": { "@acme/synthetic": { default: marker } } };
  const started = Date.now();
  const [red, green] = await Promise.all([hang, slow].map((fixture) => runCandidateQualification({ ...fixture, refusals })));
  const elapsed = Date.now() - started;
  assert.equal(red.ok, false, "hanging refusal");
  assert.deepEqual(red.mismatches.filter((item) => item.startsWith("refusal:")), ["refusal:default:@acme/synthetic"], "hanging refusal");
  assert.ok(red.mismatches.includes("export-coverage"), "hanging refusal");
  assert.equal(red.coverage.failed, 1, "hanging refusal");
  assert.deepEqual(green.mismatches, [], "slow refusal within the probe bound");
  assert.equal(green.ok, true, "slow refusal within the probe bound");
  assert.ok(elapsed >= QUALIFICATION_PHASE_TIMEOUTS.probe, "the hanging refusal is ended by the probe bound, not sooner");
});

// A refusal covers exactly one package, one specifier and one condition. Each
// near-miss declaration below names a marker the refusing module really
// throws, so only an exact-key lookup keeps the undeclared target an ordinary
// runtime import that fails; any looser match would turn it into a passing
// refusal probe and let a broken target qualify.
const SHARED_MARKER = "refuses this condition by design";
const sharedRefusal = (where) => refusalModule(`The ${where} ${SHARED_MARKER}.`);
async function assertUndeclaredRefusalsFail(fixture, refusals, failingImports) {
  const transcript = await runCandidateQualification({ ...fixture, refusals });
  const label = JSON.stringify(refusals);
  assert.equal(transcript.ok, false, label);
  for (const id of failingImports) {
    assert.ok(importIds(transcript).includes(id), `${label} must import ${id} as runtime evidence`);
    assert.ok(transcript.mismatches.includes(id), `${label} must report the failed ${id}`);
  }
  assert.ok(transcript.mismatches.includes("export-coverage"), label);
  assert.equal(transcript.coverage.failed, failingImports.length, label);
  assert.deepEqual(transcript.mismatches.filter((item) => item.startsWith("refusal:")), [], label);
}

test("a refusal declared under another package name does not cover the candidate's undeclared refusing target", async (t) => {
  const fixture = await syntheticPackage({
    exports: { ".": { types: "./index.d.ts", "react-server": "./refuse.js", default: "./index.js" } },
    extraFiles: { "refuse.js": sharedRefusal("root") },
  });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const entry = { "@acme/synthetic": { "react-server": SHARED_MARKER } };
  for (const packageName of ["@acme/other", "@acme/synthetic-extra", "@acme/synth", "@acme/SYNTHETIC"]) {
    await assertUndeclaredRefusalsFail(fixture, { [packageName]: entry }, ["import:react-server:@acme/synthetic"]);
  }
});

test("a refusal declared for another specifier, including a prefix either way, does not cover an undeclared refusing target", async (t) => {
  const fixture = await syntheticPackage({
    exports: {
      ".": { types: "./index.d.ts", "react-server": "./root-refuse.js", default: "./index.js" },
      "./sub": { types: "./index.d.ts", "react-server": "./sub-refuse.js", default: "./index.js" },
    },
    extraFiles: { "root-refuse.js": sharedRefusal("root"), "sub-refuse.js": sharedRefusal("sub subpath") },
  });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const only = (...specifiers) => ({ "@acme/synthetic": Object.fromEntries(specifiers.map((specifier) => [specifier, { "react-server": SHARED_MARKER }])) });
  // Declared pkg/sub (honored) against the undeclared target of pkg.
  await assertUndeclaredRefusalsFail(fixture, only("@acme/synthetic/sub"), ["import:react-server:@acme/synthetic"]);
  // Declared pkg (honored) against the undeclared target of pkg/sub.
  await assertUndeclaredRefusalsFail(fixture, only("@acme/synthetic"), ["import:react-server:@acme/synthetic/sub"]);
  // Siblings, a trailing separator and a case variant cover neither target.
  for (const specifier of ["@acme/synthetic/other", "@acme/synthetic/", "@acme/synthetic/SUB"]) {
    await assertUndeclaredRefusalsFail(fixture, only(specifier), ["import:react-server:@acme/synthetic", "import:react-server:@acme/synthetic/sub"]);
  }
});

test("a refusal declared for another condition does not cover an undeclared refusing target under its own condition", async (t) => {
  // A browser target is never imported, so the direction opposite to
  // "declared browser, refusing react-server" uses the plain default import.
  const fixture = await syntheticPackage({
    exports: { ".": { types: "./index.d.ts", "react-server": "./refuse-react-server.js", browser: "./refuse-browser.js", default: "./refuse-default.js" } },
    extraFiles: {
      "refuse-react-server.js": sharedRefusal("root under react-server"),
      "refuse-browser.js": sharedRefusal("root under browser"),
      "refuse-default.js": sharedRefusal("root by default"),
    },
  });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const only = (condition) => ({ "@acme/synthetic": { "@acme/synthetic": { [condition]: SHARED_MARKER } } });
  // Declared browser (honored) against undeclared react-server and default targets.
  await assertUndeclaredRefusalsFail(fixture, only("browser"), ["import:react-server:@acme/synthetic", "import:default:@acme/synthetic"]);
  // Declared react-server (honored) against the undeclared default target.
  await assertUndeclaredRefusalsFail(fixture, only("react-server"), ["import:default:@acme/synthetic"]);
  // Declared default (honored) against the undeclared react-server target.
  await assertUndeclaredRefusalsFail(fixture, only("default"), ["import:react-server:@acme/synthetic"]);
});

test("a refusal declared for a specifier a wildcard export expands to is not honored", async (t) => {
  // Refusals cover exact, non-wildcard exports only; a wildcard-expanded
  // target stays an ordinary runtime import even when its concrete specifier
  // is named and the module throws the named marker.
  const fixture = await syntheticPackage({
    exports: { ".": { types: "./index.d.ts", import: "./index.js" }, "./refuse-*": { default: "./refuse-*.js" } },
    extraFiles: { "refuse-one.js": sharedRefusal("expanded subpath") },
  });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await assertUndeclaredRefusalsFail(
    fixture,
    { "@acme/synthetic": { "@acme/synthetic/refuse-one": { default: SHARED_MARKER } } },
    ["import:default:@acme/synthetic/refuse-one"],
  );
});

test("an empty or whitespace-only refusal marker declares no refusal", async (t) => {
  // Every message contains the empty string and this one contains a space, so
  // honoring either blank marker would turn the broken target into a passing
  // refusal probe.
  const fixture = await syntheticPackage({
    exports: { ".": { types: "./index.d.ts", "react-server": "./refuse.js", default: "./index.js" } },
    extraFiles: { "refuse.js": refusalModule("The root is broken in some other way.") },
  });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  for (const marker of ["", " "]) {
    await assertUndeclaredRefusalsFail(fixture, { "@acme/synthetic": { "@acme/synthetic": { "react-server": marker } } }, ["import:react-server:@acme/synthetic"]);
  }
});

// Several declared refusals in one candidate, across three specifiers and
// three conditions, the way Publisher declares four. Exports and conditions
// are visited in sorted order, so the refusals are probed in exactly this
// order: copy/browser, consent/react-server, preview/default,
// preview/react-server. Breaking each position alone shows that every
// declared refusal is probed, not only the first or the last one, and that a
// failing probe does not stop the targets after it from being checked.
const MULTI_REFUSALS = [
  { specifier: "@acme/synthetic/copy", condition: "browser", file: "copy-refuse-browser.js", marker: "is server-only and refuses the browser condition" },
  { specifier: "@acme/synthetic/web/consent", condition: "react-server", file: "consent-refuse-react-server.js", marker: "the consent subpath is client-only and refuses the react-server condition" },
  { specifier: "@acme/synthetic/web/consent/preview", condition: "default", file: "preview-refuse-default.js", marker: "resolves only under the development condition" },
  { specifier: "@acme/synthetic/web/consent/preview", condition: "react-server", file: "preview-refuse-react-server.js", marker: "the preview subpath is client-only and refuses the react-server condition" },
];
const MULTI_REFUSAL_EXPORTS = {
  ".": { types: "./index.d.ts", import: "./index.js" },
  "./copy": { types: "./index.d.ts", browser: "./copy-refuse-browser.js", default: "./index.js" },
  "./web/consent": { types: "./index.d.ts", "react-server": "./consent-refuse-react-server.js", default: "./index.js" },
  "./web/consent/preview": { types: "./index.d.ts", "react-server": "./preview-refuse-react-server.js", development: "./index.js", default: "./preview-refuse-default.js" },
};
const MULTI_REFUSAL_IMPORTS = ["import:default:@acme/synthetic/copy", "import:default:@acme/synthetic/web/consent", "import:import:@acme/synthetic"];
const multiRefusalTable = () => {
  const table = {};
  for (const { specifier, condition, marker } of MULTI_REFUSALS) (table[specifier] ??= {})[condition] = marker;
  return { "@acme/synthetic": table };
};
// `broken` maps a refusal's index to the body that replaces its module.
const multiRefusalPackage = (broken = {}) => syntheticPackage({
  exports: MULTI_REFUSAL_EXPORTS,
  extraFiles: Object.fromEntries(MULTI_REFUSALS.map(({ file, marker }, index) => [file, broken[index] ?? refusalModule(`The module ${marker}.`)])),
});
const IMPORTS_NORMALLY = "export const synthetic = 'imports normally';\n";

test("every one of several declared refusals is probed: a broken first, middle or last refusal is red on its own", async (t) => {
  const cases = [
    { label: "all correct", broken: {} },
    { label: "first imports normally", broken: { 0: IMPORTS_NORMALLY } },
    { label: "second throws another error", broken: { 1: refusalModule("something else broke") } },
    { label: "third imports normally", broken: { 2: IMPORTS_NORMALLY } },
    { label: "last throws another error", broken: { 3: refusalModule("something else broke") } },
    { label: "first and last broken", broken: { 0: refusalModule("something else broke"), 3: IMPORTS_NORMALLY } },
  ];
  const fixtures = await Promise.all(cases.map(({ broken }) => multiRefusalPackage(broken)));
  t.after(() => Promise.all(fixtures.map((item) => rm(item.root, { recursive: true, force: true }))));
  const refusals = multiRefusalTable();
  for (const [index, { label, broken }] of cases.entries()) {
    const transcript = await runCandidateQualification({ ...fixtures[index], refusals });
    const expected = Object.keys(broken).map(Number).sort((left, right) => left - right).map((position) => `refusal:${MULTI_REFUSALS[position].condition}:${MULTI_REFUSALS[position].specifier}`);
    assert.deepEqual(transcript.mismatches.filter((item) => item.startsWith("refusal:")), expected, label);
    assert.equal(transcript.coverage.failed, expected.length, label);
    assert.equal(transcript.ok, expected.length === 0, label);
    assert.equal(transcript.mismatches.includes("export-coverage"), expected.length !== 0, label);
    // Only the refusal mismatches and export coverage: every ordinary target
    // around the broken refusal, before and after it, is still imported.
    assert.deepEqual(transcript.mismatches.filter((item) => !item.startsWith("refusal:") && item !== "export-coverage"), [], label);
    assert.deepEqual(importIds(transcript), MULTI_REFUSAL_IMPORTS, label);
    assert.equal(transcript.coverage.staticTargets, 9, label);
    assert.equal(transcript.coverage.runtimeImports, 3, label);
  }
});

// The real CLI (scripts/run-candidate-qualification.mjs) passes no
// `refusals`, so the runner's default is the only way BY_DESIGN_REFUSALS
// reaches a qualification. This candidate carries the table's own package
// name, specifiers, conditions and markers, read from the table itself; each
// refusal module throws its declared marker exactly.
const TABLE_PACKAGE = "@clossys/publisher";
const TABLE_REFUSALS = Object.entries(BY_DESIGN_REFUSALS[TABLE_PACKAGE]).flatMap(([specifier, conditions]) => (
  Object.entries(conditions).map(([condition, marker]) => ({ specifier, condition, marker, file: `${specifier.slice(TABLE_PACKAGE.length + 1).replaceAll("/", "-")}-refuse-${condition}.js` }))
));
function tableRefusalPackage(broken = {}) {
  const exports = { ".": { types: "./index.d.ts", import: "./index.js" } };
  for (const { specifier, condition, file } of TABLE_REFUSALS) {
    const key = `./${specifier.slice(TABLE_PACKAGE.length + 1)}`;
    exports[key] ??= { types: "./index.d.ts" };
    exports[key][condition] = `./${file}`;
  }
  // Each entry still has an ordinary target where it does not refuse: its
  // default, or its development target when the default itself refuses.
  // Node resolves conditions in key order, so `default` goes last, as in the
  // real package; ahead of a refusing `react-server` it would be what the
  // react-server probe resolves.
  const ORDER = ["types", "import", "react-server", "browser", "development", "default"];
  for (const [key, entry] of Object.entries(exports)) {
    if (!Object.hasOwn(entry, "import") && !Object.hasOwn(entry, "default")) entry.default = "./index.js";
    else if (!Object.hasOwn(entry, "import") && entry.default !== "./index.js") entry.development = "./index.js";
    exports[key] = Object.fromEntries(ORDER.filter((condition) => Object.hasOwn(entry, condition)).map((condition) => [condition, entry[condition]]));
  }
  return syntheticPackage({
    name: TABLE_PACKAGE,
    exports,
    extraFiles: Object.fromEntries(TABLE_REFUSALS.map(({ file, marker }, index) => [file, broken[index] ?? refusalModule(`${marker}.`)])),
  });
}

test("with no refusals option the runner honours the default BY_DESIGN_REFUSALS table", async (t) => {
  // The table this test reads must still declare refusals for the package,
  // across more than one condition, for the default to be exercised at all.
  assert.ok(TABLE_REFUSALS.length >= 2, "BY_DESIGN_REFUSALS declares the refusals this test relies on");
  assert.ok(new Set(TABLE_REFUSALS.map((item) => item.condition)).size >= 2, "BY_DESIGN_REFUSALS declares refusals under more than one condition");
  const browserIndex = TABLE_REFUSALS.findIndex((item) => item.condition === "browser");
  assert.notEqual(browserIndex, -1, "BY_DESIGN_REFUSALS declares a browser refusal");
  const [correct, brokenBrowser] = await Promise.all([tableRefusalPackage(), tableRefusalPackage({ [browserIndex]: IMPORTS_NORMALLY })]);
  t.after(() => Promise.all([correct, brokenBrowser].map((item) => rm(item.root, { recursive: true, force: true }))));
  // Neither fixture carries a refusals option; each run below that omits one
  // reaches the runner's default.
  assert.ok([correct, brokenBrowser].every((fixture) => !Object.hasOwn(fixture, "refusals")));

  // Default table: every declared refusal is probed, none is imported, and
  // the candidate qualifies.
  const green = await runCandidateQualification(correct);
  assert.deepEqual(green.mismatches, []);
  assert.equal(green.ok, true);
  assert.equal(green.coverage.failed, 0);
  assert.equal(green.coverage.reactServerImports, 0);
  assert.ok(importIds(green).every((id) => !TABLE_REFUSALS.some(({ specifier, condition }) => id === `import:${condition}:${specifier}`)));

  // The same candidate with an explicitly empty table is red: the refusing
  // react-server and default targets become failed runtime imports.
  const red = await runCandidateQualification({ ...correct, refusals: {} });
  assert.equal(red.ok, false);
  for (const { specifier, condition } of TABLE_REFUSALS.filter((item) => item.condition !== "browser")) {
    assert.ok(red.mismatches.includes(`import:${condition}:${specifier}`), `${condition} ${specifier} is a failed import without the table`);
  }

  // And the default table drives the probe itself, not only the exclusion:
  // a declared browser refusal that imports normally is red with no
  // refusals option, although a browser target is otherwise never imported.
  const broken = await runCandidateQualification(brokenBrowser);
  assert.equal(broken.ok, false);
  assert.deepEqual(broken.mismatches.filter((item) => item.startsWith("refusal:")), [`refusal:browser:${TABLE_REFUSALS[browserIndex].specifier}`]);
  assert.equal(broken.coverage.failed, 1);
});

test("a development or browser target that is a directory fails coverage, and one that escapes the package is refused", async (t) => {
  // A missing development or browser file is covered above. A target that
  // exists but is not a regular file (the packaged `static` directory) is
  // no more acceptable, and an escaping target is refused outright.
  const shapes = ["development", "browser"].map((condition) => ({
    condition,
    directory: { ".": { [condition]: "./static", default: "./index.js" } },
    escaping: { ".": { [condition]: "../outside.js", default: "./index.js" } },
  }));
  const fixtures = await Promise.all(shapes.flatMap(({ directory, escaping }) => [directory, escaping].map((exports) => syntheticPackage({ exports }))));
  t.after(() => Promise.all(fixtures.map((item) => rm(item.root, { recursive: true, force: true }))));
  for (const [index, { condition }] of shapes.entries()) {
    const [directory, escaping] = fixtures.slice(index * 2, index * 2 + 2);
    const transcript = await runCandidateQualification({ ...directory, refusals: {} });
    assert.equal(transcript.ok, false, `${condition} directory`);
    assert.deepEqual(transcript.mismatches, ["export-coverage"], `${condition} directory`);
    assert.equal(transcript.coverage.failed, 1, `${condition} directory`);
    assert.deepEqual(importIds(transcript), ["import:default:@acme/synthetic"], `${condition} directory`);
    await assert.rejects(() => runCandidateQualification({ ...escaping, refusals: {} }), /invalid export target/, `${condition} escaping`);
  }
});

test("conditions outside the closed set still refuse, as does an entry with no ordinary import or default target", async (t) => {
  const shapes = [
    { ".": { worker: "./index.js", default: "./index.js" } },
    { ".": { custom: "./index.js", import: "./index.js" } },
    { ".": { node: "./index.js", default: "./index.js" } },
    { ".": { types: "./index.d.ts", development: "./index.js", browser: "./index.js" } },
  ];
  const fixtures = await Promise.all(shapes.map((exports) => syntheticPackage({ exports })));
  t.after(() => Promise.all(fixtures.map((item) => rm(item.root, { recursive: true, force: true }))));
  for (const fixture of fixtures) await assert.rejects(() => runCandidateQualification({ ...fixture, refusals: {} }), /unsupported export conditions/);
});


test("candidateNotInstalledMessage carries npm's own failure forward instead of a bare refusal (issue #791)", () => {
  // publisher@0.4.1 failed qualification on 2026-09-02 with only "candidate
  // package was not installed from the supplied tarball" — the actual cause
  // (an unresolvable @clossys/designer@^0.4.0, since the registry only had
  // 0.2.7 at the time) had to be reconstructed from workflow logs and
  // historical registry state. No install: an aggregate child never gets
  // its own failure surfaced this way.
  assert.equal(candidateNotInstalledMessage(null), "candidate package was not installed from the supplied tarball");
  // A clean install exit with the manifest still unreadable (e.g. a
  // corrupt tarball) must not fabricate an npm failure that never happened.
  assert.equal(
    candidateNotInstalledMessage({ exitCode: 0, signal: null, launchError: false, stderr: "" }),
    "candidate package was not installed from the supplied tarball",
  );
  // The exact defect: an unresolvable dependency exits non-zero and npm's
  // own stderr names it. That sentence must survive into the thrown error.
  assert.equal(
    candidateNotInstalledMessage({ exitCode: 1, signal: null, launchError: false, stderr: "npm error ETARGET\nnpm error No matching version found for @clossys/designer@^0.4.0\n" }),
    'candidate package was not installed from the supplied tarball (npm install exited 1: npm error ETARGET\nnpm error No matching version found for @clossys/designer@^0.4.0)',
  );
  assert.equal(
    candidateNotInstalledMessage({ exitCode: null, signal: "SIGKILL", launchError: false, stderr: "" }),
    "candidate package was not installed from the supplied tarball (npm install was terminated by SIGKILL)",
  );
  assert.equal(
    candidateNotInstalledMessage({ exitCode: null, signal: null, launchError: true, stderr: "spawn ENOENT" }),
    "candidate package was not installed from the supplied tarball (npm install could not be launched: spawn ENOENT)",
  );
  // A very long stderr must not leak unboundedly into the thrown error.
  const long = "x".repeat(5000);
  const message = candidateNotInstalledMessage({ exitCode: 1, signal: null, launchError: false, stderr: long });
  assert.ok(message.length < long.length, "stderr tail must be bounded");
  assert.ok(message.endsWith("x".repeat(50) + ")"));
});

test("candidateNotInstalledMessage names a TLS-intercepting proxy as the likely cause of a certificate-chain install failure (issue #833)", () => {
  // sanitizedEnv() deliberately never forwards a CA-trust variable to the
  // install child. In a sandbox that transparently intercepts outbound TLS,
  // npm's registry fetch fails with exactly this class of error — real npm
  // stderr text, reproduced verbatim from issue #833's own measurement.
  const proxyStderr = [
    "npm http fetch GET https://registry.npmjs.org/typescript attempt 1 failed with SELF_SIGNED_CERT_IN_CHAIN",
    "npm http fetch GET https://registry.npmjs.org/typescript attempt 2 failed with SELF_SIGNED_CERT_IN_CHAIN",
    "npm http fetch GET https://registry.npmjs.org/typescript attempt 3 failed with SELF_SIGNED_CERT_IN_CHAIN",
  ].join("\n");
  const message = candidateNotInstalledMessage({ exitCode: 1, signal: null, launchError: false, stderr: proxyStderr });
  assert.ok(message.includes("SELF_SIGNED_CERT_IN_CHAIN"), "npm's own stderr must still survive into the message");
  assert.ok(
    message.includes("TLS-intercepting proxy"),
    "a certificate-chain failure must be named as a likely TLS-intercepting-proxy cause, not left as a bare npm exit code",
  );
  // Other known cert-chain codes get the same hint; an unrelated failure does not.
  for (const code of ["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED"]) {
    assert.ok(
      candidateNotInstalledMessage({ exitCode: 1, signal: null, launchError: false, stderr: `npm http fetch failed with ${code}` }).includes("TLS-intercepting proxy"),
      `${code} must be recognized as a certificate-chain failure`,
    );
  }
  assert.ok(
    !candidateNotInstalledMessage({ exitCode: 1, signal: null, launchError: false, stderr: "npm error ETARGET\nnpm error No matching version found for @clossys/designer@^0.4.0\n" }).includes("TLS-intercepting proxy"),
    "an unrelated npm failure (ETARGET) must not be mislabeled as a certificate-chain problem",
  );
});
