#!/usr/bin/env node
// check-artifact-safety — scan the TARBALL, not the repository tree.
//
//   node scripts/check-artifact-safety.mjs <packageDir> [--require-denylist] [--json]
//
// Exit 0 = the artifact is safe. Exit 1 = findings. Exit 2 = the check could not run.
//
// WHY A SEPARATE GATE
// -------------------
// check-public-safety scans a git work tree. What actually reaches a consumer
// is an `npm pack` tarball. Those two differ in BOTH directions, and one of
// those directions is dangerous:
//
//   tree has files the tarball does not  -> false positives. Harmless.
//   tarball has files the tree scan did not read -> FALSE NEGATIVES.
//
// The second case is not theoretical here. `dist/` is gitignored, so the tree
// scan skips it as unreachable-by-push; but every package lists `dist` in
// `files`, so it is the single largest thing in the shipped tarball — and the
// CI safety job runs BEFORE the build step that creates it. The compiled output
// that consumers actually execute has therefore never been content-scanned.
//
// The same hole is reachable deliberately: npm's `files` array ships a path
// regardless of .gitignore, so any gitignored file named in `files` is invisible
// to a tree scan and present in the tarball. Verified empirically.
//
// So this gate packs the package for real, extracts the tarball, and scans what
// came out — with `dist/` treated as expected-and-scanned rather than forbidden.
// `npm pack --dry-run` in the publish workflow lists filenames only; it reads no
// contents and cannot catch any of this.

import { constants, mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, statSync, openSync, fstatSync, closeSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const valueFlags = new Set(["--denylist", "--tarball", "--sha1", "--sha256", "--sha512"]);
const booleanFlags = new Set(["--require-denylist", "--json"]);
const flags = new Set();
let pkgDir;
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index];
  if (valueFlags.has(arg)) { if (!argv[index + 1] || argv[index + 1].startsWith("--")) { console.error("check-artifact-safety: missing flag value"); process.exit(2); } flags.add(arg); index += 1; continue; }
  if (booleanFlags.has(arg)) { flags.add(arg); continue; }
  if (arg.startsWith("--") || pkgDir) { console.error("check-artifact-safety: closed CLI arguments required"); process.exit(2); }
  pkgDir = arg;
}

function flagValue(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

// `workDir` is created partway through the run (below) but `die()` can be
// called both before and after that point. Declared here, ahead of `die`,
// so `die` can see whichever value is current at call time.
let workDir;

function die(msg) {
  console.error(`check-artifact-safety: ${msg}`);
  // process.exit() terminates the process immediately — it does not unwind
  // the stack, so a `finally` block still pending on the stack never runs.
  // Any die() called once workDir exists must clean it up itself, right
  // here, before exiting — that's the only way this cleanup is guaranteed
  // to run for the failure path.
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  process.exit(2);
}

if (!pkgDir) die("usage: check-artifact-safety.mjs <packageDir> [--tarball <path>] [--sha1 <digest>] [--sha256 <digest>] [--sha512 <digest>] [--require-denylist] [--json]");
const absPkgDir = resolve(pkgDir);
if (!existsSync(join(absPkgDir, "package.json"))) die(`no package.json at ${absPkgDir}`);

const digestPatterns = { sha1: /^[a-f0-9]{40}$/, sha256: /^[a-f0-9]{64}$/, sha512: /^[a-f0-9]{128}$/ };
const expectedDigests = Object.fromEntries(Object.keys(digestPatterns).map((algorithm) => [algorithm, flagValue(`--${algorithm}`)]));
for (const [algorithm, expected] of Object.entries(expectedDigests)) {
  if (expected !== undefined && !digestPatterns[algorithm].test(expected)) die(`invalid --${algorithm} digest`);
}

function digestsOf(bytes) {
  return Object.fromEntries(Object.keys(digestPatterns).map((algorithm) => [algorithm, createHash(algorithm).update(bytes).digest("hex")]));
}

function validateExpectedDigests(bytes, source) {
  const actual = digestsOf(bytes);
  for (const [algorithm, expected] of Object.entries(expectedDigests)) {
    if (expected !== undefined && expected !== actual[algorithm]) die(`${source} ${algorithm} mismatch (expected ${expected}, got ${actual[algorithm]})`);
  }
}

const manifest = JSON.parse(readFileSync(join(absPkgDir, "package.json"), "utf8"));
if (manifest.private === true) {
  console.log(`check-artifact-safety: ${manifest.name} is private:true — nothing is published, skipping.`);
  process.exit(0);
}

workDir = mkdtempSync(join(tmpdir(), "artifact-safety-"));
let exitCode = 0;
const structural = [];

try {
  // 1. Pack the exact package contents without executing package-controlled
  //    lifecycle scripts. The caller may hold a private denylist in its
  //    environment, so running prepack/prepare here would expose that value to
  //    untrusted candidate code. Build and release qualification are separate
  //    explicit stages; this gate only inspects the artifact npm would select.
  let tarballName, tarballPath;
  const suppliedTarball = flagValue("--tarball");
  if (suppliedTarball) {
    const sourcePath = resolve(suppliedTarball);
    let fd;
    let bytes;
    let sourceError;
    try {
      // Open once with O_NOFOLLOW, then fstat/read the descriptor. The path may
      // be replaced immediately after this point; all later work uses the
      // private frozen copy below, never the caller-controlled pathname.
      fd = openSync(sourcePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const state = fstatSync(fd);
      if (!state.isFile()) throw new Error(`tarball must be a regular non-symlink file: ${sourcePath}`);
      bytes = readFileSync(fd);
    } catch (error) {
      sourceError = error instanceof Error ? error.message : String(error);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    if (sourceError) die(sourceError);
    try {
      validateExpectedDigests(bytes, "supplied tarball");
      tarballPath = join(workDir, "supplied.tgz");
      writeFileSync(tarballPath, bytes, { mode: 0o600 });
    } catch (error) {
      die(error instanceof Error ? error.message : String(error));
    }
    tarballName = basename(sourcePath);
  } else {
    try { const out = execFileSync("npm", ["pack", "--ignore-scripts", "--pack-destination", workDir], { cwd: absPkgDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); tarballName = out.trim().split("\n").filter(Boolean).pop(); }
    catch (error) { die("npm pack failed: " + (error.stderr ?? error.message)); }
    tarballPath = join(workDir, tarballName);
    if (!existsSync(tarballPath)) die("npm pack reported a missing tarball");
    if (Object.values(expectedDigests).some((value) => value !== undefined)) validateExpectedDigests(readFileSync(tarballPath), "packed tarball");
  }

  // 2. Extract. Everything in an npm tarball lives under `package/`.
  const extractDir = join(workDir, "extracted");
  execFileSync("mkdir", ["-p", extractDir]);
  execFileSync("tar", ["-xzf", tarballPath, "-C", extractDir], { stdio: ["ignore", "pipe", "pipe"] });
  const rootDir = join(extractDir, "package");
  if (!existsSync(rootDir)) die("extracted tarball has no package/ directory");
  let packedManifest;
  try { packedManifest = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")); } catch { die("packed tarball package/package.json is invalid"); }
  if (packedManifest.name !== manifest.name || packedManifest.version !== manifest.version) die("packed tarball name/version does not match packageDir manifest");

  // 3. Structural assertions about the artifact itself. These are things a
  //    content scan cannot express: presence, absence, and shape.
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else files.push(relative(rootDir, full));
    }
  })(rootDir);

  const need = ["LICENSE", "README.md", "package.json"];
  for (const f of need) {
    if (!files.includes(f)) {
      structural.push({ kind: "missing-file", detail: `${f} is absent from the tarball`, severity: "high" });
    }
  }

  // Test files are the classic `files`-glob mistake: a negation pattern that
  // covers .test.ts but not .test.tsx ships every React component test.
  const testFiles = files.filter((f) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(f) || /(^|\/)__tests__\//.test(f));
  for (const f of testFiles) {
    structural.push({ kind: "test-file", detail: `test file shipped: ${f}`, severity: "high" });
  }

  // A tarball .npmrc can carry a registry pin or an auth line.
  for (const f of files.filter((f) => /(^|\/)\.npmrc$/.test(f))) {
    structural.push({ kind: "npmrc", detail: `.npmrc shipped: ${f}`, severity: "critical" });
  }

  // Source maps that resolve outside the tarball leak the build machine's
  // layout and break "go to definition" for consumers.
  for (const f of files.filter((f) => f.endsWith(".map"))) {
    let map;
    try {
      map = JSON.parse(readFileSync(join(rootDir, f), "utf8"));
    } catch {
      continue;
    }
    // sourceRoot is a standard sourcemap field that gets prepended to every
    // entry in sources[] before resolution. A relative-looking sources[]
    // entry can still resolve to an absolute build-machine path once
    // sourceRoot is applied, so it has to be checked on its own — the
    // per-source absolute-path test below never sees it.
    if (typeof map.sourceRoot === "string" && /^([a-zA-Z]:)?[/\\]/.test(map.sourceRoot)) {
      structural.push({
        kind: "sourcemap-abs-path",
        detail: `${f} sourceRoot is an absolute path: ${map.sourceRoot}`,
        severity: "high",
      });
    }
    for (const src of map.sources ?? []) {
      // Any build-machine path is an absolute path, so the absolute test alone
      // is sufficient — naming specific home-directory prefixes here added no
      // coverage and put a denylisted string in the gate's own source.
      if (/^([a-zA-Z]:)?[/\\]/.test(src)) {
        structural.push({ kind: "sourcemap-abs-path", detail: `${f} sources[] has an absolute path: ${src}`, severity: "high" });
        continue;
      }
      const resolved = resolve(join(rootDir, f), "..", src);
      if (!existsSync(resolved)) {
        structural.push({
          kind: "sourcemap-dangling",
          detail: `${f} sources[] points outside the tarball: ${src}`,
          severity: "medium",
        });
      }
    }
  }

  // 4. Content scan over the extracted artifact, in --artifact mode so dist/ is
  //    scanned rather than refused. Delegates to the one matcher so there is a
  //    single implementation of the rules.
  const passThrough = ["--artifact", "--allow-changelogs", "--no-gitignore"];
  if (flags.has("--require-denylist")) passThrough.push("--require-denylist");
  if (flags.has("--json")) passThrough.push("--json");
  // An explicit denylist has to reach the inner scan, or this gate would
  // silently fall back to the default one — which is how a test suite ends up
  // asserting against a denylist it did not choose.
  const denylistArg = flagValue("--denylist");
  if (denylistArg) passThrough.push("--denylist", denylistArg);

  // The extracted tarball has no repository above it, so the gate's upward
  // search for package-scope.json would find nothing and fail the registry pin
  // for the wrong reason. Locate the real one from the package directory and
  // hand it over explicitly.
  let scopeConfigPath = null;
  for (let dir = absPkgDir; ; dir = resolve(dir, "..")) {
    const candidate = join(dir, "package-scope.json");
    if (existsSync(candidate)) {
      scopeConfigPath = candidate;
      break;
    }
    if (resolve(dir, "..") === dir) break;
  }
  if (!scopeConfigPath) die(`no package-scope.json found above ${absPkgDir} — cannot verify the registry pin`);
  passThrough.push("--scope-config", scopeConfigPath);

  let contentOut = "";
  let contentCode = 0;
  try {
    contentOut = execFileSync(
      "node",
      [join(scriptDir, "check-public-safety.mjs"), rootDir, ...passThrough],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    contentOut = (error.stdout ?? "") + (error.stderr ?? "");
    contentCode = error.status ?? 1;
  }

  if (flags.has("--json")) {
    console.log(JSON.stringify({ tarball: tarballName, files: files.length, structural, contentScan: contentOut.trim(), contentExit: contentCode }, null, 2));
  } else {
    console.log(`check-artifact-safety: packed ${manifest.name} -> ${tarballName} (${files.length} files)\n`);
    console.log(contentOut.trim());
    console.log("");
    if (structural.length) {
      console.log(`## artifact structure — ${structural.length} finding(s)`);
      for (const s of structural) console.log(`  [${s.severity}] ${s.detail}`);
      console.log("");
    }
  }

  if (contentCode === 2) exitCode = 2;
  else if (contentCode !== 0 || structural.length) exitCode = 1;

  if (!flags.has("--json")) {
    console.log(
      exitCode === 0
        ? "ARTIFACT PASS — the packed tarball carries no forbidden file, credential-shaped string, private identity, or structural defect."
        : exitCode === 2
          ? "ARTIFACT ERROR — the check could not run."
          : "ARTIFACT FAIL — this tarball is NOT safe to publish.",
    );
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

process.exit(exitCode);
