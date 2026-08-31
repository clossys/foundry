import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { consumerDigest } from "./candidate-runner.mjs";
import { ALL_PACKAGE_RELEASE_ORDER, aggregateCanaryGitHistory, aggregateClosurePath, aggregatePlanSha256, assertAggregateRuntime, controllerPhysicalIdentities, immutableRecordHistory, immutableRecordPaths, isAggregateClosurePath, parseAggregateCanaryCli, resolveAggregateClosure, retainAggregateTranscript, runAggregatePublicNpmCanary, sealedHistoricalRepository, validateAggregateCanary, validateAggregateCanaryAppendOnly, validateAggregateCanaryHistory, validateAggregateChildExecution, validateAggregateClosure, validateSatisfiedAggregateTranscript, validateSatisfiedTranscriptHistory } from "./public-npm-aggregate-canary.mjs";

const root = new URL("../..", import.meta.url).pathname;
const record = JSON.parse(readFileSync(new URL("../../governance/public-npm-aggregate-canary.json", import.meta.url), "utf8"));
const read = (path) => readFileSync(`${root}/${path}`, "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sha1 = "1".repeat(40), sha512 = "2".repeat(128), sha = "3".repeat(64);
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
function childRun(entry) {
  const observation = (id, kind, expectedExitCode = 0) => ({ id, kind, launch: kind === "framework" ? "next-build" : "node-direct", expectedExitCode, observedExitCode: expectedExitCode, signal: null, launchError: false, stdoutSha256: sha, stderrSha256: sha });
  const dimensions = ["position", "completion", "rollback", "duplicate", "cadence", "closeWindow"].map((dimension) => dimension === "rollback" ? { dimension, status: "supported", evidence: ["aggregate-rollback-delegated"] } : { dimension, status: "supported", evidence: ["case:0"] });
  const run = { schema: "foundry-aggregate-child-execution-v1", version: 1, candidate: { name: entry.name, version: entry.version }, archetype: "synthetic", tarball: { sha1, sha256: sha, sha512 }, peerInstall: {}, consumer: { manifestSha256: sha, lockfileSha256: sha }, coverage: { declaredExportKeys: 1, concreteTargets: 1, runtimeImports: 1, reactServerImports: 0, staticTargets: 0, frameworkExports: 1, frameworkBuilds: 1, failed: 0, installedManifestSha256: sha, bins: 1, lifecycleScriptsDisabled: true }, observations: [observation("import:default", "import"), observation("framework:next:client:default", "framework"), observation("help:default", "help"), ...[0, 1, 2].map((code) => observation(`case:${code}`, "case", code))], dimensions, restoration: { delegatedToAggregate: true }, mismatches: [], ok: true };
  run.canonicalSha256 = sha256(JSON.stringify(run));
  return run;
}

function git(root, args, input = undefined) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", input }).trim();
}

function commitTree(root, files, parents = [], message = "fixture") {
  const buildTree = (entries, prefix = "") => {
    const groups = new Map();
    for (const [path, value] of Object.entries(entries)) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      const name = slash === -1 ? rest : rest.slice(0, slash);
      const group = groups.get(name) ?? { directory: slash !== -1, values: {} };
      if (slash === -1) group.value = value;
      else group.values[rest.slice(slash + 1)] = value;
      groups.set(name, group);
    }
    const rows = [];
    for (const [name, group] of [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      if (group.directory) rows.push(`040000 tree ${buildTree(group.values, "")}\t${name}`);
      else rows.push(`100644 blob ${git(root, ["hash-object", "-w", "--stdin"], group.value)}\t${name}`);
    }
    return rows.length === 0 ? "4b825dc642cb6eb9a060e54bf8d69288fbee4904" : git(root, ["mktree"], `${rows.join("\n")}\n`);
  };
  const tree = buildTree(files);
  return git(root, ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent])], `${message}\n`);
}

function setHead(root, commit) {
  git(root, ["update-ref", "refs/heads/main", commit]);
  git(root, ["symbolic-ref", "HEAD", "refs/heads/main"]);
}

function satisfiedFixture() {
  const plan = structuredClone(record);
  const selected = plan.sets[0];
  const closure = { schema: "foundry-public-npm-aggregate-closure-v1", version: 1, plan: { path: "governance/public-npm-aggregate-canary.json", sha256: aggregatePlanSha256(plan) }, set: selected.id, packages: selected.packages.map((entry) => ({ name: entry.name, version: entry.version, qualification: { path: `governance/release-qualifications/${entry.packageKey}-${entry.version}.json`, sha256: sha }, publication: { path: `governance/release-publications/later/${entry.packageKey}-${entry.version}.json`, sha256: sha, member: entry.packageKey } })) };
  closure.canonicalSha256 = sha256(JSON.stringify(stable(closure)));
  const resolved = resolveAggregateClosure(plan, selected.id, closure).selected;
  const transcript = {
    schema: "foundry-public-npm-aggregate-transcript-v1", version: 1,
    plan: { path: "governance/public-npm-aggregate-canary.json", setsSha256: aggregatePlanSha256(plan), closurePath: `governance/public-npm-aggregate-closures/baseline-${closure.canonicalSha256}.json`, closureSha256: closure.canonicalSha256 },
    set: selected.id,
    repositoryRedirects: [{ historicalRepository: "clossys/platform", repository: "clossys/foundry", repositoryId: 1325931929, kind: "verified" }],
    peerResolution: { requested: plan.peerResolution.requested, actual: plan.peerResolution.requested, disposition: plan.peerResolution.disposition },
    operations: ["install", "uninstall", "reinstall"].map((id) => ({ id, expectedExitCode: 0, observedExitCode: 0, signal: null, launchError: false, stdoutSha256: sha, stderrSha256: sha })),
    packages: resolved.packages.map((entry) => ({ name: entry.name, version: entry.version, qualification: entry.qualification, publication: entry.publication, served: { name: entry.name, version: entry.version, packageManifestSha256: sha, tarball: { sha1, sha256: sha, sha512 } }, installedManifestSha256: sha, run: childRun(entry) })),
    consumer: { manifestSha256: sha, lockfileSha256: sha, controller: "@clossys/controller@0.8.23", singularController: true, identities: resolved.packages.map((entry) => `${entry.name}@${entry.version}`), rollback: { packageAbsenceProven: true, manifestRestored: true, lockfileRestored: true, identitiesRestored: true } },
    dimensions: [
      ["install", 1], ["exports", resolved.packages.length], ["framework", resolved.packages.length], ["bins", resolved.packages.length], ["cases", resolved.packages.length * 3],
      ["optionalPeers", plan.optionalPeerMatrix.filter((row) => row.set === selected.id).reduce((sum, row) => sum + row.peers.reduce((peerSum, peer) => peerSum + Object.keys(peer.outcomes).length, 0), 0)], ["rollback", 1],
    ].map(([dimension, count]) => ({ dimension, count, ok: true })),
    optionalPeerObservations: plan.optionalPeerMatrix
      .filter((row) => row.set === selected.id)
      .flatMap((row) => row.peers.flatMap((peer) => Object.entries(peer.outcomes).map(([specifier, outcome]) => ({
        package: row.name, version: row.version, peer: peer.peer, specifier, outcome, evaluator: "node-direct",
        restoration: { manifestSha256: sha, lockfileSha256: sha, treeSha256: sha },
      })))),
  };
  transcript.canonicalSha256 = sha256(JSON.stringify(stable(transcript)));
  return { plan, closure, transcript };
}

test("aggregate record closes both frozen 19-package version sets without claiming pending publication", () => {
  assert.deepEqual(validateAggregateCanary(record, { read }), []);
  assert.deepEqual(record.sets.map((set) => set.packages.map((entry) => entry.packageKey)), [ALL_PACKAGE_RELEASE_ORDER, ALL_PACKAGE_RELEASE_ORDER]);
  assert.deepEqual(record.sets.flatMap((set) => set.packages).find((entry) => entry.packageKey === "publisher" && entry.version === "0.1.8"), { packageKey: "publisher", name: "@clossys/publisher", version: "0.1.8" });
});

test("aggregate record fails closed on ordering and non-identity plan rows", () => {
  for (const mutate of [
    (copy) => { [copy.sets[0].packages[0], copy.sets[0].packages[1]] = [copy.sets[0].packages[1], copy.sets[0].packages[0]]; },
    (copy) => { copy.sets[1].packages[0].publication = { path: "fabricated" }; },
  ]) {
    const copy = structuredClone(record);
    mutate(copy);
    assert.ok(validateAggregateCanary(copy, { read }).length > 0);
  }
  const duplicatePeer = structuredClone(record); duplicatePeer.optionalPeerMatrix[1] = structuredClone(duplicatePeer.optionalPeerMatrix[0]);
  assert.ok(validateAggregateCanary(duplicatePeer, { read }).some((item) => item.rule === "optional-peer-duplicate"));
});

test("introduced aggregate plan is immutable", () => {
  const rewritten = structuredClone(record);
  rewritten.sets[0].packages[0].version = "9.9.9";
  assert.ok(validateAggregateCanaryAppendOnly(rewritten, { readHead: () => JSON.stringify(record) }).some((item) => item.rule === "plan-rewrite"));
  const matrixRewrite = structuredClone(record);
  const peerRow = matrixRewrite.optionalPeerMatrix.find((row) => row.peers.length > 0);
  peerRow.peers[0].outcomes = {};
  assert.ok(validateAggregateCanaryAppendOnly(matrixRewrite, { readHead: () => JSON.stringify(record) }).some((item) => item.rule === "plan-rewrite"));
  const introduced = [{ commit: "a".repeat(40), status: "A", sha256: sha }];
  assert.deepEqual(validateAggregateCanaryHistory({ history: introduced }), []);
  for (const history of [
    [{ commit: "b".repeat(40), status: "M", sha256: sha }, ...introduced],
    [{ commit: "b".repeat(40), status: "A", sha256: sha }, { commit: "a".repeat(40), status: "D", sha256: sha }, ...introduced],
    [{ commit: "c".repeat(40), status: "M", sha256: sha }, { commit: "b".repeat(40), status: "A", sha256: sha }, { commit: "a".repeat(40), status: "D", sha256: sha }, ...introduced],
  ]) assert.ok(validateAggregateCanaryHistory({ history }).some((item) => item.rule === "plan-rewrite"));
});

test("git history rejects committed rewrite, recreate, and rename/restore of the aggregate plan", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "foundry-aggregate-plan-history-"));
  const planPath = "governance/public-npm-aggregate-canary.json";
  const commit = (message) => { execFileSync("git", ["add", "-A"], { cwd: temporary }); execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", message], { cwd: temporary }); };
  try {
    execFileSync("git", ["init", "-q"], { cwd: temporary });
    await writeFile(join(temporary, "README"), "fixture\n"); commit("root");
    await mkdir(join(temporary, "governance"), { recursive: true });
    await writeFile(join(temporary, planPath), "one\n"); commit("introduce");
    assert.deepEqual(validateAggregateCanaryHistory({ history: aggregateCanaryGitHistory({ root: temporary }) }), []);
    await writeFile(join(temporary, planPath), "two\n"); commit("rewrite");
    assert.ok(validateAggregateCanaryHistory({ history: aggregateCanaryGitHistory({ root: temporary }) }).some((item) => item.rule === "plan-rewrite"));
    await rm(join(temporary, planPath)); commit("delete");
    await writeFile(join(temporary, planPath), "one\n"); commit("restore");
    assert.ok(validateAggregateCanaryHistory({ history: aggregateCanaryGitHistory({ root: temporary }) }).some((item) => item.rule === "plan-rewrite"));
    await rename(join(temporary, planPath), join(temporary, "governance", "moved.json")); commit("rename-away");
    await rename(join(temporary, "governance", "moved.json"), join(temporary, planPath)); commit("rename-back");
    const history = aggregateCanaryGitHistory({ root: temporary });
    assert.ok(history.some((item) => !["A", "M", "D"].includes(item.status)) || history.length > 1);
    assert.ok(validateAggregateCanaryHistory({ history }).some((item) => item.rule === "plan-rewrite"));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("merge-only plan rewrite is visible against each reachable parent", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "foundry-aggregate-plan-merge-history-"));
  const planPath = "governance/public-npm-aggregate-canary.json";
  const commit = (message, args = []) => { execFileSync("git", ["add", "-A"], { cwd: temporary }); execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", ...args, "-m", message], { cwd: temporary }); };
  try {
    execFileSync("git", ["init", "-q"], { cwd: temporary });
    await mkdir(join(temporary, "governance"), { recursive: true }); await writeFile(join(temporary, planPath), "one\n"); commit("introduce");
    execFileSync("git", ["branch", "other"], { cwd: temporary });
    commit("left unchanged", ["--allow-empty"]); const left = execFileSync("git", ["rev-parse", "HEAD"], { cwd: temporary, encoding: "utf8" }).trim();
    execFileSync("git", ["checkout", "-q", "other"], { cwd: temporary }); commit("right unchanged", ["--allow-empty"]); const right = execFileSync("git", ["rev-parse", "HEAD"], { cwd: temporary, encoding: "utf8" }).trim();
    await writeFile(join(temporary, planPath), "merge-rewrite\n"); execFileSync("git", ["add", planPath], { cwd: temporary });
    const tree = execFileSync("git", ["write-tree"], { cwd: temporary, encoding: "utf8" }).trim();
    const merge = execFileSync("git", ["commit-tree", tree, "-p", left, "-p", right], { cwd: temporary, encoding: "utf8", input: "merge-only rewrite\n" }).trim();
    execFileSync("git", ["update-ref", "HEAD", merge], { cwd: temporary });
    const history = aggregateCanaryGitHistory({ root: temporary });
    assert.ok(history.some((entry) => entry.commit === merge && entry.status === "M"));
    assert.ok(validateAggregateCanaryHistory({ history }).some((entry) => entry.rule === "plan-rewrite"));
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("immutable closure and transcript discovery fails closed on real HEAD-history deletion, rewrite, and rename", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "foundry-aggregate-record-history-"));
  const closureDirectory = "governance/public-npm-aggregate-closures", transcriptDirectory = "governance/public-npm-aggregate-transcripts";
  const digest = "a".repeat(64), closurePath = `${closureDirectory}/baseline-${digest}.json`, transcriptPath = `${transcriptDirectory}/baseline-${digest}.json`;
  const commit = (message) => { execFileSync("git", ["add", "-A"], { cwd: temporary }); execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", message], { cwd: temporary }); };
  try {
    execFileSync("git", ["init", "-q"], { cwd: temporary });
    await mkdir(join(temporary, closureDirectory), { recursive: true }); await mkdir(join(temporary, transcriptDirectory), { recursive: true });
    await writeFile(join(temporary, closurePath), "one\n"); await writeFile(join(temporary, transcriptPath), "one\n"); commit("introduce immutable records");
    for (const [directory, path] of [[closureDirectory, closurePath], [transcriptDirectory, transcriptPath]]) {
      const records = immutableRecordPaths({ root: temporary, directory });
      assert.deepEqual(records.introduced, [path]); assert.deepEqual(records.current, [path]);
      assert.deepEqual(validateSatisfiedTranscriptHistory({ path: path.replace(closureDirectory, transcriptDirectory), history: immutableRecordHistory({ root: temporary, path }) }), []);
    }
    await writeFile(join(temporary, closurePath), "two\n"); await writeFile(join(temporary, transcriptPath), "two\n"); commit("rewrite immutable records");
    for (const path of [closurePath, transcriptPath]) assert.ok(validateSatisfiedTranscriptHistory({ path: path.replace(closureDirectory, transcriptDirectory), history: immutableRecordHistory({ root: temporary, path }) }).some((item) => item.rule === "transcript-rewrite"));
    await rm(join(temporary, closurePath)); await rm(join(temporary, transcriptPath)); commit("delete immutable records");
    for (const [directory, path] of [[closureDirectory, closurePath], [transcriptDirectory, transcriptPath]]) { const records = immutableRecordPaths({ root: temporary, directory }); assert.ok(records.introduced.includes(path)); assert.ok(!records.current.includes(path)); }
    await writeFile(join(temporary, closurePath), "one\n"); await writeFile(join(temporary, transcriptPath), "one\n"); commit("restore immutable records");
    await rename(join(temporary, closurePath), join(temporary, closureDirectory, "moved.json")); await rename(join(temporary, transcriptPath), join(temporary, transcriptDirectory, "moved.json")); commit("rename immutable records");
    for (const [directory, path] of [[closureDirectory, closurePath], [transcriptDirectory, transcriptPath]]) { const records = immutableRecordPaths({ root: temporary, directory }); assert.ok(records.introduced.includes(path)); assert.ok(!records.current.includes(path)); }
    const foreign = join(temporary, "foreign.json"), copiedDigest = "b".repeat(64), copiedClosure = `${closureDirectory}/oidc-successor-${copiedDigest}.json`, copiedTranscript = `${transcriptDirectory}/oidc-successor-${copiedDigest}.json`;
    await writeFile(foreign, "foreign\n"); commit("add foreign record");
    await rename(foreign, join(temporary, copiedClosure)); await writeFile(foreign, "foreign\n"); await rename(foreign, join(temporary, copiedTranscript)); commit("rename records into closed namespaces");
    for (const [directory, path] of [[closureDirectory, copiedClosure], [transcriptDirectory, copiedTranscript]]) { const records = immutableRecordPaths({ root: temporary, directory }); assert.ok(records.current.includes(path)); assert.ok(!records.introduced.includes(path)); }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("DAG history uses actual parents for merged introductions and rewrites", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "foundry-aggregate-merge-history-"));
  const planPath = "governance/public-npm-aggregate-canary.json";
  const recordPath = "governance/public-npm-aggregate-transcripts/baseline-" + "a".repeat(64) + ".json";
    try {
    execFileSync("git", ["init", "-q"], { cwd: temporary });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "config", "commit.gpgsign", "false"], { cwd: temporary });

    const base = commitTree(temporary, { [planPath]: "original\n", README: "base\n" }, [], "base");
    const mainTip = commitTree(temporary, { [planPath]: "original\n", README: "main\n" }, [base], "main side");
    const rewritten = commitTree(temporary, { [planPath]: "rewritten\n", README: "base\n" }, [base], "unreviewed rewrite");
    const merge = commitTree(temporary, { [planPath]: "rewritten\n", README: "main\n" }, [mainTip, rewritten], "merge rewrite");
    setHead(temporary, merge);
    const mergedPlan = aggregateCanaryGitHistory({ root: temporary, path: planPath });
    assert.deepEqual(mergedPlan.map((entry) => entry.status), ["M", "A"]);
    assert.equal(mergedPlan.filter((entry) => entry.commit === merge).length, 0, "merge propagation must not duplicate the branch rewrite");

    const introduced = commitTree(temporary, { [recordPath]: "one\n" }, [merge], "introduce record");
    const changed = commitTree(temporary, { [recordPath]: "two\n" }, [introduced], "rewrite record");
    const deleted = commitTree(temporary, {}, [changed], "delete record");
    const restored = commitTree(temporary, { [recordPath]: "one\n" }, [deleted], "readd record");
    setHead(temporary, restored);
    const recordHistory = immutableRecordHistory({ root: temporary, path: recordPath });
    assert.deepEqual(recordHistory.map((entry) => entry.status), ["A", "D", "M", "A"]);
    const recordPaths = immutableRecordPaths({ root: temporary, directory: "governance/public-npm-aggregate-transcripts" });
    assert.deepEqual(recordPaths.introduced, [recordPath]);
    assert.deepEqual(recordPaths.current, [recordPath]);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("DAG history counts one branch introduction and ignores an unreachable divergent branch", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "foundry-aggregate-branch-history-"));
  const recordPath = "governance/public-npm-aggregate-closures/baseline-" + "b".repeat(64) + ".json";
  try {
    execFileSync("git", ["init", "-q"], { cwd: temporary });
    const base = commitTree(temporary, { README: "base\n" }, [], "base");
    const mainTip = commitTree(temporary, { README: "main\n" }, [base], "main");
    const branchAdd = commitTree(temporary, { README: "base\n", [recordPath]: "closure\n" }, [base], "branch introduction");
    const merged = commitTree(temporary, { README: "main\n", [recordPath]: "closure\n" }, [mainTip, branchAdd], "merge branch introduction");
    setHead(temporary, merged);
    const mergedHistory = immutableRecordHistory({ root: temporary, path: recordPath });
    assert.deepEqual(mergedHistory.map((entry) => entry.status), ["A"]);
    assert.equal(mergedHistory[0].commit, branchAdd);

    const unreachableRewrite = commitTree(temporary, { README: "unreachable\n", [recordPath]: "tampered\n" }, [branchAdd], "unmerged divergent rewrite");
    void unreachableRewrite;
    setHead(temporary, merged);
    const reachable = immutableRecordHistory({ root: temporary, path: recordPath });
    assert.deepEqual(reachable.map((entry) => entry.status), ["A"]);
    assert.deepEqual(immutableRecordPaths({ root: temporary, directory: "governance/public-npm-aggregate-closures" }).introduced, [recordPath]);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("live runner makes no registry request while any frozen member is held or pending", async () => {
  let calls = 0;
  const result = await runAggregatePublicNpmCanary({ root, record, environment: {}, fetchImpl: async () => { calls += 1; throw new Error("unexpected registry access"); } });
  assert.equal(result.verdict, "indeterminate");
  assert.equal(result.reason, "publication-records-pending");
  assert.equal(calls, 0);
  assert.ok(result.pending.length > 0);
});

test("credential-bearing parent environments are rejected before any live aggregate work", async () => {
  await assert.rejects(() => runAggregatePublicNpmCanary({ root, record, environment: { NPM_TOKEN: "test-only-credential" } }), /credential-bearing/);
});

test("aggregate runner pins the required Node/npm/zlib tuple", () => {
  assert.doesNotThrow(() => assertAggregateRuntime({ node: "v24.19.0", npm: "11.17.0", zlib: "1.3.2.1-motley-3246f1b" }));
  assert.throws(() => assertAggregateRuntime({ node: "v24.15.0", npm: "11.17.0", zlib: "1.3.2.1-motley-3246f1b" }), /requires Node/);
  assert.throws(() => assertAggregateRuntime({ node: "v24.19.0", npm: "11.17.0", zlib: "1.3.2.1-motley-3246f1" }), /requires Node/);
  assert.throws(() => assertAggregateRuntime({ node: "v24.19.0", npm: "11.17.0", zlib: "1.3.2.1-motley-3246f1x" }), /requires Node/);
});

test("Controller physical identity deduplicates repeated tree edges but rejects a second nested root", () => {
  const controller = { name: "@clossys/controller", version: "0.8.23", path: "/consumer/node_modules/@clossys/controller" };
  const repeated = { name: "consumer", dependencies: { advisor: { dependencies: { "@clossys/controller": controller } }, starter: { dependencies: { "@clossys/controller": { ...controller } } } } };
  assert.deepEqual(controllerPhysicalIdentities(repeated), [controller]);
  const conflicting = structuredClone(repeated); conflicting.dependencies.starter.dependencies["@clossys/controller"] = { name: "@clossys/controller", version: "0.8.22", path: "/consumer/node_modules/@clossys/starter/node_modules/@clossys/controller" };
  assert.equal(controllerPhysicalIdentities(conflicting).length, 2);
});

test("aggregate CLI accepts only a closed flag grammar and transcript retention is atomic", async () => {
  assert.deepEqual(parseAggregateCanaryCli([]), { closurePath: null, set: "oidc-successor", outputDirectory: "governance/public-npm-aggregate-transcripts" });
  assert.deepEqual(parseAggregateCanaryCli(["--set", "baseline"]), { closurePath: null, set: "baseline", outputDirectory: "governance/public-npm-aggregate-transcripts" });
  for (const args of [["--set"], ["--set", "baseline", "--set", "oidc-successor"], ["--unknown", "x"], ["--output-dir", "elsewhere"], ["--closure", "../escape.json"]]) assert.throws(() => parseAggregateCanaryCli(args), /usage:/);
  const temporary = await mkdtemp(join(tmpdir(), "foundry-aggregate-retain-"));
  const transcript = { set: "baseline", canonicalSha256: "d".repeat(64), example: true };
  try {
    const path = await retainAggregateTranscript({ root: temporary, transcript });
    assert.equal(path, `governance/public-npm-aggregate-transcripts/baseline-${transcript.canonicalSha256}.json`);
    assert.deepEqual(JSON.parse(await readFile(join(temporary, path), "utf8")), transcript);
    await assert.rejects(() => retainAggregateTranscript({ root: temporary, transcript }), /EEXIST/);

    const hostile = await mkdtemp(join(tmpdir(), "foundry-aggregate-retain-symlink-"));
    const outside = await mkdtemp(join(tmpdir(), "foundry-aggregate-retain-outside-"));
    try {
      await mkdir(join(hostile, "governance"));
      await rename(join(hostile, "governance"), join(outside, "governance"));
      await (await import("node:fs/promises")).symlink(join(outside, "governance"), join(hostile, "governance"), "dir");
      await assert.rejects(() => retainAggregateTranscript({ root: hostile, transcript: { ...transcript, canonicalSha256: "e".repeat(64) } }), /symlink/);
      await assert.rejects(() => readFile(join(outside, "governance", "public-npm-aggregate-transcripts", `baseline-${"e".repeat(64)}.json`)), /ENOENT/);
    } finally { await rm(hostile, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("aggregate CLI exit classes are typed rather than selected from error wording", () => {
  const script = join(root, "scripts", "run-public-npm-aggregate-canary.mjs");
  const invalid = spawnSync(process.execPath, [script, "--unknown", "this mentions INDETERMINATE"], { cwd: root, encoding: "utf8" });
  assert.equal(invalid.status, 1); assert.match(invalid.stderr, /VIOLATED/);
  const absent = spawnSync(process.execPath, [script, "--closure", `governance/public-npm-aggregate-closures/baseline-${"a".repeat(64)}.json`], { cwd: root, encoding: "utf8" });
  assert.equal(absent.status, 2); assert.match(absent.stderr, /INDETERMINATE/);
});

test("a later closure makes a frozen pending set runnable without rewriting its plan", () => {
  const selected = record.sets[0];
  const closure = {
    schema: "foundry-public-npm-aggregate-closure-v1", version: 1,
    plan: { path: "governance/public-npm-aggregate-canary.json", sha256: aggregatePlanSha256(record) }, set: "baseline",
    packages: selected.packages.map((entry) => ({ name: entry.name, version: entry.version, qualification: { path: `governance/release-qualifications/${entry.packageKey}-${entry.version}.json`, sha256: sha }, publication: { path: `governance/release-publications/later/${entry.packageKey}-${entry.version}.json`, sha256: sha, member: entry.packageKey } })),
  };
  closure.canonicalSha256 = sha256(JSON.stringify(stable(closure)));
  const resolved = resolveAggregateClosure(record, "baseline", closure);
  assert.equal(resolved.incomplete.length, 0);
  assert.ok(resolved.selected.packages.every((entry) => entry.qualification && entry.publication));
  const bad = structuredClone(closure); bad.packages.pop(); bad.canonicalSha256 = sha256(JSON.stringify(stable(Object.fromEntries(Object.entries(bad).filter(([key]) => key !== "canonicalSha256")))));
  assert.throws(() => resolveAggregateClosure(record, "baseline", bad), /closed immutable join/);
  assert.equal(isAggregateClosurePath(aggregateClosurePath("baseline", closure.canonicalSha256)), true);
  assert.equal(isAggregateClosurePath("../governance/public-npm-aggregate-closures/baseline-" + closure.canonicalSha256 + ".json"), false);
  assert.ok(validateAggregateClosure(record, closure, { path: aggregateClosurePath("oidc-successor", closure.canonicalSha256) }).some((item) => item.rule === "closure-path"));
});

test("sealed historical Trio aliases require the exact allowed tuple", () => {
  const transition = JSON.parse(read("governance/package-identity-transition.json"));
  const entry = { name: "@clossys/advisor", version: "0.1.5" };
  assert.deepEqual(sealedHistoricalRepository({ entry, proof: { evidence: { repository: "clossys/platform" } }, transition }), { historicalRepository: "clossys/platform", repository: "clossys/foundry", repositoryId: 1325931929 });
  assert.throws(() => sealedHistoricalRepository({ entry: { ...entry, version: "9.9.9" }, proof: { evidence: { repository: "clossys/platform" } }, transition }), /exact sealed/);
  assert.throws(() => sealedHistoricalRepository({ entry, proof: { evidence: { repository: "foreign/repo" } }, transition }), /neither current/);
  const strategist = { name: "@clossys/strategist", version: "0.1.1" };
  assert.deepEqual(sealedHistoricalRepository({ entry: strategist, proof: { kind: "public-npm-anonymous-registry-proof-v1", evidence: {} }, transition }), { historicalRepository: "clossys/platform", repository: "clossys/foundry", repositoryId: 1325931929 });
  assert.throws(() => sealedHistoricalRepository({ entry: { ...strategist, version: "9.9.9" }, proof: { kind: "public-npm-anonymous-registry-proof-v1", evidence: {} }, transition }), /exact sealed repository-less/);
});

test("deterministic synthetic aggregate uses one local-tarball consumer for all nineteen child dispatches and real rollback", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "foundry-aggregate-synthetic-"));
  const plan = structuredClone(record); plan.peerResolution = { requested: {}, disposition: [] };
  const selected = plan.sets[0];
  const artifacts = new Map();
  const evidence = new Map();
  const sources = new Map();
  let childCalls = 0, optionalCalls = 0;
  try {
    const packageRoot = join(temporary, "packages"), artifactRoot = join(temporary, "artifacts");
    sources.set("governance/package-identity-transition.json", JSON.stringify({ candidate: { repository: "clossys/foundry" } }));
    await mkdir(packageRoot, { recursive: true }); await mkdir(artifactRoot, { recursive: true });
    for (const entry of selected.packages) {
      const directory = join(packageRoot, entry.packageKey); await mkdir(directory);
      const manifest = { name: entry.name, version: entry.version, type: "module", ...(entry.packageKey === "publisher" ? { dependencies: { "@clossys/controller": "*", "@clossys/writer": "*", "@clossys/designer": "*" } } : {}) };
      const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
      await writeFile(join(directory, "package.json"), manifestBytes); await writeFile(join(directory, "index.js"), "export default true;\n");
      execFileSync("npm", ["pack", "--pack-destination", artifactRoot], { cwd: directory, stdio: "ignore" });
      const tarball = join(artifactRoot, `${entry.name.slice(1).replace("/", "-")}-${entry.version}.tgz`);
      const bytes = await readFile(tarball), packedManifestSha256 = sha256(manifestBytes);
      artifacts.set(`${entry.name}@${entry.version}`, bytes);
      evidence.set(`${entry.name}@${entry.version}`, { name: entry.name, version: entry.version, shasum: createHash("sha1").update(bytes).digest("hex"), sha256: sha256(bytes), sha512: createHash("sha512").update(bytes).digest("hex"), packedManifestSha256 });
    }
    const closure = { schema: "foundry-public-npm-aggregate-closure-v1", version: 1, plan: { path: "governance/public-npm-aggregate-canary.json", sha256: aggregatePlanSha256(plan) }, set: "baseline", packages: selected.packages.map((entry) => ({ name: entry.name, version: entry.version, qualification: { path: `governance/release-qualifications/${entry.packageKey}-${entry.version}.json`, sha256: sha }, publication: { path: `governance/release-publications/later/${entry.packageKey}-${entry.version}.json`, sha256: sha, member: entry.packageKey } })) };
    closure.canonicalSha256 = sha256(JSON.stringify(stable(closure)));
    for (const entry of selected.packages) {
      const candidate = { name: entry.name, version: entry.version, packageManifestSha256: evidence.get(`${entry.name}@${entry.version}`).packedManifestSha256, tarball: { sha1: evidence.get(`${entry.name}@${entry.version}`).shasum, sha256: evidence.get(`${entry.name}@${entry.version}`).sha256, sha512: evidence.get(`${entry.name}@${entry.version}`).sha512 } };
      sources.set(`governance/release-qualifications/${entry.packageKey}-${entry.version}.json`, JSON.stringify({ candidate }));
      sources.set(`governance/release-publications/later/${entry.packageKey}-${entry.version}.json`, JSON.stringify({ name: entry.name, version: entry.version, candidate, registryProof: { evidence: { repository: "clossys/foundry" } } }));
    }
    for (const item of closure.packages) {
      item.qualification.sha256 = sha256(sources.get(item.qualification.path));
      item.publication.sha256 = sha256(sources.get(item.publication.path));
    }
    closure.canonicalSha256 = sha256(JSON.stringify(stable(Object.fromEntries(Object.entries(closure).filter(([key]) => key !== "canonicalSha256")))));
    const result = await runAggregatePublicNpmCanary({
      root: temporary, record: plan, set: "baseline", closure, closurePath: aggregateClosurePath("baseline", closure.canonicalSha256), environment: { PATH: process.env.PATH, SERVICE_PRIVATE_VALUE: "opaque", COOKIE: "private" }, readEvidence: (path) => sources.get(path) ?? "{}", validateRegistryProof: () => [],
      verifyArtifact: async ({ name, version }) => ({ kind: "verified", bytes: artifacts.get(`${name}@${version}`), evidence: evidence.get(`${name}@${version}`) }), prepareCandidate: async ({ artifact }) => artifact,
      executeCandidate: async (artifact) => { childCalls += 1; const run = childRun(artifact.entry); const served = evidence.get(`${artifact.entry.name}@${artifact.entry.version}`); run.tarball = { sha1: served.shasum, sha256: served.sha256, sha512: served.sha512 }; run.coverage.installedManifestSha256 = served.packedManifestSha256; run.consumer = artifact.aggregateConsumer; run.canonicalSha256 = sha256(JSON.stringify(Object.fromEntries(Object.entries(run).filter(([key]) => key !== "canonicalSha256")))); return run; },
      executeOptionalPeers: async ({ matrix, env, consumer }) => { optionalCalls += 1; assert.equal(env.SERVICE_PRIVATE_VALUE, undefined); assert.equal(env.COOKIE, undefined); const manifestSha256 = consumerDigest(consumer, await readFile(join(consumer, "package.json"), "utf8")); const lockfileSha256 = consumerDigest(consumer, await readFile(join(consumer, "package-lock.json"), "utf8")); return matrix.flatMap((row) => row.peers.flatMap((peer) => Object.keys(peer.outcomes).map((specifier) => ({ package: row.name, version: row.version, peer: peer.peer, specifier, outcome: peer.outcomes[specifier], evaluator: "node-direct", restoration: { manifestSha256, lockfileSha256, treeSha256: sha } })))); },
    });
    assert.equal(result.verdict, "satisfied"); assert.equal(childCalls, 19); assert.equal(optionalCalls, 1);
    assert.equal(result.transcript.packages.length, 19); assert.equal(result.transcript.operations.length, 3); assert.deepEqual(result.transcript.operations.map((operation) => operation.id), ["install", "uninstall", "reinstall"]); assert.ok(result.transcript.packages.every((entry) => !entry.run.observations.some((observation) => observation.kind === "install"))); assert.ok(result.transcript.packages.every((entry) => JSON.stringify(entry.run.consumer) === JSON.stringify(result.transcript.consumer && { manifestSha256: result.transcript.consumer.manifestSha256, lockfileSha256: result.transcript.consumer.lockfileSha256 }))); assert.equal(result.transcript.consumer.rollback.packageAbsenceProven, true); assert.equal(result.transcript.consumer.rollback.identitiesRestored, true); assert.deepEqual(validateSatisfiedAggregateTranscript(result.transcript, { plan, closure }), []);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("satisfied records bind the closed plan, closure, canonical payload, and one immutable introduction", () => {
  const { plan, closure, transcript } = satisfiedFixture();
  assert.deepEqual(validateSatisfiedAggregateTranscript(transcript, { plan, closure }), []);
  const candidateContracts = Object.fromEntries(transcript.packages.map((entry) => [`${entry.name}@${entry.version}`, { qualification: entry.served, publication: entry.served }]));
  assert.deepEqual(validateSatisfiedAggregateTranscript(transcript, { plan, closure, candidateContracts }), []);
  assert.deepEqual(validateSatisfiedTranscriptHistory({ path: `governance/public-npm-aggregate-transcripts/baseline-${transcript.canonicalSha256}.json`, history: [{ commit: "a".repeat(40), status: "A", sha256: sha }] }), []);
  const badDigest = structuredClone(transcript); badDigest.plan.setsSha256 = sha;
  assert.ok(validateSatisfiedAggregateTranscript(badDigest, { plan, closure }).some((item) => item.rule === "plan-join"));
  const badChild = structuredClone(transcript); badChild.packages[0].run.coverage.bins = 99;
  assert.ok(validateSatisfiedAggregateTranscript(badChild, { plan, closure }).some((item) => item.rule === "child-canonical"));
  const wrongInstalled = structuredClone(transcript); wrongInstalled.packages[0].run.coverage.installedManifestSha256 = "4".repeat(64); wrongInstalled.packages[0].run.canonicalSha256 = sha256(JSON.stringify(Object.fromEntries(Object.entries(wrongInstalled.packages[0].run).filter(([key]) => key !== "canonicalSha256"))));
  assert.ok(validateSatisfiedAggregateTranscript(wrongInstalled, { plan, closure }).some((item) => item.rule === "child-install-join"));
  const extraChild = structuredClone(transcript); extraChild.packages[0].run.unreviewed = true; extraChild.packages[0].run.canonicalSha256 = sha256(JSON.stringify(Object.fromEntries(Object.entries(extraChild.packages[0].run).filter(([key]) => key !== "canonicalSha256"))));
  assert.ok(validateSatisfiedAggregateTranscript(extraChild, { plan, closure }).some((item) => item.rule === "child-identity"));
  const tamperedTarball = structuredClone(transcript); tamperedTarball.packages[0].run.tarball.sha1 = "4".repeat(40); tamperedTarball.packages[0].run.canonicalSha256 = sha256(JSON.stringify(Object.fromEntries(Object.entries(tamperedTarball.packages[0].run).filter(([key]) => key !== "canonicalSha256"))));
  assert.ok(validateSatisfiedAggregateTranscript(tamperedTarball, { plan, closure }).some((item) => item.rule === "child-served-join"));
  const fabricatedServed = structuredClone(transcript); fabricatedServed.packages[0].served.tarball.sha256 = "5".repeat(64); fabricatedServed.packages[0].run.tarball.sha256 = "5".repeat(64); fabricatedServed.packages[0].run.canonicalSha256 = sha256(JSON.stringify(Object.fromEntries(Object.entries(fabricatedServed.packages[0].run).filter(([key]) => key !== "canonicalSha256")))); fabricatedServed.canonicalSha256 = sha256(JSON.stringify(stable(Object.fromEntries(Object.entries(fabricatedServed).filter(([key]) => key !== "canonicalSha256")))));
  assert.ok(validateSatisfiedAggregateTranscript(fabricatedServed, { plan, closure, candidateContracts }).some((item) => item.rule === "served-contract"));
  const traversal = structuredClone(transcript); traversal.plan.closurePath = "../governance/public-npm-aggregate-closures/baseline-" + closure.canonicalSha256 + ".json"; traversal.canonicalSha256 = sha256(JSON.stringify(stable(Object.fromEntries(Object.entries(traversal).filter(([key]) => key !== "canonicalSha256")))));
  assert.ok(validateSatisfiedAggregateTranscript(traversal, { plan, closure }).some((item) => item.rule === "plan-join"));
  const rewritten = [{ commit: "b".repeat(40), status: "M", sha256: sha }, { commit: "a".repeat(40), status: "A", sha256: sha }];
  assert.ok(validateSatisfiedTranscriptHistory({ path: `governance/public-npm-aggregate-transcripts/baseline-${transcript.canonicalSha256}.json`, history: rewritten }).some((item) => item.rule === "transcript-rewrite"));
  const expected = structuredClone(transcript.packages[0].run);
  const wrongOperation = structuredClone(expected); wrongOperation.observations[1].kind = "help"; wrongOperation.canonicalSha256 = sha256(JSON.stringify(Object.fromEntries(Object.entries(wrongOperation).filter(([key]) => key !== "canonicalSha256"))));
  assert.ok(validateAggregateChildExecution(wrongOperation, { name: transcript.packages[0].name, version: transcript.packages[0].version, qualificationTranscript: expected }).some((item) => item.rule === "qualification-operations"));
  assert.doesNotThrow(() => validateAggregateChildExecution({ schema: "foundry-aggregate-child-execution-v1", version: 1, candidate: { name: transcript.packages[0].name, version: transcript.packages[0].version }, archetype: "x", tarball: { sha1, sha256: sha, sha512 }, peerInstall: {}, consumer: { manifestSha256: sha, lockfileSha256: sha }, coverage: {}, observations: null, dimensions: null, restoration: {}, mismatches: [], ok: false, canonicalSha256: sha }, transcript.packages[0]));
});
