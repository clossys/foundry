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
  // Derived from each package's own manifest (issue #1254), not a literal
  // version pin: a real package version bump must not need a hand-edit here
  // just to keep this list current. What this loop actually proves — the
  // packages/<key> directory-to-name join, and the adapter's own binding to
  // that name — does not depend on which version currently happens to sit
  // in the manifest.
  const keys = ["advisor", "starter", "controller"];

  for (const key of keys) {
    const manifest = await repositoryJson(`packages/${key}/package.json`);
    const { name } = manifest;
    const entry = policy.packages[name];
    const adapter = await repositoryJson(entry.adapterPath);
    assert.equal(entry.packageKey, key);
    assert.equal(adapter.package, name);
    assert.equal(adapter.retainRawCaseEvidence, key === "starter" ? true : undefined);
  }

  // The synthetic @clossys/advisor this current-direct fixture set exercises
  // is a fixed input the fixture itself owns (issue #1504), not
  // packages/advisor's real, currently-published version -- a real advisor
  // release does not touch these files and must not need a hand-edit here.
  // overlay/advisor-package.json is the file run-candidate-qualification.mjs
  // actually installs into node_modules as @clossys/advisor, so it is that
  // identity's record; what this proves is that the request fixtures, the
  // overlay manifest, and the overlay lock all still agree with THAT record,
  // not that any particular version string is currently in effect.
  const starterManifest = await repositoryJson("governance/release-qualification-fixtures/starter/current-direct/overlay/package.json");
  const starterLock = await repositoryJson("governance/release-qualification-fixtures/starter/current-direct/overlay/package-lock.json");
  const advisorManifest = await repositoryJson("governance/release-qualification-fixtures/starter/current-direct/overlay/advisor-package.json");
  assert.equal(advisorManifest.name, "@clossys/advisor");
  for (const state of ["satisfied", "violated", "indeterminate"]) {
    const request = await repositoryJson(`governance/release-qualification-fixtures/starter/current-direct/request-${state}.json`);
    assert.deepEqual([request.advisor.name, request.advisor.version], [advisorManifest.name, advisorManifest.version]);
  }
  assert.equal(starterManifest.devDependencies["@clossys/advisor"], advisorManifest.version);
  assert.equal(starterLock.packages[""].devDependencies["@clossys/advisor"], advisorManifest.version);
  assert.equal(starterLock.packages["node_modules/@clossys/advisor"].version, advisorManifest.version);

  const declarations = await repositoryJson("governance/release-qualification-fixtures/controller/current-direct/authority-declarations.json");
  const validLock = await repositoryJson("governance/release-qualification-fixtures/controller/current-direct/authority-valid-package-lock.json");
  const duplicateLock = await repositoryJson("governance/release-qualification-fixtures/controller/current-direct/authority-duplicate-package-lock.json");
  assert.deepEqual(declarations.declarations, [{ packageName: "@clossys/controller", authority: "controller" }]);
  // declarations.target.version is likewise this fixture set's own fixed
  // synthetic controller version (issue #1504), unrelated to
  // packages/controller's real version. It is the authority-declarations.json
  // record's own target, so the two lock fixtures below are checked against
  // THAT record instead of a literal repeated a third time.
  const controllerVersion = declarations.target.version;
  assert.deepEqual(declarations.target, { authority: "controller", version: controllerVersion });
  assert.equal(validLock.packages["node_modules/@clossys/controller"].version, controllerVersion);
  assert.equal(duplicateLock.packages["node_modules/@clossys/controller"].version, controllerVersion);
  // The nested entry's entire purpose is to be a second, conflicting
  // @clossys/controller at a version that disagrees with the declared
  // authority -- that mismatch is what duplicate-authority detection
  // (exercised via this same fixture in accept-qualification-handoff.test.mjs
  // and validate-candidate-publish.test.mjs) is for. Which exact off-version
  // it uses is arbitrary, so the only thing worth asserting is that it still
  // disagrees with the authority, not which literal value that is.
  assert.notEqual(duplicateLock.packages["node_modules/@example/consumer/node_modules/@clossys/controller"].version, controllerVersion);
});

test("every publishable package is exact-source bound to the catalogue and qualification policy", async () => {
  const policy = await repositoryJson("governance/release-qualification-policy.json");
  const catalog = await repositoryJson("governance/release-catalog.json");

  const packageKeys = (await readdir(new URL("../packages", import.meta.url))).sort();
  const manifests = await Promise.all(packageKeys.map((key) => repositoryJson(`packages/${key}/package.json`)));
  const target = catalog.targets.find((item) => item.id === catalog.defaultTarget);
  // Derived from the packages/ manifests actually on disk (issue #1254), not
  // a literal snapshot: a real package version bump must not need a
  // hand-edit here. What this test proves is that `policy.packages` names
  // exactly the set of non-private manifests, and that each policy entry's
  // OWN packageDir (below) resolves to the SAME manifest this independent
  // packages/ directory scan already found for that name — not that any
  // particular version string is currently in effect.
  const expectedVersions = Object.fromEntries(manifests.filter((manifest) => manifest.private !== true).map((manifest) => [manifest.name, manifest.version]));
  // The count this line asserted (issue #1504) tracked packages/ and had to
  // be bumped on every new package; the deepEqual right below already fails
  // if policy.packages names anything other than exactly this scan's
  // non-private manifests -- a package present in one set and not the other
  // fails there regardless of how many there are on either side.
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
