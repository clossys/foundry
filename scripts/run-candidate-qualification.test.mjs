import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import { validateReleaseQualificationContract, validateReleaseQualificationPolicy } from "./lib/release-qualification-contract.mjs";

const execFile = promisify(execFileCallback);
const cli = fileURLToPath(new URL("./run-candidate-qualification.mjs", import.meta.url));

async function rejects(args) {
  await assert.rejects(() => execFile(process.execPath, [cli, ...args]), /Usage: --package/);
}

test("CLI rejects unknown, duplicate, missing, and path-traversal package flags before filesystem access", async () => {
  await rejects(["--unknown", "x", "--package", "controller", "--tarball", "candidate.tgz", "--output", "out.json"]);
  await rejects(["--package", "controller", "--package", "again", "--tarball", "candidate.tgz", "--output", "out.json"]);
  await rejects(["--package", "../controller", "--tarball", "candidate.tgz", "--output", "out.json"]);
  await rejects(["--package", "controller", "--tarball", "candidate.tgz"]);
});
test("CLI rejects a credential-bearing parent before it can inspect a candidate", async () => {
  await assert.rejects(() => execFile(process.execPath, [cli, "--package", "controller", "--tarball", "candidate.tgz", "--output", "out.json"], { env: { PATH: process.env.PATH, NODE_AUTH_TOKEN: "secret" } }), /credential-bearing/);
});

async function repositoryJson(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
}

test("repository Trio policy, adapters, and current-candidate fixtures bind the selected @clossys identities", async () => {
  const policy = await repositoryJson("governance/release-qualification-policy.json");
  const expected = [
    ["advisor", "@clossys/advisor", "0.1.4"],
    ["starter", "@clossys/starter", "0.1.3"],
    ["controller", "@clossys/controller", "0.8.22"],
  ];

  for (const [key, name, version] of expected) {
    const manifest = await repositoryJson(`packages/${key}/package.json`);
    const entry = policy.packages[name];
    const adapter = await repositoryJson(entry.adapterPath);
    assert.equal(entry.packageKey, key);
    assert.deepEqual([manifest.name, manifest.version], [name, version]);
    assert.equal(adapter.package, name);
    assert.equal(adapter.retainRawCaseEvidence, key === "starter" ? true : undefined);
  }

  for (const state of ["satisfied", "violated", "indeterminate"]) {
    const request = await repositoryJson(`governance/release-qualification-fixtures/starter/current-direct/request-${state}.json`);
    assert.deepEqual([request.advisor.name, request.advisor.version], ["@clossys/advisor", "0.1.4"]);
  }
  const starterManifest = await repositoryJson("governance/release-qualification-fixtures/starter/current-direct/overlay/package.json");
  const starterLock = await repositoryJson("governance/release-qualification-fixtures/starter/current-direct/overlay/package-lock.json");
  const advisorManifest = await repositoryJson("governance/release-qualification-fixtures/starter/current-direct/overlay/advisor-package.json");
  assert.equal(starterManifest.devDependencies["@clossys/advisor"], "0.1.4");
  assert.equal(starterLock.packages[""].devDependencies["@clossys/advisor"], "0.1.4");
  assert.equal(starterLock.packages["node_modules/@clossys/advisor"].version, "0.1.4");
  assert.deepEqual([advisorManifest.name, advisorManifest.version], ["@clossys/advisor", "0.1.4"]);

  const declarations = await repositoryJson("governance/release-qualification-fixtures/controller/current-direct/authority-declarations.json");
  const validLock = await repositoryJson("governance/release-qualification-fixtures/controller/current-direct/authority-valid-package-lock.json");
  const duplicateLock = await repositoryJson("governance/release-qualification-fixtures/controller/current-direct/authority-duplicate-package-lock.json");
  assert.deepEqual(declarations.declarations, [{ packageName: "@clossys/controller", authority: "controller" }]);
  assert.deepEqual(declarations.target, { authority: "controller", version: "0.8.22" });
  assert.equal(validLock.packages["node_modules/@clossys/controller"].version, "0.8.22");
  assert.equal(duplicateLock.packages["node_modules/@clossys/controller"].version, "0.8.22");
  assert.equal(duplicateLock.packages["node_modules/@example/consumer/node_modules/@clossys/controller"].version, "0.8.21");
});

test("all six policy entries bind their manifests, adapters, tracked fixtures, bins, and optional peers", async () => {
  const policy = await repositoryJson("governance/release-qualification-policy.json");
  const expected = {
    "@clossys/advisor": { packageKey: "advisor", version: "0.1.4" },
    "@clossys/starter": { packageKey: "starter", version: "0.1.3" },
    "@clossys/controller": { packageKey: "controller", version: "0.8.22" },
    "@clossys/strategist": { packageKey: "strategist", version: "0.1.1" },
    "@clossys/writer": { packageKey: "writer", version: "0.3.1" },
    "@clossys/designer": { packageKey: "designer", version: "0.2.2" },
  };
  assert.deepEqual(Object.keys(policy.packages).sort(), Object.keys(expected).sort());
  assert.deepEqual(validateReleaseQualificationPolicy(policy), []);
  for (const [name, entry] of Object.entries(policy.packages)) {
    const manifest = await repositoryJson(`${entry.packageDir}/package.json`);
    const adapter = await repositoryJson(entry.adapterPath);
    const fixtureRoot = join(process.cwd(), entry.fixturePath);
    const fixtures = Object.fromEntries(adapter.fixtures.map((fixture) => {
      const stat = lstatSync(join(fixtureRoot, fixture));
      return [fixture, { type: stat.isFile() ? "file" : "other", symlink: stat.isSymbolicLink(), tracked: true, size: stat.size }];
    }));
    const manifestBins = typeof manifest.bin === "string" ? { [manifest.name]: manifest.bin } : manifest.bin ?? {};
    assert.equal(entry.packageKey, expected[name].packageKey);
    assert.deepEqual([manifest.name, manifest.version], [name, expected[name].version]);
    assert.equal(adapter.package, name);
    assert.deepEqual(validateReleaseQualificationContract({ policy, adapter, fixtures, manifestBins, peerDependencies: manifest.peerDependencies ?? {}, peerDependenciesMeta: manifest.peerDependenciesMeta ?? {} }), [], name);
  }
  const designer = policy.packages["@clossys/designer"];
  assert.ok((await repositoryJson(designer.adapterPath)).fixtures.includes("clean/View.tsx"));
  assert.match(await readFile(new URL(`../${designer.fixturePath}/clean/View.tsx`, import.meta.url), "utf8"), /text-\[var\(--color-ink-primary\)\]/);
});
