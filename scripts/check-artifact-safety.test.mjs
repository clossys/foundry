import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const gate = join(process.cwd(), "scripts/check-artifact-safety.mjs");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "artifact-gate-"));
  const pkg = join(root, "pkg"); const bin = join(root, "bin"); const marker = join(root, "npm-called");
  await mkdir(pkg); await mkdir(bin);
  await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "@example/artifact", version: "1.0.0" }));
  await writeFile(join(bin, "npm"), "#!/bin/sh\ntouch \"" + marker + "\"\nexit 1\n"); await chmod(join(bin, "npm"), 0o755);
  return { root, pkg, bin, marker };
}
async function run(item, args, extraEnv = {}) {
  try { return await execFile("node", [gate, item.pkg, ...args], { env: { ...process.env, ...extraEnv, PATH: item.bin + ":" + process.env.PATH } }); }
  catch (error) { return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
}
test("supplied tarball failures never invoke npm pack and reject missing, nonregular, and symlink inputs", async (t) => {
  const item = await fixture(); t.after(() => rm(item.root, { recursive: true, force: true }));
  for (const path of [join(item.root, "missing.tgz"), item.root]) {
    const result = await run(item, ["--tarball", path]);
    assert.equal(result.code, 2); assert.equal(existsSync(item.marker), false);
  }
  const target = join(item.root, "target.tgz"); const link = join(item.root, "link.tgz");
  await writeFile(target, "not a tarball"); await symlink(target, link);
  const result = await run(item, ["--tarball", link]);
  assert.equal(result.code, 2); assert.equal(existsSync(item.marker), false);
});
test("default package mode still invokes npm pack", async (t) => {
  const item = await fixture(); t.after(() => rm(item.root, { recursive: true, force: true }));
  const result = await run(item, []);
  assert.equal(result.code, 2); assert.equal(existsSync(item.marker), true);
});
test("supplied tarball manifest mismatch is rejected before any npm pack", async (t) => {
  const item = await fixture(); t.after(() => rm(item.root, { recursive: true, force: true }));
  const archiveRoot = join(item.root, "archive", "package"); await mkdir(archiveRoot, { recursive: true });
  await writeFile(join(archiveRoot, "package.json"), JSON.stringify({ name: "@example/other", version: "1.0.0" }));
  const tarball = join(item.root, "mismatch.tgz");
  await execFile("tar", ["-czf", tarball, "-C", join(item.root, "archive"), "package"]);
  const result = await run(item, ["--tarball", tarball]);
  assert.equal(result.code, 2); assert.match(result.stderr, /name\/version/); assert.equal(existsSync(item.marker), false);
});
test("a supplied safe tarball is scanned after source mutation without invoking npm pack", async (t) => {
  const item = await fixture(); t.after(() => rm(item.root, { recursive: true, force: true }));
  await writeFile(join(item.root, "package-scope.json"), JSON.stringify({ scope: "@example", registry: "https://registry.example.test" }));
  await writeFile(join(item.pkg, "README.md"), "safe package\n"); await writeFile(join(item.pkg, "LICENSE"), "MIT\n");
  const archive = join(item.root, "archive", "package"); await mkdir(archive, { recursive: true });
  for (const file of ["package.json", "README.md", "LICENSE"]) await writeFile(join(archive, file), await (await import("node:fs/promises")).readFile(join(item.pkg, file)));
  const tarball = join(item.root, "safe.tgz"); await execFile("tar", ["-czf", tarball, "-C", join(item.root, "archive"), "package"]);
  await writeFile(join(item.pkg, "README.md"), "mutated after pack\n");
  const result = await run(item, ["--tarball", tarball]);
  assert.equal(result.code ?? 0, 0); assert.equal(existsSync(item.marker), false);
});
test("freezes supplied tarball bytes before the source path can be replaced", async (t) => {
  const item = await fixture(); t.after(() => rm(item.root, { recursive: true, force: true }));
  await writeFile(join(item.root, "package-scope.json"), JSON.stringify({ scope: "@example", registry: "https://registry.example.test" }));
  await writeFile(join(item.pkg, "README.md"), "safe package\n"); await writeFile(join(item.pkg, "LICENSE"), "MIT\n");
  const safeArchive = join(item.root, "safe-archive", "package"); await mkdir(safeArchive, { recursive: true });
  for (const file of ["package.json", "README.md", "LICENSE"]) await writeFile(join(safeArchive, file), await readFile(join(item.pkg, file)));
  const tarball = join(item.root, "candidate.tgz"); await execFile("tar", ["-czf", tarball, "-C", join(item.root, "safe-archive"), "package"]);

  // This replacement would fail the structural scan because it omits README
  // and LICENSE. The fake tar swaps the caller's path immediately before the
  // real extraction command; a correct gate is already reading its frozen
  // private copy by then.
  const replacementArchive = join(item.root, "replacement-archive", "package"); await mkdir(replacementArchive, { recursive: true });
  await writeFile(join(replacementArchive, "package.json"), await readFile(join(item.pkg, "package.json")));
  const replacement = join(item.root, "replacement.tgz"); await execFile("tar", ["-czf", replacement, "-C", join(item.root, "replacement-archive"), "package"]);
  await writeFile(join(item.bin, "tar"), "#!/bin/sh\ncp \"$ARTIFACT_SWAP_REPLACEMENT\" \"$ARTIFACT_SWAP_TARGET\"\nexec /usr/bin/tar \"$@\"\n"); await chmod(join(item.bin, "tar"), 0o755);

  const result = await run(item, ["--tarball", tarball], { ARTIFACT_SWAP_TARGET: tarball, ARTIFACT_SWAP_REPLACEMENT: replacement });
  assert.equal(result.code ?? 0, 0);
  assert.equal(existsSync(item.marker), false);
});
test("validates optional supplied tarball digests", async (t) => {
  const item = await fixture(); t.after(() => rm(item.root, { recursive: true, force: true }));
  await writeFile(join(item.root, "package-scope.json"), JSON.stringify({ scope: "@example", registry: "https://registry.example.test" }));
  await writeFile(join(item.pkg, "README.md"), "safe package\n"); await writeFile(join(item.pkg, "LICENSE"), "MIT\n");
  const archive = join(item.root, "archive", "package"); await mkdir(archive, { recursive: true });
  for (const file of ["package.json", "README.md", "LICENSE"]) await writeFile(join(archive, file), await readFile(join(item.pkg, file)));
  const tarball = join(item.root, "digested.tgz"); await execFile("tar", ["-czf", tarball, "-C", join(item.root, "archive"), "package"]);
  const bytes = await readFile(tarball);
  const args = ["--tarball", tarball, ...["sha1", "sha256", "sha512"].flatMap((algorithm) => [`--${algorithm}`, createHash(algorithm).update(bytes).digest("hex")])];
  const pass = await run(item, args); assert.equal(pass.code ?? 0, 0);
  const fail = await run(item, ["--tarball", tarball, "--sha256", "0".repeat(64)]); assert.equal(fail.code, 2); assert.match(fail.stderr, /sha256 mismatch/);
});
