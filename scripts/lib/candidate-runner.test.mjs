import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { QUALIFICATION_PHASE_TIMEOUTS, assertCredentialFree, containedRegularFile, installNpmrc, packedFrameworkContexts, runCandidateQualification, runProcess, runtimeImportArguments, validateNpmBinMap, wildcardCapture } from "./candidate-runner.mjs";
import { RELEASE_RUNTIME } from "./release-runtime.mjs";

const execFile = promisify(execFileCallback);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const releaseRuntimeRun = (file, args) => {
  if (args[0] === "--version") return { status: 0, stdout: file === process.execPath ? `${RELEASE_RUNTIME.node}\n` : `${RELEASE_RUNTIME.npm}\n`, stderr: "" };
  if (args[0] === "-p") return { status: 0, stdout: `${RELEASE_RUNTIME.zlib}\n`, stderr: "" };
  throw new Error(`unexpected release runtime probe ${file} ${args.join(" ")}`);
};
async function syntheticPackage({ mismatch = false, exports = undefined, runtimePeer = false, peerInstall = undefined, rawStarter = false, mutateCaseEvidence = null, binPath = "cli.js" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "foundry-runner-test-"));
  const source = join(root, "source");
  const fixturesDir = join(root, "fixtures");
  const packed = join(root, "packed");
  await mkdir(source);
  await mkdir(fixturesDir);
  await mkdir(packed);
  const packageName = rawStarter ? "@clossys/starter" : "@acme/synthetic";
  await writeFile(join(source, "package.json"), JSON.stringify({
    name: packageName,
    version: "1.0.0",
    type: "module",
    exports: exports ?? { ".": { types: "./index.d.ts", import: "./index.js" }, "./asset": "./asset.txt", "./static/*": "./static/*.txt" },
    files: ["index.js", "react-server.js", "index.d.ts", "cli.js", "asset.txt", "static"],
    bin: { "synthetic-check": binPath },
    scripts: { preinstall: "node -e \"require('fs').writeFileSync('preinstall-marker','ran')\"" },
    ...(runtimePeer ? { peerDependencies: { typescript: "~6.0.0" }, peerDependenciesMeta: { typescript: { optional: true } } } : {}),
  }, null, 2));
  await writeFile(join(source, "index.js"), `${runtimePeer ? "import 'typescript';\n" : ""}export const synthetic = true;\n`);
  await writeFile(join(source, "react-server.js"), "export const synthetic = 'react-server';\n");
  await writeFile(join(source, "index.d.ts"), "export declare const synthetic: boolean;\n");
  await writeFile(join(source, "asset.txt"), "static asset\n");
  await mkdir(join(source, "static"));
  await writeFile(join(source, "static", "one.txt"), "one\n");
  await writeFile(join(source, "static", "two.txt"), "two\n");
  await writeFile(join(source, "cli.js"), [
    "import { readFileSync, writeFileSync } from 'node:fs';",
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
    packageKey: rawStarter ? "starter" : "synthetic", recordStem: rawStarter ? "clossys-starter" : "acme-synthetic", packageDir: rawStarter ? "packages/starter" : "packages/synthetic", adapterPath: `governance/release-qualification-adapters/${rawStarter ? "starter" : "synthetic"}/current-direct.json`, fixturePath: `governance/release-qualification-fixtures/${rawStarter ? "starter" : "synthetic"}/current-direct`, archetypes: {
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
    bins: { "synthetic-check": 0 },
    fixtures: fixtureNames,
    cases: [
      { id: "green", bin: "synthetic-check", fixtureArgs: ["green.json"], exitCode: 0, group: "authority" },
      { id: "red", bin: "synthetic-check", fixtureArgs: ["red.json"], exitCode: 1, group: "authority" },
      { id: "indeterminate", bin: "synthetic-check", fixtureArgs: ["indeterminate.json"], exitCode: 2, group: "authority" },
    ],
    dimensionEvidence: { rollback: "restoration", duplicate: "authority" },
  };
  return { root, source, tarball, policy, adapter, fixtures, manifestBins: { "synthetic-check": "cli.js" }, registry: { scope: rawStarter ? "@clossys" : "@acme", registry: "https://registry.npmjs.org/" }, releaseRuntimeRun };
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
  assert.ok(first.observations.filter((item) => item.kind === "help" || item.kind === "case").every((item) => item.launch === "node-direct"));
  assert.equal(JSON.stringify(first).includes(fixture.root), false);
  const { canonicalSha256, ...canonical } = first;
  assert.equal(canonicalSha256, sha256(JSON.stringify(canonical)));
});

test("candidate qualification rejects bin targets npm would auto-correct", async (t) => {
  const fixture = await syntheticPackage({ binPath: "./cli.js" });
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  assert.deepEqual(validateNpmBinMap({ "synthetic-check": "cli.js" }), []);
  assert.ok(validateNpmBinMap({ "synthetic-check": "./cli.js" }).length > 0);
  assert.ok(validateNpmBinMap({ "synthetic-check": "dist//cli.js" }).length > 0);
  assert.ok(validateNpmBinMap({ "synthetic-check": "dist/.//cli.js" }).length > 0);
  assert.ok(validateNpmBinMap({ "synthetic-check": "dist/foo/../cli.js" }).length > 0);
  await assert.rejects(() => runCandidateQualification(fixture), /invalid npm bin targets/);
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
    assert.deepEqual(raw.argv.slice(0, 2), ["$NODE", "$TEMP/node_modules/@clossys/starter/cli.js"]);
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
  const sibling = await syntheticPackage();
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
  const grandchild = `const fs=require('node:fs'); setTimeout(()=>fs.writeFileSync(${JSON.stringify(marker)},'escaped'),500); setInterval(()=>{},1000);`;
  const parent = `const {spawn}=require('node:child_process'); spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'}); process.stdout.write('grandchild-spawned'); setInterval(()=>{},1000);`;
  const result = await runProcess(process.execPath, ["-e", parent], { timeout: 200 });
  assert.equal(result.signal, "SIGKILL");
  assert.equal(result.stdout, "grandchild-spawned");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 800));
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
