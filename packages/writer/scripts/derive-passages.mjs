#!/usr/bin/env node
/** Derive Writer's passage catalog from Designer's declared copy schemas. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultPaths = {
  sourceIa: resolve(packageRoot, "../designer/src/catalog/ia/sections.json"),
  sourceSlots: resolve(packageRoot, "../designer/src/catalog/slots/sections.json"),
  outputIa: resolve(packageRoot, "src/catalog/ia/passages.json"),
  outputSlots: resolve(packageRoot, "src/catalog/slots/passages.json"),
};
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const sectionId = value => typeof value === "string" && /^sections\.[a-z][a-z0-9-]*$/.test(value);
const passageId = id => `passages.${id.slice("sections.".length)}`;
const requireSource = (condition, message) => { if (!condition) throw new Error(message); };
const canonical = value => `${JSON.stringify(value, null, 2)}\n`;

/** Pure derivation: copy is an opaque snapshot, never inferred from section slots. */
export function derivePassages(sourceIa, sourceSlots) {
  requireSource(object(sourceIa) && sourceIa.layer === "sections" && Array.isArray(sourceIa.nodes) && sourceIa.nodes.length > 0, "Source IA requires sections layer and L1 nodes");
  requireSource(Array.isArray(sourceSlots) && sourceSlots.length > 0, "Source section slots must be a nonempty array");
  const sections = new Map();
  for (const row of sourceSlots) {
    requireSource(object(row) && sectionId(row.id) && row.layer === "sections", "Source slot requires a sections id and layer");
    requireSource(!sections.has(row.id), `Duplicate section slot: ${row.id}`);
    requireSource(object(row.contract) && row.contract.kind === "section", `Missing section contract: ${row.id}`);
    requireSource(row.contract.passageSchema === passageId(row.id), `Source passageSchema must pair with ${row.id}`);
    requireSource(object(row.contract.copy) && typeof row.contract.copy.sourceLocale === "string" && row.contract.copy.sourceLocale.length > 0 && Array.isArray(row.contract.copy.fields), `Missing copy schema: ${row.id}`);
    sections.set(row.id, row);
  }

  const placements = new Set();
  const nodeIds = new Set();
  const checkNode = node => {
    requireSource(object(node) && typeof node.id === "string" && node.id.length > 0 && typeof node.label === "string" && node.label.length > 0, "Source IA node requires id and label");
    requireSource(!nodeIds.has(node.id), `Duplicate IA node: ${node.id}`);
    nodeIds.add(node.id);
  };
  const ia = structuredClone(sourceIa);
  ia.layer = "passages";
  for (const l1 of ia.nodes) {
    checkNode(l1);
    requireSource(Array.isArray(l1.children) && l1.children.length > 0 && !Object.hasOwn(l1, "leaves"), `Source L1 requires L2 children: ${l1.id}`);
    for (const l2 of l1.children) {
      checkNode(l2);
      requireSource(Array.isArray(l2.leaves) && l2.leaves.length > 0 && !Object.hasOwn(l2, "children"), `Source L2 requires leaves: ${l2.id}`);
      l2.leaves = l2.leaves.map(id => {
        requireSource(sectionId(id), `Invalid section placement: ${String(id)}`);
        requireSource(sections.has(id), `Unknown section placement: ${id}`);
        requireSource(!placements.has(id), `Duplicate section placement: ${id}`);
        placements.add(id);
        return passageId(id);
      });
    }
  }
  for (const id of sections.keys()) requireSource(placements.has(id), `Missing section placement: ${id}`);
  const slots = sourceSlots.map(row => ({
    id: row.contract.passageSchema,
    layer: "passages",
    contract: {
      kind: "passage",
      source: "writer",
      sectionId: row.id,
      passageSchema: row.contract.passageSchema,
      copy: structuredClone(row.contract.copy),
    },
    requires: [],
    status: "draft",
  }));
  return { ia, slots };
}

/** Exit codes: 0 current/generated, 1 stale, 2 invalid invocation or source. */
export function run({ args = [], paths = defaultPaths, stdout = text => process.stdout.write(text), stderr = text => process.stderr.write(text) } = {}) {
  if (!(args.length === 0 || (args.length === 1 && args[0] === "--check"))) {
    stderr("Usage: node packages/writer/scripts/derive-passages.mjs [--check]\n");
    return 2;
  }
  try {
    const result = derivePassages(JSON.parse(readFileSync(paths.sourceIa, "utf8")), JSON.parse(readFileSync(paths.sourceSlots, "utf8")));
    const outputs = [[paths.outputIa, canonical(result.ia)], [paths.outputSlots, canonical(result.slots)]];
    if (args[0] === "--check") {
      const stale = outputs.filter(([path, expected]) => {
        try { return readFileSync(path, "utf8") !== expected; }
        catch (error) { if (error.code === "ENOENT") return true; throw error; }
      });
      if (stale.length > 0) {
        stderr(`Passage catalog stale: ${stale.map(([path]) => path).join(", ")}\n`);
        return 1;
      }
      stdout(`Passage catalog current: ${result.slots.length} sections, ${result.slots.length} passages\n`);
      return 0;
    }
    for (const [path, content] of outputs) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
    stdout(`Passage catalog generated: ${result.slots.length} sections, ${result.slots.length} passages\n`);
    return 0;
  } catch (error) {
    stderr(`Cannot derive passages: ${error.message}\n`);
    return 2;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = run({ args: process.argv.slice(2) });
}
