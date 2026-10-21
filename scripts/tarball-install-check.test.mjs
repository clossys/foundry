// Tests for scripts/tarball-install-check.mjs.
//
// Packs designer and publisher (and the first-party packages publisher
// depends on) from this working tree into a temporary directory, installs
// them into empty consumer projects offline, and checks what resolved.
// Self-contained: no build (resolution reads only the packed manifests),
// no network (offline install against an empty private cache), no
// credentials (the npm child environment is a literal, never process.env).
//
// The realistic case packs every tarball one minor past the repository's
// version (only inside the temporary copy), the way a default-branch build
// moves past a sibling's pinned 0.x minor. There:
//   - GREEN: with an overrides block naming every first-party package, one
//     copy of each resolves, and it is the tarball.
//   - CONTROL / mutant "override block omitted": the same install asks the
//     registry for a second copy (ENOTCACHED offline).
//   - mutant "one first-party name missing from the block": each name a
//     sibling depends on, omitted in turn, does the same.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { makeTmpDirSync } from "./lib/tmp-fixture.mjs";
import {
  DEFAULT_PACKAGE_DIRS,
  REPO_ROOT,
  checkInstall,
  cli,
  discoverWorkspace,
  firstPartyClosure,
  firstPartyPredicate,
  nextMinor,
  packClosure,
  sanitizedNpmEnv,
  verifyConsumer,
} from "./tarball-install-check.mjs";

const workspace = discoverWorkspace(REPO_ROOT);
const isFirstParty = firstPartyPredicate(workspace);
const closure = firstPartyClosure(workspace, DEFAULT_PACKAGE_DIRS);
const direct = DEFAULT_PACKAGE_DIRS.map((dir) => closure.find((entry) => entry.dir === dir).manifest.name);
const publisher = closure.find((entry) => entry.dir === "packages/publisher").manifest;
const publisherSiblings = Object.keys(publisher.dependencies ?? {}).filter(isFirstParty);

test("the default closure is designer, publisher and the first-party packages publisher depends on", () => {
  const names = closure.map((entry) => entry.manifest.name).sort();
  assert.deepEqual(names, [...new Set([...direct, ...publisherSiblings])].sort());
  assert.ok(publisherSiblings.length > 0, "publisher should depend on at least one first-party package");
});

test("the npm child environment carries no credential or inherited npm config", (t) => {
  const root = makeTmpDirSync(t, "tarball-install-check-env-");
  const env = sanitizedNpmEnv(root);
  const leaked = Object.keys(env).filter((key) => /TOKEN|AUTH|SECRET|PASSWORD/i.test(key));
  assert.deepEqual(leaked, []);
  assert.equal(env.npm_config_offline, "true");
  assert.equal(env.npm_config_ignore_scripts, "true");
  assert.notEqual(env.npm_config_userconfig, env.npm_config_globalconfig);
  assert.ok(env.npm_config_cache.startsWith(root));
});

test("nextMinor raises the minor and resets the patch", () => {
  assert.equal(nextMinor("0.12.3"), "0.13.0");
  assert.throws(() => nextMinor("0.12"));
});

test("tarballs one minor past the repository version", async (t) => {
  const root = makeTmpDirSync(t, "tarball-install-check-next-");
  const packed = packClosure({ repoRoot: REPO_ROOT, closure, root, versionShift: "minor" });
  for (const record of packed) {
    const repoVersion = closure.find((entry) => entry.manifest.name === record.name).manifest.version;
    assert.equal(record.version, nextMinor(repoVersion), `${record.name} should be packed one minor past ${repoVersion}`);
  }

  let green;
  await t.test("GREEN: the overrides block installs one copy of each first-party package, from its tarball", () => {
    green = checkInstall({ root, packed, direct, isFirstParty, label: "green" });
    assert.equal(green.install.status, 0, green.install.stderr);
    assert.deepEqual(green.findings, []);
  });

  await t.test("CONTROL / mutant: override block omitted -> a second registry copy is requested", () => {
    const result = checkInstall({ root, packed, direct, overrides: false, isFirstParty, label: "no-overrides" });
    assert.notEqual(result.install.status, 0);
    assert.match(result.install.stderr, /ENOTCACHED/);
    assert.equal(result.findings[0]?.kind, "registry-copy-requested", JSON.stringify(result.findings));
  });

  for (const name of publisherSiblings) {
    await t.test(`mutant: ${name} missing from the overrides block -> a second registry copy is requested`, () => {
      const label = `omit-${name.replace(/[^a-z0-9]+/gi, "-")}`;
      const result = checkInstall({ root, packed, direct, omit: [name], isFirstParty, label });
      assert.notEqual(result.install.status, 0);
      assert.match(result.install.stderr, /ENOTCACHED/);
      assert.equal(result.findings[0]?.kind, "registry-copy-requested", JSON.stringify(result.findings));
      assert.ok(result.findings[0].message.includes(name), `${result.findings[0].message} should name ${name}`);
    });
  }

  await t.test("the verifier reports a nested second copy and a registry-resolved lock entry", () => {
    assert.ok(green, "GREEN must have run first");
    const [sibling] = publisherSiblings;
    const record = packed.find((entry) => entry.name === sibling);
    const consumerDir = join(root, "nested-copy");
    cpSync(green.consumerDir, consumerDir, { recursive: true });
    const nested = join(consumerDir, "node_modules", publisher.name, "node_modules", sibling);
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, "package.json"), JSON.stringify({ name: sibling, version: "0.0.1" }));
    const lockPath = join(consumerDir, "package-lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8"));
    lock.packages[`node_modules/${publisher.name}/node_modules/${sibling}`] = {
      version: "0.0.1",
      resolved: `https://registry.npmjs.org/${sibling}/-/x-0.0.1.tgz`,
      integrity: "sha512-AAAA",
    };
    writeFileSync(lockPath, JSON.stringify(lock));
    const findings = verifyConsumer({ consumerDir, packed, install: { status: 0, stderr: "" }, isFirstParty });
    assert.ok(record, "sibling should be packed");
    const nestedKey = `node_modules/${publisher.name}/node_modules/${sibling}`;
    const countFindings = findings.filter((finding) => finding.kind === "copy-count");
    assert.equal(countFindings.length, 2, JSON.stringify(findings));
    assert.ok(countFindings.every((finding) => finding.message.includes(nestedKey)), JSON.stringify(findings));
  });
});

test("GREEN: tarballs at the repository version (same version string as the registry) resolve from the tarball", (t) => {
  const root = makeTmpDirSync(t, "tarball-install-check-same-");
  const packed = packClosure({ repoRoot: REPO_ROOT, closure, root, versionShift: "none" });
  const result = checkInstall({ root, packed, direct, isFirstParty, label: "same-version" });
  assert.equal(result.install.status, 0, result.install.stderr);
  assert.deepEqual(result.findings, []);
});

function captureIo() {
  const out = [];
  const err = [];
  return { out, err, io: { log: (line) => out.push(line), error: (line) => err.push(line) } };
}

test("CLI: --omit-override without a value, or with a flag as its value, could not run (exit 2)", () => {
  for (const argv of [["--omit-override"], ["--omit-override", "--json"]]) {
    const { err, io } = captureIo();
    assert.equal(cli(argv, { io, run: () => assert.fail("must not run") }), 2, argv.join(" "));
    assert.match(err.join("\n"), /COULD NOT RUN — --omit-override needs a package name/);
  }
  const child = spawnSync(process.execPath, ["scripts/tarball-install-check.mjs", "--omit-override"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(child.status, 2, child.stderr);
});

test("CLI: an --omit-override name that matches no packed package could not run (exit 2), never OK", () => {
  const [name] = publisherSiblings;
  for (const typo of [`${name}x`, "packages/designer"]) {
    const { out, err, io } = captureIo();
    assert.equal(cli(["--omit-override", typo], { io }), 2, typo);
    assert.match(err.join("\n"), /--omit-override names no packed package/);
    assert.doesNotMatch(out.join("\n"), /TARBALL INSTALL OK/);
  }
});

test("CLI: an unexpected (non-CheckError) failure could not run (exit 2), with its stack", () => {
  const { err, io } = captureIo();
  const code = cli([], { io, run: () => { throw new TypeError("boom"); } });
  assert.equal(code, 2);
  assert.match(err.join("\n"), /COULD NOT RUN — TypeError: boom\n\s+at /);
});

test("CLI: --keep prints the kept root, and --json carries it", () => {
  const kept = { root: "kept-root-dir", packed: [{ name: "@scope/a", version: "0.1.0", integrity: "sha512-x" }], findings: [] };
  const human = captureIo();
  assert.equal(cli(["--keep"], { io: human.io, run: (options) => (assert.equal(options.keep, true), kept) }), 0);
  assert.ok(human.out.includes("  [KEEP ] kept-root-dir"), human.out.join("\n"));
  const json = captureIo();
  assert.equal(cli(["--keep", "--json"], { io: json.io, run: () => kept }), 0);
  assert.equal(JSON.parse(json.out.join("\n")).root, "kept-root-dir");
  const plain = captureIo();
  assert.equal(cli([], { io: plain.io, run: () => ({ ...kept, root: null }) }), 0);
  assert.ok(!plain.out.some((line) => line.includes("[KEEP ]")));
});
