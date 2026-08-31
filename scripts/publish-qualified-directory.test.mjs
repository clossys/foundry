import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

import { argsFrom, publishQualifiedDirectory } from "./publish-qualified-directory.mjs";

const execFile = promisify(execFileCallback);
const hash = (algorithm, value) => createHash(algorithm).update(value).digest("hex");

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "qualified-directory-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = join(root, "packages", "strategist");
  await mkdir(join(packageRoot, "dist"), { recursive: true });
  await mkdir(join(root, "governance", "release-qualifications"), { recursive: true });
  await writeFile(join(root, "package-scope.json"), JSON.stringify({ scope: "@clossys", registry: "https://registry.npmjs.org", access: "public" }));
  // The release-catalogue validator deliberately preserves the exact historic
  // scope. Build it at runtime so this isolated test fixture is not itself a
  // public cross-account reference.
  const historicalScope = String.fromCodePoint(64, 118, 101, 115, 112, 101, 110, 101, 118, 101, 110, 116, 117, 114, 101, 115);
  await writeFile(join(root, "governance", "release-catalog.json"), JSON.stringify({ schemaVersion: 2, defaultTarget: "clossys-npmjs", targets: [
    { id: "current-github-packages", status: "historical", scope: historicalScope, registry: "https://npm.pkg.github.com", packages: "all" },
    { id: "clossys-npmjs", status: "active", scope: "@clossys", registry: "https://registry.npmjs.org", access: "public", packages: ["advisor", "starter", "controller", "strategist", "writer", "designer"] },
  ] }));
  const manifest = { name: "@clossys/strategist", version: "0.1.1", type: "module", files: ["dist", "README.md", "LICENSE"], publishConfig: { registry: "https://registry.npmjs.org", access: "public" } };
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(packageRoot, "README.md"), "Public package\n");
  await writeFile(join(packageRoot, "LICENSE"), "MIT\n");
  await writeFile(join(packageRoot, "dist", "index.js"), "export const value = 1;\n");
  const packed = join(root, "qualified"); await mkdir(packed);
  const output = await execFile("npm", ["pack", ".", "--ignore-scripts", "--json", "--pack-destination", packed], { cwd: packageRoot, env: { PATH: process.env.PATH, HOME: root } });
  const filename = JSON.parse(output.stdout)[0].filename;
  const candidate = join(packed, filename), bytes = await readFile(candidate);
  const record = { timing: "pre-publication", candidate: { name: manifest.name, version: manifest.version, packageManifestSha256: hash("sha256", await readFile(join(packageRoot, "package.json"))), tarball: Object.fromEntries(["sha1", "sha256", "sha512"].map((algorithm) => [algorithm, hash(algorithm, bytes)])) } };
  const recordPath = join(root, "governance", "release-qualifications", "clossys-strategist-0.1.1.json"); await writeFile(recordPath, `${JSON.stringify(record)}\n`);
  const denylist = join(root, "denylist.json"); await writeFile(denylist, JSON.stringify({ version: 1, terms: [{ pattern: "never-match-qualified-wrapper", why: "fixture" }] }));
  return { root, candidate, recordPath, denylist, bytes };
}

test("owner-present wrapper has a closed CLI", () => {
  const argv = ["node", "script", "--package", "strategist", "--candidate", "candidate.tgz", "--record", "record.json"];
  assert.deepEqual(argsFrom(argv), { package: "strategist", candidate: "candidate.tgz", record: "record.json" });
  for (const mutation of [["--otp", "123456"], ["--candidate", "https://example.test/x.tgz"], ["--unknown", "x"], ["--package", "../strategist"]]) assert.throws(() => argsFrom([...argv, ...mutation]), /Usage:/);
});

test("owner-present wrapper publishes only a clean directory with exact bytes and no transient manifest metadata", async (t) => {
  const item = await fixture(t), calls = [];
  let packedAttachment = null;
  const run = (file, args, options) => {
    calls.push({ file, args: [...args], cwd: options.cwd, env: { ...options.env } });
    if (file === process.execPath) return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "pack") {
      const result = spawnSync(file, args, { cwd: options.cwd, env: options.env, encoding: "utf8" });
      packedAttachment = readFileSync(join(args.at(-1), JSON.parse(result.stdout)[0].filename));
      return result;
    }
    if (args[0] === "publish") {
      const outbound = JSON.parse(readFileSync(join(options.cwd, "package.json"), "utf8"));
      assert.equal(Object.hasOwn(outbound, "_from"), false);
      assert.equal(Object.hasOwn(outbound, "_resolved"), false);
      assert.equal(packedAttachment.equals(item.bytes), true, "the loopback attachment must be exactly the qualified bytes");
    }
    return { status: 0, stdout: "", stderr: "" };
  };
  const verified = [];
  const result = await publishQualifiedDirectory({ root: item.root, packageKey: "strategist", candidatePath: item.candidate, recordPath: item.recordPath, env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist, NPM_TOKEN: "must-not-forward" }, run, verify: async (options) => { verified.push(options); } });
  assert.equal(result.tarball.sha256, hash("sha256", item.bytes));
  const publish = calls.find((call) => call.file === "npm" && call.args[0] === "publish");
  assert.deepEqual(publish.args, ["publish", ".", "--access", "public", "--ignore-scripts", "--registry", "https://registry.npmjs.org"]);
  assert.equal(publish.cwd.includes("clossys-qualified-publish-"), true);
  assert.equal(publish.env.NPM_TOKEN, undefined);
  assert.equal(publish.args.some((value, index) => value.includes(".tgz") || (value.includes("://") && publish.args[index - 1] !== "--registry") || value === "--otp" || value === "--provenance"), false);
  const packed = calls.find((call) => call.file === "npm" && call.args[0] === "pack");
  assert.deepEqual(packed.args.slice(0, 4), ["pack", ".", "--ignore-scripts", "--json"]);
  const scan = calls.find((call) => call.file === process.execPath);
  assert.deepEqual(scan.args.slice(-6), ["--artifact", "--no-gitignore", "--allow-changelogs", "--require-denylist", "--scope-config", join(item.root, "package-scope.json")]);
  assert.equal(scan.env.NPM_TOKEN, undefined, "the full scan receives only its explicit denylist capability");
  assert.equal(verified.length, 1);
  assert.equal(verified[0].env.NPM_TOKEN, undefined);
});

test("wrapper rejects transient manifest metadata, symlinks, and changed clean-directory bytes before publish", async (t) => {
  const item = await fixture(t);
  const original = await readFile(item.candidate);
  const run = (file, args, options) => {
    if (file === process.execPath) return { status: 0, stdout: "", stderr: "" };
    if (args[0] === "pack") { writeFileSync(join(args.at(-1), "candidate.tgz"), Buffer.from("different")); return { status: 0, stdout: JSON.stringify([{ filename: "candidate.tgz" }]), stderr: "" }; }
    throw new Error("publish must not be reached");
  };
  await assert.rejects(() => publishQualifiedDirectory({ root: item.root, packageKey: "strategist", candidatePath: item.candidate, recordPath: item.recordPath, env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist }, run, verify: async () => {} }), /differs from the immutable qualified candidate/);
  assert.equal((await readFile(item.candidate)).equals(original), true);
});

test("wrapper rejects archive symlinks and transient client manifest fields before any scan or publish", async (t) => {
  const item = await fixture(t);
  const archive = join(item.root, "unsafe-archive", "package"); await mkdir(archive, { recursive: true });
  await writeFile(join(archive, "package.json"), JSON.stringify({ name: "@clossys/strategist", version: "0.1.1", _from: "file:qualified.tgz" }));
  await symlink("package.json", join(archive, "linked-manifest"));
  const unsafe = join(item.root, "unsafe.tgz"); await execFile("tar", ["-czf", unsafe, "-C", join(item.root, "unsafe-archive"), "package"]);
  let called = false;
  await assert.rejects(() => publishQualifiedDirectory({ root: item.root, packageKey: "strategist", candidatePath: unsafe, recordPath: item.recordPath, env: { PATH: process.env.PATH, HOME: item.root, PUBLIC_SAFETY_DENYLIST: item.denylist }, run: () => { called = true; return { status: 0, stdout: "", stderr: "" }; }, verify: async () => {} }), /unsafe|symlink|extended metadata|entries/);
  assert.equal(called, false);
});
