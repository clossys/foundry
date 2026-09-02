import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";
import { validateReleaseQualificationContract, validateReleaseQualificationPolicy, validateReleaseQualificationPortfolio } from "./lib/release-qualification-contract.mjs";

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
    ["advisor", "@clossys/advisor", "0.2.0"],
    ["starter", "@clossys/starter", "0.1.5"],
    ["controller", "@clossys/controller", "0.9.1"],
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
    assert.deepEqual([request.advisor.name, request.advisor.version], ["@clossys/advisor", "0.1.5"]);
  }
  const starterManifest = await repositoryJson("governance/release-qualification-fixtures/starter/current-direct/overlay/package.json");
  const starterLock = await repositoryJson("governance/release-qualification-fixtures/starter/current-direct/overlay/package-lock.json");
  const advisorManifest = await repositoryJson("governance/release-qualification-fixtures/starter/current-direct/overlay/advisor-package.json");
  assert.equal(starterManifest.devDependencies["@clossys/advisor"], "0.1.5");
  assert.equal(starterLock.packages[""].devDependencies["@clossys/advisor"], "0.1.5");
  assert.equal(starterLock.packages["node_modules/@clossys/advisor"].version, "0.1.5");
  assert.deepEqual([advisorManifest.name, advisorManifest.version], ["@clossys/advisor", "0.1.5"]);

  const declarations = await repositoryJson("governance/release-qualification-fixtures/controller/current-direct/authority-declarations.json");
  const validLock = await repositoryJson("governance/release-qualification-fixtures/controller/current-direct/authority-valid-package-lock.json");
  const duplicateLock = await repositoryJson("governance/release-qualification-fixtures/controller/current-direct/authority-duplicate-package-lock.json");
  assert.deepEqual(declarations.declarations, [{ packageName: "@clossys/controller", authority: "controller" }]);
  assert.deepEqual(declarations.target, { authority: "controller", version: "0.8.23" });
  assert.equal(validLock.packages["node_modules/@clossys/controller"].version, "0.8.23");
  assert.equal(duplicateLock.packages["node_modules/@clossys/controller"].version, "0.8.23");
  assert.equal(duplicateLock.packages["node_modules/@example/consumer/node_modules/@clossys/controller"].version, "0.8.22");
});

test("all 19 publishable packages are exact-source bound to the catalogue and qualification policy", async () => {
  const policy = await repositoryJson("governance/release-qualification-policy.json");
  const catalog = await repositoryJson("governance/release-catalog.json");
  const expectedVersions = {
    "@clossys/advisor": "0.2.0",
    "@clossys/architect": "0.1.3",
    "@clossys/bouncer": "0.1.2",
    "@clossys/builder": "0.7.5",
    "@clossys/butler": "0.1.2",
    "@clossys/controller": "0.9.1",
    "@clossys/designer": "0.3.1",
    "@clossys/giver": "0.1.3",
    "@clossys/influencer": "0.1.3",
    "@clossys/inspector": "0.1.20",
    "@clossys/integrator": "0.6.3",
    "@clossys/keeper": "0.1.3",
    "@clossys/locksmith": "0.1.7",
    "@clossys/messenger": "0.1.3",
    "@clossys/observer": "0.2.4",
    "@clossys/publisher": "0.3.1",
    "@clossys/starter": "0.1.5",
    "@clossys/strategist": "0.1.2",
    "@clossys/writer": "0.3.3",
  };
  const packageKeys = (await readdir(new URL("../packages", import.meta.url))).sort();
  const manifests = await Promise.all(packageKeys.map((key) => repositoryJson(`packages/${key}/package.json`)));
  const target = catalog.targets.find((item) => item.id === catalog.defaultTarget);
  assert.equal(manifests.filter((manifest) => manifest.private !== true).length, 19);
  assert.deepEqual(Object.keys(policy.packages).sort(), Object.keys(expectedVersions).sort());
  assert.deepEqual(validateReleaseQualificationPolicy(policy), []);
  assert.deepEqual(validateReleaseQualificationPortfolio({ policy, manifests, releasePackages: target.packages }), []);
  const releasePosition = new Map(target.packages.map((key, index) => [key, index]));
  const sourceNames = new Set(manifests.map((manifest) => manifest.name));
  for (const manifest of manifests) {
    const key = manifest.name.split("/")[1];
    const firstPartyDependencies = Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    }).filter((name) => sourceNames.has(name));
    for (const dependency of firstPartyDependencies) {
      const dependencyKey = dependency.split("/")[1];
      assert.ok(releasePosition.get(dependencyKey) < releasePosition.get(key), `${dependency} must precede ${manifest.name}`);
    }
  }
  for (const [name, entry] of Object.entries(policy.packages)) {
    const manifest = await repositoryJson(`${entry.packageDir}/package.json`);
    assert.equal(entry.packageKey, name.split("/")[1]);
    assert.equal(manifest.name, name);
    assert.equal(manifest.version, expectedVersions[name]);
    assert.equal(entry.archetypes["current-direct"].status, "required");
    const adapter = await repositoryJson(entry.adapterPath);
    const fixtureRoot = join(process.cwd(), entry.fixturePath);
    const fixtures = Object.fromEntries(adapter.fixtures.map((fixture) => {
      const stat = lstatSync(join(fixtureRoot, fixture));
      return [fixture, { type: stat.isFile() ? "file" : "other", symlink: stat.isSymbolicLink(), tracked: true, size: stat.size }];
    }));
    const manifestBins = typeof manifest.bin === "string" ? { [manifest.name]: manifest.bin } : manifest.bin ?? {};
    assert.equal(adapter.package, name);
    assert.deepEqual(validateReleaseQualificationContract({ policy, adapter, fixtures, manifestBins, peerDependencies: manifest.peerDependencies ?? {}, peerDependenciesMeta: manifest.peerDependenciesMeta ?? {} }), [], name);
  }
  const designer = policy.packages["@clossys/designer"];
  const designerAdapter = await repositoryJson(designer.adapterPath);
  assert.ok(designerAdapter.fixtures.includes("clean/View.tsx"));
  assert.match(await readFile(new URL(`../${designer.fixturePath}/clean/View.tsx`, import.meta.url), "utf8"), /text-\[var\(--color-ink-primary\)\]/);

  const publisherAdapter = await repositoryJson(policy.packages["@clossys/publisher"].adapterPath);
  assert.deepEqual(publisherAdapter.peerInstall, {
    "@internationalized/date": designerAdapter.peerInstall["@internationalized/date"],
    react: "19.2.8",
    "react-aria-components": designerAdapter.peerInstall["react-aria-components"],
    "react-dom": "19.2.8",
    "tailwind-merge": designerAdapter.peerInstall["tailwind-merge"],
    tailwindcss: designerAdapter.peerInstall.tailwindcss,
  });
});

test("portfolio closure fails when policy or catalogue omits one source package", async () => {
  const policy = await repositoryJson("governance/release-qualification-policy.json");
  const catalog = await repositoryJson("governance/release-catalog.json");
  const manifests = await Promise.all((await readdir(new URL("../packages", import.meta.url))).sort().map((key) => repositoryJson(`packages/${key}/package.json`)));
  const target = catalog.targets.find((item) => item.id === catalog.defaultTarget);
  const missingPolicy = structuredClone(policy);
  delete missingPolicy.packages["@clossys/observer"];
  assert.deepEqual(validateReleaseQualificationPortfolio({ policy: missingPolicy, manifests, releasePackages: target.packages }).map((item) => item.rule), ["portfolio-policy"]);
  assert.deepEqual(validateReleaseQualificationPortfolio({ policy, manifests, releasePackages: target.packages.filter((key) => key !== "observer") }).map((item) => item.rule), ["portfolio-catalog"]);
});
