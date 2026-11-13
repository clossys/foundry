#!/usr/bin/env node
// tsc-incremental — a package's `tsc -p tsconfig.json` emit, made incremental without changing its output.
//
//   node ../../scripts/tsc-incremental.mjs            incremental build of the package in the cwd
//   node ../../scripts/tsc-incremental.mjs --force    drop this package's build cache first (full rebuild)
//   CLOSSYS_BUILD_FORCE=1 npm run build               the same, for every package the build visits
//
// tsc's own --incremental does the work: its .tsbuildinfo records every input file's content hash, the
// compiler version and the options, and only files whose inputs (or the declarations they depend on,
// including other workspaces' dist/*.d.ts) changed are re-checked and re-emitted. Type errors still
// fail the build: tsc re-reports them from the build info until they are fixed.
//
// The one thing --incremental does not do is notice that its outputs went missing: with the build info
// kept outside dist/ (so dist/ and the packed tarball stay byte-identical), deleting or editing dist/
// would leave tsc believing there is nothing to emit. So the cache also keeps a manifest of every file
// tsc emitted with its sha256; before each run the manifest is verified and any missing or changed
// output drops the build info, which makes that run a full rebuild. A failed run drops the cache too,
// so the next run starts from scratch.
//
// Cache: <repository>/node_modules/.cache/incremental-build/<package>/{tsbuildinfo,emitted.json}.
// `npm run build:clean` at the root removes it for every package.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

export function cacheDirFor(repositoryRoot, packageName) {
  return join(repositoryRoot, "node_modules/.cache/incremental-build", packageName.replace(/^@/, "").replace(/[\\/]/g, "__"));
}

/** True when every file the last successful run emitted is still on disk with the bytes it wrote. */
export function outputsIntact(packageRoot, manifestFile) {
  if (!existsSync(manifestFile)) return false;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  } catch {
    return false;
  }
  if (manifest?.schemaVersion !== 1 || !manifest.files || typeof manifest.files !== "object") return false;
  for (const [file, digest] of Object.entries(manifest.files)) {
    const absolute = resolve(packageRoot, file);
    if (!existsSync(absolute) || sha256(absolute) !== digest) return false;
  }
  return true;
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--force")) {
    console.error("usage: tsc-incremental.mjs [--force]");
    return 2;
  }
  const packageRoot = process.cwd();
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const { name } = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const cache = cacheDirFor(repositoryRoot, name);
  const buildInfo = join(cache, "tsbuildinfo");
  const manifestFile = join(cache, "emitted.json");
  const force = args.includes("--force") || process.env.CLOSSYS_BUILD_FORCE === "1";
  if (force || !outputsIntact(packageRoot, manifestFile)) rmSync(cache, { recursive: true, force: true });
  mkdirSync(cache, { recursive: true });
  const previous = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")).files : {};

  const tsc = createRequire(join(packageRoot, "package.json")).resolve("typescript/bin/tsc");
  const result = spawnSync(process.execPath, [tsc, "-p", "tsconfig.json", "--incremental", "--tsBuildInfoFile", buildInfo, "--listEmittedFiles"], {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 256 * 1024 * 1024,
  });
  const emitted = [];
  for (const line of (result.stdout ?? "").split("\n")) {
    if (line.startsWith("TSFILE: ")) emitted.push(line.slice("TSFILE: ".length).trim());
    else if (line) console.log(line);
  }
  if (result.status !== 0) {
    rmSync(cache, { recursive: true, force: true });
    if (result.error) console.error(`tsc-incremental: ${result.error.message}`);
    return result.status || 1;
  }
  const files = { ...previous };
  for (const file of emitted) {
    const absolute = resolve(packageRoot, file);
    if (absolute === buildInfo) continue;
    const key = relative(packageRoot, absolute).split(sep).join("/");
    files[key] = sha256(absolute);
  }
  const sorted = Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  writeFileSync(`${manifestFile}.tmp`, JSON.stringify({ schemaVersion: 1, files: sorted }) + "\n");
  renameSync(`${manifestFile}.tmp`, manifestFile);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
