#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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
  const { resolve: resolveValues } = await import(pathToFileURL(resolve(src, "catalog-core/resolve.ts")).href);
  const { emittedTokenProperties } = await import(pathToFileURL(resolve(src, "catalog-core/emit.ts")).href);
  const { loadCatalogBundles, installedHeadlessLibrary } = await import(pathToFileURL(resolve(src, "catalog-bundles.ts")).href);
  const { loadComponentRegistry } = await import(pathToFileURL(resolve(src, "catalog-core/component-registry.ts")).href);
  const { loadComponentCompositionRules } = await import(pathToFileURL(resolve(src, "catalog-core/component-compositions.ts")).href);
  const { componentOf } = await import(pathToFileURL(resolve(src, "catalog-core/resolve-components.ts")).href);
  const { planComponentDefaults, DEFAULT_COMPONENT_PREFERENCE, DEFAULT_COMPONENT_PICKS, DEFAULT_COMPONENT_FALLBACK } = await import(pathToFileURL(resolve(src, "catalog-core/component-defaults.ts")).href);
  const json = path => JSON.parse(readFileSync(resolve(src, path), "utf8"));
  const components = json("catalog/reports/components-consumption.json");
  // Current descriptors own actual declarations; their independent measurement
  // owns source observations. Slot allowedReads/allowedComposes are permissions,
  // so the historical contract report cannot supply graph references or selection.
  const surfaceDescriptors = readdirSync(resolve(src, "catalog/fills/foundry"))
    .filter(name => /^(?:sections|frames)\.(?!coverage\.)[^/]+\.json$/.test(name)).sort()
    .map(name => {
      const doc = json(`catalog/fills/foundry/${name}`), meta = doc.$extensions["com.clossys.fill"];
      const fill = Object.values(doc[meta.slot.split(".")[0]])[0];
      return { id: meta.id, slot: meta.slot, pin: meta.pin, fill };
    });
  const surfaceFills = surfaceDescriptors.map(({ id, slot, fill }) => ({
    id, slot, scanStatus: fill.consumption?.scanStatus ?? "unavailable",
    declaredReads: fill.reads, scannedReads: fill.consumption?.scannedReads,
  }));
  const surfaceComposes = {};
  for (const { id, fill } of surfaceDescriptors) {
    for (const [evidence, targets] of [
      ["declared", [...fill.composes ?? [], ...fill.reads?.components ?? []]],
      ["scanned", fill.consumption?.scannedComposes ?? []],
    ]) for (const target of new Set(targets)) {
      const parents = surfaceComposes[target] ??= {};
      (parents[evidence] ??= []).push(id);
    }
  }
  const inventory = Object.fromEntries(["tokens", "assets", "components", "sections", "frames"].map(layer => [layer, json(`catalog/slots/${layer}.json`).map(slot => slot.id).sort()]));
  // Resolve the package's value consumer before asking the production component
  // planner for defaults. Generic scale/asset offers fill gaps in Foundry values.
  // These are report inputs, never consumer-library mutations or approvals.
  const catalog = loadCatalog(), meta = fill => fill.$extensions["com.clossys.fill"];
  const valueFills = catalog.slots.flatMap(slot => {
    const offers = catalog.fills.filter(fill => meta(fill).slot === slot.id && meta(fill).mode !== "reference");
    const fill = ["foundry", "tailwind-default"].flatMap(source => offers.filter(fill => meta(fill).source === source))[0] ?? offers[0];
    return fill ? [fill] : [];
  });
  const library = { source: { id: "default-plan", kind: "base", author: "foundry", license: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).license }, fills: valueFills };
  const profile = resolveValues({ catalog, library });
  const literal = (id, mode) => {
    let member = profile.members[id];
    while (member.alias[mode] ?? member.alias.light) member = profile.members[member.alias[mode] ?? member.alias.light];
    return member.css[mode] ?? member.css.light;
  };
  const tokens = Object.fromEntries([...emittedTokenProperties(profile)].map(([id, output]) => [id, { property: output.property, light: literal(id, "light"), ...(profile.members[id].value.dark === undefined ? {} : { dark: literal(id, "dark") }) }]));
  const assets = [...new Set(Object.values(profile.members).filter(member => member.slot.startsWith("assets.")).map(member => member.slot))].sort();
  const bundles = loadCatalogBundles(), registry = loadComponentRegistry(), rules = loadComponentCompositionRules();
  const plan = planComponentDefaults({
    catalog: { slots: registry.slots, fills: bundles.componentFills, rules },
    slots: registry.slots.map(slot => slot.id), tokens, assets,
    installedRac: installedHeadlessLibrary(), bundles: bundles.sourceBundles,
    preference: DEFAULT_COMPONENT_PREFERENCE, picks: DEFAULT_COMPONENT_PICKS, fallback: DEFAULT_COMPONENT_FALLBACK,
  });
  const selection = Object.fromEntries([
    ...valueFills.map(fill => [meta(fill).slot, meta(fill).id]),
    ...plan.rows.flatMap(row => {
      if (row.fill) return [[row.slot, row.fill]];
      const rule = rules.find(rule => rule.id === row.rule);
      return rule ? [[row.slot, `${rule.template.source}/${row.slot}`]] : [];
    }),
    ...[...inventory.sections, ...inventory.frames].flatMap(leaf => {
      const fill = surfaceFills.find(fill => fill.slot === leaf && fill.id === `foundry/${leaf}`);
      return fill ? [[leaf, fill.id]] : [];
    }),
  ]);
  // Source reports retain measured/scanned evidence. Declared reads and
  // compositions come only from current selected descriptors, including rules.
  const componentFills = structuredClone(components.fills);
  const reverseComposes = Object.fromEntries(Object.entries(components.reverseComposes).map(([slot, parents]) => [slot,
    Array.isArray(parents) ? { declared: [...parents] } : structuredClone(parents)]));
  const selectedComponents = [
    ...bundles.componentFills.map(doc => ({ id: meta(doc).id, fill: componentOf(doc) })),
    ...rules.map(rule => ({ id: `${rule.template.source}/${rule.slot}`, fill: rule.template })),
  ].filter(row => selection[row.fill.slot] === row.id);
  const selectedIds = new Set(selectedComponents.map(row => row.id));
  for (const parents of Object.values(reverseComposes)) {
    parents.declared = (parents.declared ?? []).filter(parent => !selectedIds.has(parent));
  }
  for (const { id, fill } of selectedComponents) {
    let row = componentFills.find(row => row.id === id);
    if (!row) { row = { id, slot: fill.slot }; componentFills.push(row); }
    row.declaredReads = Object.fromEntries(["tokens", "assets"].map(layer => [layer, [...new Set(fill.reads[layer])].sort()]));
    for (const target of new Set([...fill.composes, ...fill.reads.components])) {
      const parents = reverseComposes[target] ??= {};
      parents.declared = [...new Set([...parents.declared ?? [], id])].sort();
    }
  }
  const graph = buildUsageGraph({
    inventory, selection,
    consumption: { leaves: consumptionReport({ catalog, library }).leaves },
    components: { fills: componentFills, reverseComposes },
    surfaces: { fills: surfaceFills, reverseComposes: surfaceComposes },
    // Routes are registered by the product's route registry, not this package; runtime DOM evidence is not yet captured.
  });
  // Keep the source-only evidence, including unknown imports and proven private
  // assets-module witnesses, without turning raw lexical imports into assets.
  const surfaceEvidence = {
    measurement: "source-only lower-bound", runtime: "unmeasured",
    fills: surfaceDescriptors.map(({ id, slot, pin, fill }) => ({ id, slot, pin, ...fill.consumption })),
  };
  const output = serializeUsageGraph(graph, { surfaceEvidence, basis: "shadcn@aria-default-plan", scope: "Catalog default plan over package values; Foundry surfaces; no product routes or runtime capture. Freshness only, not a conformance clearance." });
  const path = resolve(src, "catalog/reports/usage-graph.json");
  if (mode === "--write") { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, output); }
  else if (!existsSync(path) || readFileSync(path, "utf8") !== output) { console.error("usage-graph report is stale; run node scripts/usage-graph.mjs --write"); process.exitCode = 1; }
  if (!process.exitCode) console.log(`usage-graph report ${mode === "--write" ? "written" : "current"}: ${graph.nodes.length} nodes; ${graph.edges.length} edges; ${JSON.stringify(graph.summary.edges)}`);
}
