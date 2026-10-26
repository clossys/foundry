#!/usr/bin/env node
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks, stripTypeScriptTypes } from "node:module";

// Foundry's cross-layer usage graph, derived only from existing producers. Freshness only: not a conformance clearance.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(root, "src");
const [mode, ...extra] = process.argv.slice(2);
if (!["--check", "--write"].includes(mode) || extra.length) {
  console.error("usage: usage-graph.mjs --check|--write"); process.exitCode = 2;
} else {
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier.endsWith(".js") && context.parentURL?.startsWith(pathToFileURL(src).href + "/")) {
        const target = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
        if (existsSync(target)) return { url: target.href, shortCircuit: true };
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.startsWith(pathToFileURL(src).href + "/") && url.endsWith(".ts")) return { format: "module", source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), { mode: "transform" }), shortCircuit: true };
      return next(url, context);
    },
  });
  const { loadCatalog } = await import(pathToFileURL(resolve(src, "catalog-core/index.ts")).href);
  const { consumptionReport } = await import(pathToFileURL(resolve(src, "catalog-core/relationships.ts")).href);
  const { buildUsageGraph, serializeUsageGraph } = await import(pathToFileURL(resolve(src, "catalog-core/usage-graph.ts")).href);
  const json = path => JSON.parse(readFileSync(resolve(src, path), "utf8"));
  const components = json("catalog/reports/components-consumption.json"), surfaces = json("catalog/reports/sections-frames-consumption.json");
  const inventory = Object.fromEntries(["tokens", "assets", "components", "sections", "frames"].map(layer => [layer, json(`catalog/slots/${layer}.json`).map(slot => slot.id).sort()]));
  // Foundry's own selection basis: the foundry fill for a leaf when one exists, else its foundry-baseline fill.
  const catalog = loadCatalog(), meta = fill => fill.$extensions["com.clossys.fill"];
  const candidates = new Set([...catalog.fills.map(fill => meta(fill).id), ...components.fills.map(fill => fill.id), ...surfaces.fills.map(fill => fill.id)]);
  const selection = Object.fromEntries(Object.values(inventory).flat().flatMap(leaf => {
    const fill = [`foundry/${leaf}`, `foundry-baseline/${leaf}`].find(id => candidates.has(id));
    return fill ? [[leaf, fill]] : [];
  }));
  const selected = new Set(Object.values(selection));
  const library = { source: { id: "foundry", kind: "base", author: "foundry", license: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).license }, fills: catalog.fills.filter(fill => selected.has(meta(fill).id)) };
  const graph = buildUsageGraph({
    inventory, selection,
    consumption: { leaves: consumptionReport({ catalog, library }).leaves },
    components: { fills: components.fills, reverseComposes: components.reverseComposes },
    surfaces: { fills: surfaces.fills, reverseComposes: surfaces.reverseComposes },
    // Routes are registered by the product's route registry, not this package; runtime DOM evidence is not yet captured.
  });
  const output = serializeUsageGraph(graph, { basis: "foundry-source-first", scope: "Foundry catalog leaves; no product routes or runtime capture. Freshness only, not a conformance clearance." });
  const path = resolve(src, "catalog/reports/usage-graph.json");
  if (mode === "--write") { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, output); }
  else if (!existsSync(path) || readFileSync(path, "utf8") !== output) { console.error("usage-graph report is stale; run node scripts/usage-graph.mjs --write"); process.exitCode = 1; }
  if (!process.exitCode) console.log(`usage-graph report ${mode === "--write" ? "written" : "current"}: ${graph.nodes.length} nodes; ${graph.edges.length} edges; ${JSON.stringify(graph.summary.edges)}`);
}
