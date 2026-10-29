// Descriptor measurements are separate from the frozen historical report gate.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createSurfaceSourceScanner } from "./surface-source-scan.mjs";

export function measureFoundrySurfaces(root, buildSurfaceConsumption) {
  const repo = resolve(root, "../.."), src = resolve(root, "src");
  const read = path => readFileSync(resolve(root, path), "utf8");
  const json = path => JSON.parse(read(path));
  const inventory = Object.fromEntries(["tokens", "assets", "components", "sections", "frames"].map(layer => [layer, json(`src/catalog/slots/${layer}.json`)]));
  const docs = readdirSync(resolve(src, "catalog/fills/foundry")).filter(file => /^(?:components|sections|frames)\.(?!coverage\.)[^/]+\.json$/.test(file)).sort().map(file => json(`src/catalog/fills/foundry/${file}`));
  const metadata = doc => doc.$extensions["com.clossys.fill"];
  const packageRoots = ["designer", "publisher"].map(name => ({ name: JSON.parse(readFileSync(resolve(repo, `packages/${name}/package.json`), "utf8")).name, root: `packages/${name}/src` }));
  const packages = Object.fromEntries(packageRoots.map(row => [row.name, row.root]));
  const cache = new Map();
  const sourceRead = path => {
    if (!packageRoots.some(row => path.startsWith(row.root + "/")) || !/\.[cm]?tsx?$/.test(path) || /\.(?:test|check|spec|stories)\./.test(path)) return undefined;
    if (cache.has(path)) return cache.get(path);
    const absolute = resolve(repo, path);
    if (!existsSync(absolute)) return undefined;
    if (!lstatSync(absolute).isFile() || lstatSync(absolute).isSymbolicLink()) throw new Error("Surface source must be a regular repository file");
    const content = readFileSync(absolute, "utf8"); cache.set(path, content); return content;
  };
  const graph = createSurfaceSourceScanner({ read: sourceRead, packages });
  for (const doc of docs) {
    const meta = metadata(doc), entry = Object.values(doc[meta.slot.split(".")[0]])[0];
    const pointers = [meta.pin?.export, ...(meta.slot.startsWith("components.") ? Object.values(entry.propMap ?? {}) : [])];
    for (const pointer of pointers) if (typeof pointer === "string") graph.addOwner(graph.pointer(meta.pin?.package, pointer), meta.slot);
  }
  const fills = docs.map(metadata).filter(meta => /^(?:sections|frames)\./.test(meta.slot)).map(meta => ({ id: meta.id, slot: meta.slot, source: meta.source, pin: meta.pin }));
  if (new Set(fills.map(row => row.slot)).size !== fills.length) throw new Error("Duplicate surface measurement");
  const sourceScans = fills.map(fill => graph.scan({ fill: fill.id, packageName: fill.pin?.package, pointer: fill.pin?.export }));
  const input = { ...inventory, fills, sourceScans, themeCss: read("styles/theme.css") + "\n" + read("styles/theme-keys.css") };
  const report = buildSurfaceConsumption(input);
  const measurements = Object.fromEntries(report.fills.map(row => {
    if (row.scanStatus !== "lower-bound" || !row.sourceFiles.length) throw new Error(`Surface source measurement unavailable: ${row.slot}`);
    const scan = sourceScans.find(scan => scan.fill === row.id);
    return [row.slot, { pin: row.pin, consumption: { scanStatus: row.scanStatus, sourceFiles: scan.files.map(file => ({ path: file.path, sha256: createHash("sha256").update(sourceRead(file.path)).digest("hex") })), scannedReads: row.scannedReads, scannedComposes: row.scannedComposes, unresolved: row.unresolved } }];
  }));
  return { measurements, report, input };
}
