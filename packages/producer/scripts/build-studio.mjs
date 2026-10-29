#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { cp, lstat, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const producerDir = fileURLToPath(new URL("../", import.meta.url));
const studioDir = join(producerDir, "studio");
const outputDir = join(producerDir, "dist", "studio");

async function requirePath(path, kind, message) {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!info || (kind === "file" ? !info.isFile() : !info.isDirectory())) {
    throw new Error(message);
  }
}

function childPath(root, name) {
  if (typeof name !== "string" || isAbsolute(name)) {
    throw new Error("Next standalone app path must be relative.");
  }
  const target = resolve(root, name);
  const part = relative(root, target);
  if (part === ".." || part.startsWith(`..${sep}`) || isAbsolute(part)) {
    throw new Error("Next standalone app path escapes the standalone directory.");
  }
  return target;
}

async function refuseSymlink(path) {
  try {
    if ((await lstat(path)).isSymbolicLink()) {
      throw new Error("Refusing to replace Studio output through a symbolic link.");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

const portable = (path) => path.split(sep).join("/");

/** Copy real Next output, preserving its monorepo layout and traced dependencies. */
export async function packageStandalone(appDir, destination) {
  // The only directory this script removes is the dedicated dist/studio output.
  if (destination !== join(dirname(appDir), "dist", "studio")) {
    throw new Error("Studio output must be the package's dist/studio directory.");
  }
  const buildDir = join(appDir, ".next");
  const requiredFiles = join(buildDir, "required-server-files.json");
  await requirePath(requiredFiles, "file", "Next build is missing .next/required-server-files.json.");
  const required = JSON.parse(await readFile(requiredFiles, "utf8"));
  if (required.config?.output !== "standalone") {
    throw new Error('Studio Next config must set output: "standalone".');
  }
  const standaloneDir = join(buildDir, "standalone");
  const standaloneApp = childPath(standaloneDir, required.relativeAppDir);
  const serverEntry = portable(relative(standaloneDir, join(standaloneApp, "server.js")));
  await requirePath(join(standaloneApp, "server.js"), "file", "Next standalone output is missing the Studio server.js entry.");
  await requirePath(join(buildDir, "static"), "directory", "Next build is missing .next/static assets.");
  const publicSource = join(appDir, "public");
  let hasPublic = false;
  try {
    const info = await stat(publicSource);
    if (!info.isDirectory()) throw new Error("Studio public path must be a directory.");
    hasPublic = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  await refuseSymlink(dirname(destination));
  await refuseSymlink(destination);
  await mkdir(dirname(destination), { recursive: true });
  await rm(destination, { recursive: true, force: true });
  await cp(standaloneDir, destination, { recursive: true, verbatimSymlinks: true });
  const targetApp = childPath(destination, required.relativeAppDir);
  // Next emits a CommonJS launcher; isolate it from Producer's ESM scope.
  await writeFile(join(targetApp, "package.json"), `${JSON.stringify({ private: true, type: "commonjs" }, null, 2)}\n`);
  await cp(join(buildDir, "static"), join(targetApp, ".next", "static"), { recursive: true, verbatimSymlinks: true });
  if (hasPublic) {
    await cp(publicSource, join(targetApp, "public"), { recursive: true, verbatimSymlinks: true });
  }
  // All paths are relative to dist/studio; no build-machine paths or timestamps.
  const manifest = {
    schemaVersion: 1,
    serverEntry,
    staticDir: portable(relative(destination, join(targetApp, ".next", "static"))),
    publicDir: hasPublic ? portable(relative(destination, join(targetApp, "public"))) : null,
  };
  await writeFile(join(destination, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function buildStudio(args = process.argv.slice(2)) {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    console.log("Usage: node packages/producer/scripts/build-studio.mjs\nBuild the Studio Next app and copy standalone output into packages/producer/dist/studio.");
    return 0;
  }
  if (args.length) throw new Error("Unexpected arguments. Use --help for usage.");
  await requirePath(studioDir, "directory", "Studio app is missing: packages/producer/studio. Add the Studio app before building it.");
  const require = createRequire(join(studioDir, "package.json"));
  let nextCli;
  try {
    nextCli = require.resolve("next/dist/bin/next");
  } catch {
    throw new Error("Next CLI is not installed for Studio. Install the repository dependencies before building.");
  }
  const result = spawnSync(process.execPath, [nextCli, "build", studioDir], {
    cwd: producerDir,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Studio Next build stopped by ${result.signal}.`);
  if (result.status !== 0) return result.status ?? 1;
  const manifest = await packageStandalone(studioDir, outputDir);
  console.log(`Studio standalone ready: dist/studio/${manifest.serverEntry}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await buildStudio();
  } catch (error) {
    console.error(`Studio build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
