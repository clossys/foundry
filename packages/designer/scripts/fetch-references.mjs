#!/usr/bin/env node
// Fetch raw, untouched upstream sources for every approved mapped item into
// packages/designer/references/<registry>/<item>@<version>/ and write
// references/manifest.json (source URL, version, license, sha256 per file).
//
// Downloaded content is data: it is written byte-for-byte and never imported,
// executed or rewritten. Registry JSON items are kept verbatim as <name>.json,
// and the files embedded in them (files[].content) are also written at their
// upstream path so they can be read and diffed directly. The offline check is
// scripts/check-references.mjs.
//
// Usage: node scripts/fetch-references.mjs [--out <dir>] [--registry <id>]
//
// --registry <id> refreshes one registry in place: only that registry's direct
// items and their same-registry dependencies are fetched, and every other
// item, license and hash already in the manifest is kept byte-for-byte, so a
// refresh of one registry can never move the hashes other pins were made from.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outDir = resolve(outIndex >= 0 ? args[outIndex + 1] : join(packageRoot, "references"));
const registryIndex = args.indexOf("--registry");
const only = registryIndex >= 0 ? args[registryIndex + 1] : undefined;
const sources = JSON.parse(readFileSync(join(here, "references-sources.json"), "utf8"));
const registries = sources.registries;
if (only !== undefined && !registries[only]) throw new Error(`--registry ${only}: not in references-sources.json`);
const prior = only ? JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")) : undefined;
const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const byNamespace = new Map(Object.entries(registries).map(([id, reg]) => [reg.namespace, id]));
const HOSTS = new Map([
  ["ui.shadcn.com", "shadcn"],
  ["magicui.design", "magicui"],
  ["diceui.com", "diceui"],
  ["r.assistant-ui.com", "assistant-ui"],
  ["ui.reactflow.dev", "reactflow"],
]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const treeHash = (files) =>
  `sha256:${sha256(
    [...files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((file) => `${file.sha256}  ${file.path}\n`)
      .join(""),
  )}`;

function safePath(path) {
  if (typeof path !== "string" || path.length === 0 || path.includes("\\") || path.startsWith("/")) {
    throw new Error(`unsafe upstream path ${JSON.stringify(path)}`);
  }
  const normal = posix.normalize(path);
  if (normal.startsWith("../") || normal === ".." || normal.split("/").includes("..")) {
    throw new Error(`unsafe upstream path ${JSON.stringify(path)}`);
  }
  return normal;
}

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { redirect: "follow", headers: { accept: "application/json, text/plain, */*" } });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (response.status >= 500 && attempt < 3) throw new Error(`HTTP ${response.status}`);
      return { status: response.status, bytes };
    } catch (error) {
      if (attempt >= 3) throw new Error(`${url}: ${error.message}`);
      await new Promise((done) => setTimeout(done, 500 * attempt));
    }
  }
}

/** Resolve a registryDependencies entry to { registry, name } or { skip: reason }. */
function resolveDependency(parentRegistry, dep) {
  const parent = registries[parentRegistry];
  for (const [pattern, reason] of Object.entries(parent.skipDependencies ?? {})) {
    if (new RegExp(pattern).test(dep)) return { skip: reason };
  }
  if (/^https?:\/\//.test(dep)) {
    // A URL under a listed registry-json source prefix belongs to that registry
    // (several shadcn styles share one host); otherwise fall back to the host.
    for (const [id, reg] of Object.entries(registries)) {
      if (reg.kind !== "registry-json" || !reg.source.includes("{name}")) continue;
      const prefix = reg.source.slice(0, reg.source.indexOf("{name}"));
      if (dep.startsWith(prefix)) return { registry: id, name: dep.slice(prefix.length).replace(/\.json$/, "") };
    }
    const url = new URL(dep);
    const registry = HOSTS.get(url.hostname);
    if (!registry) return { skip: `dependency on an unlisted registry host ${url.hostname}` };
    return { registry, name: url.pathname.split("/").at(-1).replace(/\.json$/, "") };
  }
  const scoped = /^(@[a-z0-9-]+)\/(.+)$/.exec(dep);
  if (scoped) {
    const registry = byNamespace.get(scoped[1]);
    if (!registry) return { skip: `dependency on registry ${scoped[1]}, which is not in this unit's registry list` };
    return { registry, name: scoped[2] };
  }
  // A bare name resolves against the registry the CLI is pointed at: the shadcn
  // core registry by default, or the parent itself for a style registry.
  return { registry: parent.bareDependencies === "self" ? parentRegistry : "shadcn", name: dep };
}

const items = new Map();
const skipped = [...sources.skipped];
const key = (registry, name) => `${registry}/${name}`;

function enqueue(registry, name, { slots = [], direct = false, requiredBy } = {}) {
  const id = key(registry, name);
  let entry = items.get(id);
  if (!entry) {
    entry = { registry, name, slots: new Set(), direct: false, requiredBy: new Set(), state: "queued" };
    items.set(id, entry);
  }
  for (const slot of slots) entry.slots.add(slot);
  if (direct) entry.direct = true;
  if (requiredBy) entry.requiredBy.add(requiredBy);
  return entry;
}

for (const item of sources.direct) {
  if (only && item.registry !== only) continue;
  enqueue(item.registry, item.name, { slots: item.slots, direct: true });
}

const staging = `${outDir}.staging-${process.pid}`;
rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });

function writeFile(dir, path, bytes) {
  const target = join(dir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return { path, sha256: sha256(bytes), bytes: bytes.length };
}

async function fetchItem(entry) {
  const reg = registries[entry.registry];
  const dir = `${entry.registry}/${entry.name}@${reg.version}`;
  const ref = `${reg.namespace}/${entry.name}`;
  const files = [];
  let type;
  let sourceUrl;
  let registryDependencies = [];
  let dependencies;

  if (reg.kind === "registry-json") {
    sourceUrl = reg.special?.[entry.name] ?? reg.source.replace("{name}", entry.name);
    const { status, bytes } = await get(sourceUrl);
    if (status !== 200) return { skip: { ref, reason: `HTTP ${status} from ${sourceUrl}` } };
    let item;
    try {
      item = JSON.parse(bytes.toString("utf8"));
    } catch {
      return { skip: { ref, reason: `not a registry item JSON at ${sourceUrl}` } };
    }
    const jsonName = `${entry.name}.json`;
    files.push({ ...writeFile(join(staging, dir), jsonName, bytes), origin: sourceUrl });
    (item.files ?? []).forEach((file, index) => {
      if (typeof file.content !== "string") return;
      const path = safePath(file.path);
      if (path === jsonName || files.some((f) => f.path === path)) throw new Error(`${ref}: duplicate file path ${path}`);
      files.push({ ...writeFile(join(staging, dir), path, Buffer.from(file.content, "utf8")), origin: `${jsonName}#files[${index}].content` });
    });
    type = item.type ?? "registry:item";
    registryDependencies = item.registryDependencies ?? [];
    dependencies = item.dependencies;
  } else if (reg.kind === "github-files") {
    const def = reg.items?.[entry.name];
    // A mapped name that upstream keeps only as a deprecated alias fetches the alias target.
    const upstreamName = reg.aliases?.[entry.name] ?? entry.name;
    const paths = def ? def.files : (reg.itemFiles ?? []).map((pattern) => pattern.replace("{name}", upstreamName));
    if (paths.length === 0) return { skip: { ref, reason: `no file list for ${ref} in references-sources.json` } };
    for (const path of paths) {
      const url = reg.source.replace("{path}", path);
      const { status, bytes } = await get(url);
      if (status !== 200) return { skip: { ref, reason: `HTTP ${status} from ${url}` } };
      files.push({ ...writeFile(join(staging, dir), safePath(path), bytes), origin: url });
    }
    sourceUrl = files[0].origin;
    type = def?.type ?? reg.itemType ?? "file";
    registryDependencies = def?.registryDependencies ?? [];
  } else {
    throw new Error(`unknown registry kind ${reg.kind}`);
  }

  for (const dep of registryDependencies) {
    const resolved = resolveDependency(entry.registry, dep);
    if (resolved.skip) {
      skipped.push({ ref: dep, reason: `${resolved.skip} (required by ${ref})` });
      continue;
    }
    if (resolved.registry === "tailark-oss" && !registries["tailark-oss"].items[resolved.name]) {
      skipped.push({ ref: dep, reason: `no source listed for this Tailark item (required by ${ref})` });
      continue;
    }
    if (only && resolved.registry !== only) {
      const vendored = prior.items.some((row) => row.registry === resolved.registry && row.name === resolved.name);
      if (!vendored) skipped.push({ ref: dep, reason: `not refreshed by --registry ${only} (required by ${ref})` });
      continue;
    }
    enqueue(resolved.registry, resolved.name, { requiredBy: ref });
  }

  return {
    item: {
      registry: entry.registry,
      name: entry.name,
      version: reg.version,
      dir,
      type,
      sourceUrl,
      license: reg.license,
      direct: entry.direct,
      slots: [...entry.slots].sort(),
      ...(registryDependencies.length ? { registryDependencies } : {}),
      ...(dependencies?.length ? { dependencies } : {}),
      hash: treeHash(files),
      files: files.sort((a, b) => (a.path < b.path ? -1 : 1)),
    },
  };
}

const results = new Map();
for (;;) {
  const batch = [...items.values()].filter((entry) => entry.state === "queued");
  if (batch.length === 0) break;
  for (const entry of batch) entry.state = "fetching";
  for (let i = 0; i < batch.length; i += 6) {
    const chunk = batch.slice(i, i + 6);
    const done = await Promise.all(chunk.map((entry) => fetchItem(entry)));
    chunk.forEach((entry, index) => {
      entry.state = "done";
      results.set(key(entry.registry, entry.name), done[index]);
    });
  }
}

const licenses = [];
for (const [id, reg] of Object.entries(registries)) {
  if (only && id !== only) continue;
  for (const [file, url] of Object.entries(reg.licenseFiles)) {
    const { status, bytes } = await get(url);
    if (status !== 200) throw new Error(`license ${url}: HTTP ${status}`);
    licenses.push({ ...writeFile(staging, `${id}/${file}`, bytes), sourceUrl: url });
  }
}

const manifestItems = [];
for (const [id, result] of results) {
  const entry = items.get(id);
  if (result.skip) {
    skipped.push({ ...result.skip, ...(entry.slots.size ? { slots: [...entry.slots].sort() } : {}) });
    rmSync(join(staging, `${entry.registry}/${entry.name}@${registries[entry.registry].version}`), { recursive: true, force: true });
    continue;
  }
  const requiredBy = [...entry.requiredBy].sort();
  manifestItems.push({ ...result.item, ...(requiredBy.length ? { requiredBy } : {}) });
}
manifestItems.sort((a, b) => (a.dir < b.dir ? -1 : 1));

// One skipped row per ref, slots and reasons merged.
const skippedByRef = new Map();
for (const row of skipped) {
  const prior = skippedByRef.get(row.ref);
  if (!prior) {
    skippedByRef.set(row.ref, { ref: row.ref, ...(row.slots ? { slots: [...row.slots] } : {}), reasons: new Set([row.reason]) });
  } else {
    if (row.slots) prior.slots = [...new Set([...(prior.slots ?? []), ...row.slots])];
    prior.reasons.add(row.reason);
  }
}
const skippedRows = [...skippedByRef.values()]
  .map(({ reasons, ...row }) => ({ ...row, ...(row.slots ? { slots: [...row.slots].sort() } : {}), reason: [...reasons].sort().join("; ") }))
  .sort((a, b) => (a.ref < b.ref ? -1 : 1));

// In --registry mode the other registries' rows are carried over unchanged.
const ownedBy = (ref) => ref.startsWith(`${registries[only]?.namespace}/`) || ref.includes(`(required by ${registries[only]?.namespace}/`);
const keptItems = only ? prior.items.filter((row) => row.registry !== only) : [];
const keptLicenses = only ? prior.licenses.filter((row) => !row.path.startsWith(`${only}/`)) : [];
const refreshedRefs = new Set(skippedRows.map((row) => row.ref));
const keptSkipped = only ? prior.skipped.filter((row) => !refreshedRefs.has(row.ref) && !ownedBy(row.ref) && !ownedBy(row.reason)) : [];
const allItems = [...keptItems, ...manifestItems].sort((a, b) => (a.dir < b.dir ? -1 : 1));
const allLicenses = [...keptLicenses, ...licenses].sort((a, b) => (a.path < b.path ? -1 : 1));
const allSkipped = [...keptSkipped, ...skippedRows].sort((a, b) => (a.ref < b.ref ? -1 : 1));
const fetchedAtOf = (id) => (only && id !== only ? prior.registries[id]?.fetchedAt : now);

const manifest = {
  schema: "clossys.references-manifest/1",
  package: sources.package,
  fetchedAt: only ? prior.fetchedAt : now,
  fetchedWith: sources.fetchedWith,
  hashAlgorithm: "sha256-tree/1",
  registries: Object.fromEntries(
    Object.entries(registries).map(([id, reg]) => [
      id,
      {
        namespace: reg.namespace,
        source: reg.source,
        version: reg.version,
        versionBasis: reg.versionBasis,
        upstream: reg.upstream,
        ...(reg.style ? { style: reg.style } : {}),
        ...(fetchedAtOf(id) ? { fetchedAt: fetchedAtOf(id) } : {}),
        license: reg.license,
        licenseFiles: Object.keys(reg.licenseFiles).map((file) => `${id}/${file}`),
      },
    ]),
  ),
  licenses: allLicenses,
  items: allItems,
  skipped: allSkipped,
};

if (only) {
  // Swap in only the refreshed registry's trees and licenses.
  rmSync(join(outDir, only), { recursive: true, force: true });
  if (existsSync(join(staging, only))) renameSync(join(staging, only), join(outDir, only));
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  rmSync(staging, { recursive: true, force: true });
} else {
  writeFileSync(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  if (existsSync(outDir)) rmSync(outDir, { recursive: true });
  renameSync(staging, outDir);
}

const counts = {};
for (const item of manifestItems) {
  counts[item.registry] ??= { direct: 0, transitive: 0 };
  counts[item.registry][item.direct ? "direct" : "transitive"] += 1;
}
console.log(JSON.stringify({ out: outDir, items: manifestItems.length, perRegistry: counts, skipped: skippedRows.length }, null, 2));
