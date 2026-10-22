#!/usr/bin/env node
// tarball-install-check — can a consumer install tarballs packed from this
// repository's working tree, with exactly one copy of every first-party
// package, and every copy the packed tarball rather than a registry copy?
//
//   node scripts/tarball-install-check.mjs [--as-packed] [--no-overrides]
//     [--omit-override <name>]... [--keep] [--json] [<packageDir> ...]
//
// Default package set: packages/designer and packages/publisher, plus every
// first-party package they reach through dependencies, optionalDependencies
// or peerDependencies (for publisher today: writer and controller).
//
// Exit 0 = one copy of each first-party package, each resolved from its
// tarball. Exit 1 = at least one finding. Exit 2 = the check could not run
// (a pack failure, a third-party runtime dependency this offline check
// cannot provide, an unreadable manifest). Same three-way split as every
// gate CLI here -- see CONTRIBUTING.md's "Gate CLIs exit 0/1/2" entry.
//
// WHY
// ---
// First-party packages depend on each other with 0.x caret ranges, and in
// 0.x a caret locks the minor: `^0.12.0` means `>=0.12.0 <0.13.0`. A build
// from the default branch that has moved past that minor does not satisfy
// a sibling's range, so the package manager asks the registry for a second
// copy (or fails without network). The supported consumer recipe is a
// package-manager overrides block that points every first-party name at its
// tarball -- docs/releasing/tarball-install.md. This check proves that
// recipe works and that it is what prevents the second copy.
//
// WHAT IT DOES
// ------------
// 1. Packs each package with `npm pack --ignore-scripts` into a fresh
//    temporary directory outside the repository. No build is run: install
//    resolution reads only the packed manifests, so a missing dist/ does
//    not change the answer.
// 2. Unless --as-packed is given, re-packs every tarball with its version
//    raised to the next minor, inside the temporary copy only (never in the
//    repository). That is the realistic case: the default branch carries
//    unreleased changes past a sibling's pinned minor. --as-packed keeps
//    the repository's version strings, which are the registry's too (the
//    same-version case).
// 3. Writes an empty consumer project that depends on the requested
//    packages by tarball path, with an npm `overrides` block naming every
//    first-party package (minus any --omit-override; none with
//    --no-overrides).
// 4. Installs offline with an empty, private npm cache and a sanitized
//    environment: no inherited npm config, no credential variables, no
//    install scripts, peer dependencies not auto-installed. A request for a
//    registry copy therefore fails with ENOTCACHED instead of downloading
//    anything -- the check never touches the network.
// 5. Verifies the installed tree: for every first-party package, exactly
//    one copy on disk and one entry in the consumer's package-lock.json,
//    at the top level, resolved from its tarball path with the tarball's
//    own sha512 integrity and version.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..");
export const DEFAULT_PACKAGE_DIRS = ["packages/designer", "packages/publisher"];
const LINK_SECTIONS = ["dependencies", "optionalDependencies", "peerDependencies"];
const RUNTIME_SECTIONS = ["dependencies", "optionalDependencies"];
const RM_OPTIONS = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 };

export class CheckError extends Error {}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new CheckError(`cannot read ${path}: ${error.message}`);
  }
}

// Every workspace package, keyed by npm name -> { dir, manifest }.
export function discoverWorkspace(repoRoot = REPO_ROOT) {
  const packagesDir = join(repoRoot, "packages");
  const byName = new Map();
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    byName.set(manifest.name, { dir: `packages/${entry.name}`, manifest });
  }
  if (byName.size === 0) throw new CheckError(`no packages/*/package.json found under ${packagesDir}`);
  return byName;
}

// The requested packages plus every first-party package they reach.
export function firstPartyClosure(workspace, packageDirs) {
  const byDir = new Map([...workspace.values()].map((entry) => [entry.dir, entry]));
  const queue = packageDirs.map((dir) => {
    const entry = byDir.get(dir.replace(/\/+$/, ""));
    if (!entry) throw new CheckError(`${dir} is not a workspace package directory`);
    return entry;
  });
  const seen = new Map();
  while (queue.length > 0) {
    const entry = queue.shift();
    if (seen.has(entry.manifest.name)) continue;
    seen.set(entry.manifest.name, entry);
    for (const section of LINK_SECTIONS) {
      for (const name of Object.keys(entry.manifest[section] ?? {})) {
        if (workspace.has(name)) queue.push(workspace.get(name));
      }
    }
  }
  const thirdParty = [];
  for (const entry of seen.values()) {
    for (const section of RUNTIME_SECTIONS) {
      for (const name of Object.keys(entry.manifest[section] ?? {})) {
        if (!workspace.has(name)) thirdParty.push(`${entry.manifest.name} -> ${name}`);
      }
    }
  }
  if (thirdParty.length > 0) {
    throw new CheckError(
      `third-party runtime dependencies need the public registry, which this offline check does not use: ${thirdParty.join(", ")}`,
    );
  }
  return [...seen.values()];
}

// A child environment built from a literal, never by spreading process.env,
// so no credential or npm configuration of the parent shell reaches npm.
export function sanitizedNpmEnv(root) {
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const userConfig = join(home, "user-npmrc");
  const globalConfig = join(home, "global-npmrc");
  for (const file of [userConfig, globalConfig]) if (!existsSync(file)) writeFileSync(file, "");
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    TMPDIR: home,
    TEMP: home,
    TMP: home,
    npm_config_userconfig: userConfig,
    npm_config_globalconfig: globalConfig,
    npm_config_cache: join(root, "npm-cache"),
    npm_config_registry: "https://registry.npmjs.org/",
    npm_config_offline: "true",
    npm_config_ignore_scripts: "true",
    npm_config_legacy_peer_deps: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
    npm_config_loglevel: "error",
  };
}

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.error) throw new CheckError(`cannot run ${command}: ${result.error.message}`);
  return result;
}

function npmPack(source, destination, env) {
  mkdirSync(destination, { recursive: true });
  const result = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", destination], { cwd: source, env });
  if (result.status !== 0) throw new CheckError(`npm pack failed in ${source}: ${result.stderr.trim()}`);
  let report;
  try {
    [report] = JSON.parse(result.stdout.slice(result.stdout.indexOf("[")));
  } catch (error) {
    throw new CheckError(`npm pack in ${source} printed no JSON report: ${error.message}`);
  }
  if (typeof report?.filename !== "string") throw new CheckError(`npm pack in ${source} reported no tarball filename`);
  return join(destination, report.filename);
}

export function nextMinor(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new CheckError(`version "${version}" is not a plain x.y.z`);
  return `${match[1]}.${Number(match[2]) + 1}.0`;
}

function describeTarball(tarball) {
  const bytes = readFileSync(tarball);
  return { tarball, integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` };
}

// Packs every package in `closure` into `root`/tarballs. Returns one record
// per package: { name, dir, version, tarball, integrity }. With
// versionShift "minor", each tarball is re-packed from an extracted copy
// whose manifest version is raised to the next minor; the repository's own
// manifests are never written.
export function packClosure({ repoRoot = REPO_ROOT, closure, root, versionShift = "minor" }) {
  const env = sanitizedNpmEnv(root);
  const asPackedDir = join(root, "tarballs", "as-packed");
  const packed = [];
  for (const entry of closure) {
    const original = npmPack(join(repoRoot, entry.dir), asPackedDir, env);
    if (versionShift === "none") {
      packed.push({ name: entry.manifest.name, dir: entry.dir, version: entry.manifest.version, ...describeTarball(original) });
      continue;
    }
    const version = nextMinor(entry.manifest.version);
    const extractDir = join(root, "extract", basename(original, ".tgz"));
    mkdirSync(extractDir, { recursive: true });
    const untar = run("tar", ["-xzf", original, "-C", extractDir], { env });
    if (untar.status !== 0) throw new CheckError(`tar could not extract ${original}: ${untar.stderr.trim()}`);
    const manifestPath = join(extractDir, "package", "package.json");
    const manifest = readJson(manifestPath);
    manifest.version = version;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const shifted = npmPack(join(extractDir, "package"), join(root, "tarballs", "next-minor"), env);
    rmSync(extractDir, RM_OPTIONS);
    packed.push({ name: entry.manifest.name, dir: entry.dir, version, ...describeTarball(shifted) });
  }
  return packed;
}

function fileSpec(fromDir, tarball) {
  return `file:${relative(fromDir, tarball).split(sep).join("/")}`;
}

// The consumer manifest: direct dependencies on the requested packages by
// tarball path, plus the overrides block that is the consumer recipe.
export function consumerManifest({ consumerDir, packed, direct, overrides = true, omit = [] }) {
  const manifest = { name: "tarball-install-consumer", version: "0.0.0", private: true, dependencies: {} };
  for (const record of packed) if (direct.includes(record.name)) manifest.dependencies[record.name] = fileSpec(consumerDir, record.tarball);
  if (overrides) {
    manifest.overrides = {};
    for (const record of packed) if (!omit.includes(record.name)) manifest.overrides[record.name] = fileSpec(consumerDir, record.tarball);
  }
  return manifest;
}

// Every installed copy of a first-party package on disk, as paths relative
// to the consumer: node_modules/<name>, and any nested
// .../node_modules/<name>.
export function installedCopies(consumerDir, isFirstParty) {
  const copies = [];
  const walk = (nodeModules) => {
    if (!existsSync(nodeModules)) return;
    for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const packageDirs = entry.name.startsWith("@")
        ? readdirSync(join(nodeModules, entry.name), { withFileTypes: true }).map((sub) => join(nodeModules, entry.name, sub.name))
        : [join(nodeModules, entry.name)];
      for (const packageDir of packageDirs) {
        const manifestPath = join(packageDir, "package.json");
        if (existsSync(manifestPath)) {
          const manifest = readJson(manifestPath);
          if (isFirstParty(manifest.name)) {
            copies.push({ name: manifest.name, version: manifest.version, path: relative(consumerDir, packageDir).split(sep).join("/") });
          }
        }
        walk(join(packageDir, "node_modules"));
      }
    }
  };
  walk(join(consumerDir, "node_modules"));
  return copies;
}

function lockEntryName(key) {
  const index = key.lastIndexOf("node_modules/");
  return index === -1 ? null : key.slice(index + "node_modules/".length);
}

// Findings for an installed consumer. Empty means one copy of each packed
// package, each the tarball. `install` is the npm result (status, stderr).
export function verifyConsumer({ consumerDir, packed, install, isFirstParty }) {
  const findings = [];
  if (install.status !== 0) {
    const requested = [...install.stderr.matchAll(/ENOTCACHED[\s\S]*?request to (\S+) failed/g)].map((match) => decodeURIComponent(match[1]));
    if (requested.length > 0) {
      for (const url of requested) {
        findings.push({ kind: "registry-copy-requested", message: `npm asked the registry for a second copy (${url}); offline, that fails with ENOTCACHED` });
      }
    } else {
      findings.push({ kind: "install-failed", message: `npm install exited ${install.status}: ${install.stderr.trim().split("\n").slice(-3).join(" | ")}` });
    }
    return findings;
  }

  const expected = new Map(packed.map((record) => [record.name, record]));
  const copies = installedCopies(consumerDir, isFirstParty);
  const lockPath = join(consumerDir, "package-lock.json");
  const lock = existsSync(lockPath) ? readJson(lockPath) : { packages: {} };
  const lockEntries = Object.entries(lock.packages ?? {}).filter(([key]) => {
    const name = lockEntryName(key);
    return name !== null && isFirstParty(name);
  });

  for (const copy of copies) {
    if (!expected.has(copy.name)) findings.push({ kind: "unexpected-copy", message: `${copy.path} is a first-party package that was not packed (${copy.name}@${copy.version})` });
  }
  for (const [key, entry] of lockEntries) {
    const name = lockEntryName(key);
    if (!expected.has(name)) findings.push({ kind: "unexpected-copy", message: `package-lock.json lists ${key} (${entry.resolved ?? "no resolved"}), a first-party package that was not packed` });
  }
  for (const record of packed) {
    const onDisk = copies.filter((copy) => copy.name === record.name);
    const inLock = lockEntries.filter(([key]) => lockEntryName(key) === record.name);
    const top = `node_modules/${record.name}`;
    if (onDisk.length !== 1 || onDisk[0].path !== top) {
      findings.push({ kind: "copy-count", message: `${record.name}: expected one copy at ${top}, found ${onDisk.length} (${onDisk.map((copy) => `${copy.path}@${copy.version}`).join(", ") || "none"})` });
    } else if (onDisk[0].version !== record.version) {
      findings.push({ kind: "version", message: `${record.name}: installed ${onDisk[0].version}, tarball is ${record.version}` });
    }
    if (inLock.length !== 1 || inLock[0][0] !== top) {
      findings.push({ kind: "copy-count", message: `${record.name}: expected one package-lock.json entry at ${top}, found ${inLock.map(([key]) => key).join(", ") || "none"}` });
      continue;
    }
    const entry = inLock[0][1];
    const resolved = typeof entry.resolved === "string" && entry.resolved.startsWith("file:") ? resolve(consumerDir, entry.resolved.slice("file:".length)) : null;
    if (resolved !== record.tarball) {
      findings.push({ kind: "not-tarball", message: `${record.name}: package-lock.json resolves ${entry.resolved ?? "nothing"}, not the packed tarball` });
    }
    if (entry.integrity !== record.integrity) {
      findings.push({ kind: "integrity", message: `${record.name}: package-lock.json integrity ${entry.integrity ?? "missing"} does not match the packed tarball` });
    }
  }
  return findings;
}

// Installs one consumer into a fresh directory under `root` and verifies it.
export function checkInstall({ root, packed, direct, overrides = true, omit = [], isFirstParty, label = "consumer" }) {
  const consumerDir = join(root, label);
  mkdirSync(consumerDir, { recursive: true });
  const manifest = consumerManifest({ consumerDir, packed, direct, overrides, omit });
  writeFileSync(join(consumerDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const install = run("npm", ["install", "--no-audit", "--no-fund"], { cwd: consumerDir, env: sanitizedNpmEnv(root) });
  const findings = verifyConsumer({ consumerDir, packed, install, isFirstParty });
  return { consumerDir, manifest, install: { status: install.status, stderr: install.stderr }, findings };
}

export function firstPartyPredicate(workspace) {
  return (name) => workspace.has(name);
}

// Full run: discover, pack, install, verify, clean up.
export function runTarballInstallCheck({ repoRoot = REPO_ROOT, packageDirs = DEFAULT_PACKAGE_DIRS, versionShift = "minor", overrides = true, omit = [], keep = false } = {}) {
  const workspace = discoverWorkspace(repoRoot);
  const closure = firstPartyClosure(workspace, packageDirs);
  // An omitted name that matches no packed package would remove nothing and
  // let the full overrides block pass; refuse it instead of reporting OK.
  const unknown = omit.filter((name) => !closure.some((entry) => entry.manifest.name === name));
  if (unknown.length > 0) throw new CheckError(`--omit-override names no packed package: ${unknown.join(", ")}`);
  const root = realpathSync(mkdtempSync(join(tmpdir(), "tarball-install-check-")));
  try {
    const packed = packClosure({ repoRoot, closure, root, versionShift });
    const direct = packageDirs.map((dir) => closure.find((entry) => entry.dir === dir.replace(/\/+$/, "")).manifest.name);
    const result = checkInstall({ root, packed, direct, overrides, omit, isFirstParty: firstPartyPredicate(workspace) });
    return { root: keep ? root : null, packed, ...result };
  } finally {
    if (!keep) rmSync(root, RM_OPTIONS);
  }
}

function parseArgs(argv) {
  const options = { packageDirs: [], versionShift: "minor", overrides: true, omit: [], keep: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--as-packed") options.versionShift = "none";
    else if (arg === "--no-overrides") options.overrides = false;
    else if (arg === "--omit-override") {
      const name = argv[++index];
      if (!name || name.startsWith("--")) throw new CheckError("--omit-override needs a package name");
      options.omit.push(name);
    }
    else if (arg === "--keep") options.keep = true;
    else if (arg === "--json") options.json = true;
    else if (arg.startsWith("--")) throw new CheckError(`unknown option ${arg}`);
    else options.packageDirs.push(arg);
  }
  if (options.packageDirs.length === 0) options.packageDirs = DEFAULT_PACKAGE_DIRS;
  return options;
}

// The CLI, returning its exit code. `run` and `io` are injectable so the
// exit contract can be tested without packing.
export function cli(argv, { run = runTarballInstallCheck, io = console } = {}) {
  let options;
  let result;
  try {
    options = parseArgs(argv);
    result = run(options);
  } catch (error) {
    // Every failure before a verdict is "could not run" (exit 2), never a
    // finding (exit 1): a CheckError carries its own message, anything else
    // its stack.
    io.error(`TARBALL INSTALL CHECK COULD NOT RUN — ${error instanceof CheckError ? error.message : (error?.stack ?? String(error))}`);
    return 2;
  }
  const ok = result.findings.length === 0;
  if (options.json) {
    io.log(JSON.stringify({ ok, root: result.root, packed: result.packed.map(({ name, version, integrity }) => ({ name, version, integrity })), findings: result.findings }, null, 2));
  } else {
    if (result.root) io.log(`  [KEEP ] ${result.root}`);
    for (const record of result.packed) io.log(`  [PACK ] ${record.name}@${record.version}`);
    for (const finding of result.findings) io.log(`  [FIND ] [${finding.kind}] ${finding.message}`);
    io.log(
      ok
        ? `TARBALL INSTALL OK — ${result.packed.length} first-party packages installed from their tarballs, one copy each.`
        : "TARBALL INSTALL FAIL — a consumer of these tarballs would get a second registry copy or a failed install; see docs/releasing/tarball-install.md.",
    );
  }
  return ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = cli(process.argv.slice(2));
