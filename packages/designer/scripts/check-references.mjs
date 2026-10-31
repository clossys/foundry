#!/usr/bin/env node
// Offline proof that packages/designer/references/ is byte-identical to its
// manifest: every listed file exists with the recorded sha256 and size, every
// item's sha256-tree/1 hash matches its files, files extracted from a registry
// item JSON still equal that JSON's files[].content, every registry keeps its
// license file, and nothing unlisted sits in the tree.
//
// Usage: node scripts/check-references.mjs [--root <references dir>] [--json]
// Exit 0 when clean, 1 on any finding, 2 on a usage error.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST = "manifest.json";
const SCHEMA = "clossys.references-manifest/1";
const ALGORITHM = "sha256-tree/1";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** sha256-tree/1, the same algorithm as @clossys/producer's treeHash. */
export function treeHash(files) {
  const lines = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((file) => `${file.sha256}  ${file.path}\n`)
    .join("");
  return `sha256:${sha256(lines)}`;
}

function walk(root) {
  const out = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const stat = lstatSync(full);
      if (stat.isDirectory()) visit(full);
      else out.push({ path: relative(root, full).split(sep).join("/"), file: stat.isFile() });
    }
  };
  visit(root);
  return out;
}

const SAFE = (path) => typeof path === "string" && path.length > 0 && !path.startsWith("/") && !path.includes("\\") && !path.split("/").includes("..");

export function checkReferences(root) {
  const findings = [];
  const add = (path, message) => findings.push({ path, message });
  const manifestPath = join(root, MANIFEST);
  if (!existsSync(manifestPath)) {
    add(MANIFEST, "missing");
    return { ok: false, findings, counts: {} };
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    add(MANIFEST, `not JSON: ${error.message}`);
    return { ok: false, findings, counts: {} };
  }
  if (manifest.schema !== SCHEMA) add(MANIFEST, `schema must be ${SCHEMA}`);
  if (manifest.hashAlgorithm !== ALGORITHM) add(MANIFEST, `hashAlgorithm must be ${ALGORITHM}`);
  for (const field of ["registries", "licenses", "items", "skipped"]) {
    if (manifest[field] === undefined) add(MANIFEST, `missing ${field}`);
  }
  const registries = manifest.registries ?? {};
  const tracked = new Set([MANIFEST]);

  const verifyFile = (path, expected) => {
    if (!SAFE(path)) return add(path, "unsafe path in manifest");
    tracked.add(path);
    const full = join(root, path);
    if (!existsSync(full) || !lstatSync(full).isFile()) return add(path, "missing");
    const bytes = readFileSync(full);
    if (bytes.length !== expected.bytes) add(path, `size ${bytes.length} differs from manifest ${expected.bytes}`);
    const actual = sha256(bytes);
    if (actual !== expected.sha256) add(path, `sha256 ${actual} differs from manifest ${expected.sha256}`);
    return bytes;
  };

  const licensePaths = new Set();
  for (const license of manifest.licenses ?? []) {
    verifyFile(license.path, license);
    licensePaths.add(license.path);
  }
  for (const [id, registry] of Object.entries(registries)) {
    if (!registry.licenseFiles?.length) add(`${MANIFEST}#registries.${id}`, "no license file recorded");
    for (const path of registry.licenseFiles ?? []) {
      if (!licensePaths.has(path)) add(path, `license file of registry ${id} is not listed under licenses`);
    }
  }

  const dirs = new Set();
  const counts = {};
  for (const item of manifest.items ?? []) {
    const where = item.dir ?? `${item.registry}/${item.name}`;
    const registry = registries[item.registry];
    if (!registry) add(where, `unknown registry ${item.registry}`);
    const expectedDir = `${item.registry}/${item.name}@${item.version}`;
    if (item.dir !== expectedDir) add(where, `dir must be ${expectedDir}`);
    if (registry && item.version !== registry.version) add(where, `version ${item.version} differs from registry version ${registry.version}`);
    if (dirs.has(item.dir)) add(where, "duplicate item directory");
    dirs.add(item.dir);
    if (!Array.isArray(item.files) || item.files.length === 0) {
      add(where, "item lists no files");
      continue;
    }
    counts[item.registry] = (counts[item.registry] ?? 0) + 1;
    const contents = new Map();
    for (const file of item.files) {
      const bytes = verifyFile(`${item.dir}/${file.path}`, file);
      if (bytes) contents.set(file.path, bytes);
    }
    if (treeHash(item.files) !== item.hash) add(where, `item hash ${item.hash} does not match its file list`);

    // Files extracted from a registry item JSON must still equal its files[].content.
    for (const file of item.files) {
      const origin = /^(.+\.json)#files\[(\d+)\]\.content$/.exec(file.origin ?? "");
      if (!origin) continue;
      const source = contents.get(origin[1]);
      if (!source) {
        add(`${item.dir}/${file.path}`, `origin ${origin[1]} is not a file of this item`);
        continue;
      }
      let entry;
      try {
        entry = JSON.parse(source.toString("utf8")).files?.[Number(origin[2])];
      } catch {
        add(`${item.dir}/${origin[1]}`, "registry item JSON does not parse");
        continue;
      }
      const extracted = contents.get(file.path);
      if (!entry || typeof entry.content !== "string" || entry.path !== file.path) {
        add(`${item.dir}/${file.path}`, `${origin[1]} files[${origin[2]}] does not describe this file`);
      } else if (extracted && !Buffer.from(entry.content, "utf8").equals(extracted)) {
        add(`${item.dir}/${file.path}`, `differs from ${origin[1]} files[${origin[2]}].content`);
      }
    }
  }

  for (const entry of walk(root)) {
    if (!entry.file) add(entry.path, "not a regular file");
    else if (!tracked.has(entry.path)) add(entry.path, "not listed in the manifest");
  }
  return { ok: findings.length === 0, findings, counts, skipped: (manifest.skipped ?? []).length };
}

function main(argv) {
  const json = argv.includes("--json");
  const rootIndex = argv.indexOf("--root");
  if (rootIndex >= 0 && !argv[rootIndex + 1]) {
    console.error("usage: check-references.mjs [--root <dir>] [--json]");
    return 2;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const root = resolve(rootIndex >= 0 ? argv[rootIndex + 1] : join(here, "..", "references"));
  const result = checkReferences(root);
  if (json) {
    console.log(JSON.stringify({ root, ...result }, null, 2));
  } else if (result.ok) {
    const items = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
    console.log(`references: ${items} items across ${Object.keys(result.counts).length} registries match the manifest (${result.skipped} skipped refs listed)`);
  } else {
    for (const finding of result.findings) console.error(`references: ${finding.path}: ${finding.message}`);
    console.error(`references: ${result.findings.length} finding(s)`);
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
