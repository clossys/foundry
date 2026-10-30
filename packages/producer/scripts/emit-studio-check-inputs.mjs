#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { libraryHash, stableStringify } from "@clossys/designer/catalog";
import { parseConsumerDogfoodContract } from "@clossys/designer/catalog/dogfood/node";
import { compileSelection } from "../dist/server/selection.js";
import { studioProjectionFiles } from "../dist/server/selection-projection.js";
import { readStudioDesignerLibrary } from "../dist/server/theme.js";
import { prepareStudioSelection } from "../dist/server/selection-defaults.js";
import { readPageCheckSource } from "../dist/check/page-manifest.js";
import { discoverRoot } from "../dist/cli/root.js";

const producerRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = resolve(producerRoot, "../..");
function requireSourceHead(sourceHead) {
  const git = (...args) => execFileSync("git", ["-C", repositoryRoot, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (git("rev-parse", "HEAD") !== sourceHead || git("status", "--porcelain=v1", "--untracked-files=normal")) throw new Error("Studio source snapshot requires the same clean source head as the native build");
}
const portable = value => value.split(sep).join("/");
const hash = value => createHash("sha256").update(value).digest("hex");
const sourceFile = file => /\.(?:tsx?|jsx?|json|css)$/.test(file) && !/\.(?:test|spec|stories|check)\.[jt]sx?$|\.d\.ts$/.test(file);
function imports(file, content) {
  if (!/\.[cm]?[jt]sx?$/.test(file)) return [];
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length) throw new Error(`Studio check source has invalid syntax: ${file}`);
  return ts.preProcessFile(content, true, true).importedFiles.map(row => row.fileName);
}
const boundary = module => /^(?:react(?:-dom)?(?:\/|$)|next(?:\/|$)|react-aria-components(?:\/|$)|node:)/.test(module);
function inside(root, file) { const part = relative(root, file); return part === "" || part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part); }
function artifactPath(root, name) {
  if (!name || isAbsolute(name) || name.includes("\\") || name.split("/").some(part => !part || part === "." || part === "..") || !inside(root, resolve(root, name))) throw new Error("Invalid Studio artifact path");
  return resolve(root, name);
}
async function regular(file) {
  for (let cursor = file;; cursor = dirname(cursor)) {
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error("Studio check source cannot follow symbolic links");
    if (dirname(cursor) === cursor) break;
  }
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new Error("Studio check source must be a regular file");
    return new TextDecoder("utf-8", { fatal: true }).decode(await handle.readFile());
  } finally { await handle.close(); }
}
async function moduleFile(base) {
  const bare = base.replace(/\.[cm]?jsx?$/, "");
  for (const candidate of [...new Set([base, ...[".tsx", ".ts", ".js", ".jsx", ".json", ".css"].map(extension => bare + extension), join(bare, "index.tsx"), join(bare, "index.ts")])]) {
    try { const info = await lstat(candidate); if (info.isSymbolicLink()) throw new Error("Studio check source cannot be a symbolic link"); if (info.isFile()) return candidate; }
    catch (error) { if (!["ENOENT", "ENOTDIR"].includes(error.code)) throw error; }
  }
  throw new Error(`Unresolved Studio import: ${base}`);
}

/** Census real App Router pages and copy the unchanged sources their imports reference. */
export async function studioSourcePacket(studioRoot = join(producerRoot, "studio")) {
  const files = new Map(), pages = [], modules = new Set();
  const snapshotRoot = dirname(resolve(studioRoot));
  const producerManifest = JSON.parse(await regular(join(producerRoot, "package.json")));
  const repository = producerManifest.repository.url;
  const designerName = Object.keys(producerManifest.dependencies).find(name => name.endsWith("/designer"));
  async function copySource(file) {
    if (!inside(snapshotRoot, file)) throw new Error(`Studio local import escapes its package: ${portable(relative(studioRoot, file))}`);
    const name = portable(relative(snapshotRoot, file));
    if (files.has(name)) return;
    const content = await regular(file);
    files.set(name, content);
    if (/^studio\/app\/(?:.*\/)?page\.tsx$/.test(name)) pages.push(name);
    for (const module of imports(file, content)) {
      if (module.startsWith(".")) await copySource(await moduleFile(resolve(dirname(file), module)));
      else modules.add(module);
    }
  }
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (["node_modules", ".next", ".git", "checks"].includes(entry.name)) continue;
      const file = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("Studio source snapshot cannot follow symbolic links");
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && sourceFile(file)) await copySource(file);
    }
  }
  await walk(studioRoot);
  const sources = {}, visited = new Set();
  async function packageOwner(file) {
    for (let directory = dirname(file);;) {
      try { return { root: directory, manifest: JSON.parse(await regular(join(directory, "package.json"))) }; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      const parent = dirname(directory); if (parent === directory) throw new Error("Studio imported package has no manifest"); directory = parent;
    }
  }
  async function copyModule(file, owner) {
    const name = `modules/${owner.manifest.name.replace(/^@/, "")}/${portable(relative(owner.root, file))}`;
    if (!inside(owner.root, file)) throw new Error("Studio project import escapes its package");
    if (visited.has(file)) return name;
    visited.add(file);
    const content = await regular(file); files.set(name, content);
    for (const module of imports(file, content)) {
      if (module.startsWith(".")) await copyModule(await moduleFile(resolve(dirname(file), module)), owner);
      else modules.add(module);
    }
    return name;
  }
  // Actual import declarations supply mappings. Protected framework and Designer
  // boundaries keep their native installed-package resolution.
  for (const module of modules) {
    if (boundary(module) || module === designerName || module.startsWith(designerName + "/")) continue;
    const url = import.meta.resolve(module);
    if (!url.startsWith("file:")) continue;
    const file = await realpath(fileURLToPath(url)), owner = await packageOwner(file);
    if (owner.manifest.repository?.url !== repository) continue;
    sources[module] = await copyModule(file, owner);
  }
  const contract = parseConsumerDogfoodContract({ version: 1, sources: Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a < b ? -1 : 1)), pages: pages.sort() });
  files.set("consumer-dogfood.json", stableStringify(contract));
  return { files, contract };
}

/** A fresh output generation cannot inherit a stale successful selection. */
export async function emitStudioCheckInputs({ root, output, sourceHead }) {
  if (typeof output !== "string" || !output.trim()) throw new Error("Studio check emit requires a fresh --out sidecar directory");
  const receipt = await readPageCheckSource();
  if (receipt.sourceDirty || receipt.sourceHead !== sourceHead) throw new Error("Studio check emit requires its clean native build source head");
  requireSourceHead(sourceHead);
  output = resolve(output);
  if (inside(join(producerRoot, "studio"), output)) throw new Error("Studio check output cannot replace its source tree");
  const packet = await studioSourcePacket();
  const consumer = discoverRoot(resolve(root));
  const stored = await readStudioDesignerLibrary(consumer);
  const prepared = await prepareStudioSelection(stored);
  let library;
  await compileSelection(consumer, prepared.input, prepared.leaves, libraryHash(prepared.input.library), async projection => { library = studioProjectionFiles(projection); });
  if (!library) throw new Error("Studio did not emit a checked selection");
  requireSourceHead(sourceHead);
  return writeStudioCheckInputs({ output, sourceHead, selectionHash: libraryHash(prepared.input.library), packet, library });
}

export async function writeStudioCheckInputs({ output, sourceHead, selectionHash, packet, library }) {
  output = resolve(output);
  if (!/^[a-f0-9]{40}$/.test(sourceHead)) throw new Error("Studio check output requires an exact source head");
  const contract = parseConsumerDogfoodContract(packet.contract);
  for (const name of [...contract.pages, ...Object.values(contract.sources)]) {
    if (!packet.files.has(name)) throw new Error(`Studio check source snapshot is incomplete: ${name}`);
  }
  for (const name of ["resolved.json", "component-index.ts", "surface-index.ts"]) {
    if (!library.has(name)) throw new Error(`Studio check selection is incomplete: ${name}`);
  }
  if (JSON.parse(library.get("resolved.json")).selectionHash !== selectionHash) throw new Error("Studio check selection hash is stale");
  const files = new Map([...packet.files].map(([name, content]) => [`site/${name}`, content]));
  for (const [name, content] of library) files.set(`library/${name}`, content);
  for (const name of files.keys()) artifactPath(output, name);
  if (packet.files.get("consumer-dogfood.json") !== stableStringify(contract)) throw new Error("Studio check contract bytes differ from the generated contract");
  const manifest = { schemaVersion: 1, sourceHead, selectionHash, site: "site", library: "library", contract: "site/consumer-dogfood.json", files: Object.fromEntries([...files].sort(([a], [b]) => a < b ? -1 : 1).map(([name, content]) => [name, hash(content)])) };
  for (let cursor = output;; cursor = dirname(cursor)) {
    try { if ((await lstat(cursor)).isSymbolicLink()) throw new Error("Studio check output cannot follow symbolic links"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (dirname(cursor) === cursor) break;
  }
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // Refuse an old or partial generation; evidence is never deleted.
  for (const [name, content] of [...files].sort(([a], [b]) => a < b ? -1 : 1)) {
    const target = artifactPath(output, name); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content, { flag: "wx" });
  }
  await writeFile(join(output, "manifest.json"), stableStringify(manifest), { flag: "wx" });
  return { ...manifest, output, site: join(output, manifest.site), library: join(output, manifest.library), contract: join(output, manifest.contract) };
}

export async function main(args = process.argv.slice(2)) {
  const options = {};
  const flags = new Map([["--root", "root"], ["--out", "output"], ["--source-head", "sourceHead"]]);
  for (let index = 0; index < args.length; index++) {
    const key = flags.get(args[index]);
    if (!key || !args[index + 1] || args[index + 1].startsWith("--") || options[key] !== undefined) throw new Error("Usage: emit-studio-check-inputs.mjs --root CONSUMER --source-head SHA --out FRESH_DIRECTORY");
    options[key] = args[++index];
  }
  if (!options.root || !options.output || !/^[a-f0-9]{40}$/.test(options.sourceHead ?? "")) throw new Error("Studio check emit requires --root, --out and a full --source-head");
  return emitStudioCheckInputs(options);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await main()) + "\n"); }
  catch (error) { process.stdout.write(JSON.stringify({ status: "ERROR", exitCode: 2, message: error.message }) + "\n"); process.exitCode = 2; }
}
