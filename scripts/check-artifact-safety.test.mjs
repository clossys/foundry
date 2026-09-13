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
test("default package mode never exposes a private caller environment to package lifecycle scripts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "artifact-lifecycle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pkg = join(root, "pkg");
  const marker = join(root, "lifecycle-observed-private-env");
  await mkdir(pkg);
  await writeFile(join(root, "package-scope.json"), JSON.stringify({ scope: "@example", registry: "https://registry.example.test" }));
  await writeFile(join(pkg, "README.md"), "safe package\n");
  await writeFile(join(pkg, "LICENSE"), "MIT\n");
  await writeFile(join(pkg, "index.js"), "export const safe = true;\n");
  await writeFile(join(pkg, "package.json"), JSON.stringify({
    name: "@example/artifact",
    version: "1.0.0",
    type: "module",
    files: ["index.js", "README.md", "LICENSE"],
    publishConfig: { registry: "https://registry.example.test" },
    scripts: {
      prepack: `node -e "if (process.env.PUBLIC_SAFETY_DENYLIST) require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'observed')"`,
    },
  }));

  const result = await execFile("node", [gate, pkg], {
    env: { ...process.env, PUBLIC_SAFETY_DENYLIST: "/private/denylist/path" },
  }).catch((error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));

  assert.equal(result.code ?? 0, 0, result.stderr || result.stdout);
  assert.equal(existsSync(marker), false, "npm pack must not execute the hostile prepack hook");
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

// -------------------------------------------------------------------------
// --path-prefix: closing the tree/tarball boundary for package-scoped
// neutralize entries.
//
// A denylist neutralize entry is written repository-relative (e.g.
// "packages/pkg-a/CHANGELOG.md") because that's what a human editing the
// denylist reads it against. But this gate scans an EXTRACTED TARBALL, whose
// root is the package directory itself once the tarball's own "package/"
// layer is stripped away, so inside that scan the same file is bare
// "CHANGELOG.md", with no repository-relative path left to match. Without
// --path-prefix a package-scoped entry can therefore never apply during a
// tarball scan, no matter how it is written.
//
// These fixtures use a SYNTHETIC denylist passed via --denylist, never the
// real one, so they run without $PUBLIC_SAFETY_DENYLIST in any environment.
async function buildPathPrefixFixture({ extraFilesInA: extraFilesInAOf = () => ({}) } = {}) {
  const root = await mkdtemp(join(tmpdir(), "path-prefix-"));
  const registry = "https://registry.example.test";
  await writeFile(join(root, "package-scope.json"), JSON.stringify({ scope: "@example", registry }));

  // Structurally credential-shaped in neither direction: a plain synthetic
  // sibling-product name, issued by no one, that would never collide with a
  // real denylist term.
  const term = "acme-corp";
  const denylist = {
    version: "synthetic-path-prefix-test",
    terms: [{ pattern: term, why: "synthetic sibling product", severity: "high" }],
    // Confined to pkg-a's CHANGELOG.md ONLY; pkg-b's own CHANGELOG.md, and
    // any other file in either package, must still fail on the same term.
    neutralize: [{ pattern: term, paths: ["packages/pkg-a/CHANGELOG.md"] }],
  };
  const denylistPath = join(root, "denylist.json");
  await writeFile(denylistPath, JSON.stringify(denylist, null, 2));

  async function writePackage(name, extraFiles) {
    const dir = join(root, "packages", name);
    await mkdir(dir, { recursive: true });
    const files = ["README.md", "LICENSE", "CHANGELOG.md", "index.js", ...Object.keys(extraFiles)];
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify(
        { name: `@example/${name}`, version: "1.0.0", private: false, license: "MIT", files, publishConfig: { registry } },
        null,
        2,
      ),
    );
    await writeFile(join(dir, "README.md"), `# ${name}\n`);
    await writeFile(join(dir, "LICENSE"), "MIT\n");
    await writeFile(join(dir, "CHANGELOG.md"), `## 0.1.0\n- Mentions ${term} in passing.\n`);
    await writeFile(join(dir, "index.js"), "export const x = 1;\n");
    for (const [filename, content] of Object.entries(extraFiles)) await writeFile(join(dir, filename), content);
    return dir;
  }

  const pkgADir = await writePackage("pkg-a", extraFilesInAOf(term));
  const pkgBDir = await writePackage("pkg-b", {});
  return { root, pkgADir, pkgBDir, denylistPath, term };
}

const safetyGate = join(process.cwd(), "scripts/check-public-safety.mjs");

async function runNode(args) {
  return execFile("node", args).catch((error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
}

test("path-prefix: a package-scoped repository-relative neutralize entry neutralizes inside that same package's tarball scan", async (t) => {
  const { root, pkgADir, denylistPath } = await buildPathPrefixFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await runNode([gate, pkgADir, "--denylist", denylistPath, "--require-denylist"]);
  assert.equal(result.code ?? 0, 0, (result.stdout ?? "") + (result.stderr ?? ""));
});

test("path-prefix: the same neutralize entry does NOT neutralize the identical filename in a different package's tarball", async (t) => {
  const { root, pkgBDir, denylistPath } = await buildPathPrefixFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await runNode([gate, pkgBDir, "--denylist", denylistPath, "--require-denylist"]);
  const out = (result.stdout ?? "") + (result.stderr ?? "");
  assert.equal(result.code, 1, out);
  assert.match(out, /identity/);
  // The finding must report the real scanned path (bare "CHANGELOG.md",
  // since the tarball root IS the package directory), never the rebased
  // repository-relative path used only for the neutralize comparison.
  assert.match(out, /CHANGELOG\.md/);
  assert.doesNotMatch(out, /packages\/pkg-b\/CHANGELOG\.md/);
});

test("path-prefix: a term outside the neutralized path still fails the tarball scan (the rule does not whitelist the whole package)", async (t) => {
  const { root, pkgADir, denylistPath } = await buildPathPrefixFixture({
    extraFilesInA: (term) => ({ "NOTES.md": `See ${term} for background.\n` }),
  });
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await runNode([gate, pkgADir, "--denylist", denylistPath, "--require-denylist"]);
  const out = (result.stdout ?? "") + (result.stderr ?? "");
  assert.equal(result.code, 1, out);
  assert.match(out, /NOTES\.md/);
});

test("path-prefix: a term outside the neutralized path still fails a plain repository-mode scan (no --path-prefix)", async (t) => {
  const { root, denylistPath } = await buildPathPrefixFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const result = await runNode([safetyGate, root, "--denylist", denylistPath, "--require-denylist", "--allow-changelogs", "--json"]);
  assert.equal(result.code, 1, (result.stdout ?? "") + (result.stderr ?? ""));
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    report = { failures: [] };
  }
  const hit = (rel) => (report.failures ?? []).some((f) => f.kind === "identity" && f.rel === rel);
  assert.equal(hit("packages/pkg-a/CHANGELOG.md"), false, "pkg-a's own CHANGELOG.md should stay neutralized in tree mode");
  assert.equal(hit("packages/pkg-b/CHANGELOG.md"), true, "pkg-b's CHANGELOG.md carries the same term outside the neutralized path and must still fail");
});
