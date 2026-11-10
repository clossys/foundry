/** Refresh the compiled default graph from the normal planner and adoption path. Build Designer first. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { previewModuleSource } from "./lib/preview-source.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputFlag = process.argv.indexOf("--output-root");
const outputRoot = outputFlag < 0 ? root : resolve(process.argv[outputFlag + 1] ?? (() => { throw new Error("--output-root needs a directory"); })());
const { loadCatalogBundles, installedHeadlessLibrary } = await import("../dist/catalog-bundles.js");
const { loadCatalog } = await import("../dist/catalog-core/index.js");
const { applyLibraryChange, libraryHash, resolve: resolveValues } = await import("../dist/catalog-core/api.js");
const { emittedTokenProperties } = await import("../dist/catalog-core/emit.js");
const { loadComponentRegistry } = await import("../dist/catalog-core/component-registry.js");
const { loadComponentCompositionRules } = await import("../dist/catalog-core/component-compositions.js");
const { planComponentDefaults, DEFAULT_COMPONENT_PREFERENCE, DEFAULT_COMPONENT_PICKS, DEFAULT_COMPONENT_FALLBACK } = await import("../dist/catalog-core/component-defaults.js");
const { applyDecisions } = await import("../dist/library-cli/apply-decisions.js");
const { resolveComponents } = await import("../dist/catalog-core/resolve-components.js");
const { emitComponents } = await import("../dist/catalog-core/emit-components.js");
const { sha256 } = await import("../dist/catalog-core/digest.js");
const { stableStringify } = await import("../dist/catalog-core/stable.js");

const values = loadCatalog();
const source = { kind: "consumer", author: "consumer", id: "defaults-consumer" };
const adoptedAt = "2026-10-26";
let valueLibrary = { source, fills: [], adoptedAt };
const changes = values.slots.filter(slot => slot.layer === "themes" || slot.id.startsWith("assets.icon-")).flatMap(slot => {
  const offers = values.fills.filter(doc => doc.$extensions["com.clossys.fill"].slot === slot.id && doc.$extensions["com.clossys.fill"].mode !== "reference");
  const selected = ["foundry", "tailwind-default"].map(id => offers.find(doc => doc.$extensions["com.clossys.fill"].source === id)).find(Boolean) ?? offers[0];
  return selected ? [{ op: "adopt", slot: slot.id, source: selected.$extensions["com.clossys.fill"].source }] : [];
});
valueLibrary = applyLibraryChange(values, valueLibrary, { baseHash: libraryHash(valueLibrary), changes });
const valueProfile = resolveValues({ catalog: values, library: valueLibrary });
function literal(id, mode) {
  let member = valueProfile.members[id];
  while (member.alias[mode] ?? member.alias.light) member = valueProfile.members[member.alias[mode] ?? member.alias.light];
  return member.css[mode] ?? member.css.light;
}
const tokens = Object.fromEntries([...emittedTokenProperties(valueProfile)].map(([id, output]) => [id, { property: output.property, light: literal(id, "light"), ...(valueProfile.members[id].value.dark === undefined ? {} : { dark: literal(id, "dark") }) }]));
const glyphs = Object.fromEntries(Object.values(valueProfile.members).filter(member => member.slot.startsWith("assets.icon-")).map(member => [member.slot, member.value.light]));
const assets = [...new Set(Object.values(valueProfile.members).filter(member => member.slot.startsWith("assets.")).map(member => member.slot))].sort();
const bundles = loadCatalogBundles(), registry = loadComponentRegistry();
const catalog = { slots: registry.slots, fills: bundles.componentFills, rules: loadComponentCompositionRules() };
const installedRac = installedHeadlessLibrary();
const plan = planComponentDefaults({ catalog, slots: registry.slots.map(slot => slot.id), tokens, assets, installedRac, bundles: bundles.sourceBundles, preference: DEFAULT_COMPONENT_PREFERENCE, picks: DEFAULT_COMPONENT_PICKS, fallback: DEFAULT_COMPONENT_FALLBACK });
const unchosen = plan.rows.filter(row => row.status === "not-chosen");
if (plan.findings.length) throw new Error(`Default profile cannot resolve: ${JSON.stringify(plan.findings)}`);
const adopted = applyDecisions({ values, components: catalog }, { source, adoptedAt, values: { fills: [] }, components: { fills: [], files: [] } }, plan.decisions, { bundles: bundles.sourceBundles });
const packageNames = new Set(["@clossys/designer/components", "@clossys/designer/charts", "@clossys/designer/shell", "react-aria-components", "react", "class-variance-authority", "clsx", "tailwind-merge"]);
const packageExports = {};
for (const name of [...packageNames].sort()) {
  const module = name.startsWith("@clossys/designer/") ? await import(`../dist/${name.slice("@clossys/designer/".length)}/index.js`) : await import(name);
  packageExports[name] = Object.keys(module).sort();
}
const profile = resolveComponents({ catalog, library: { ...adopted.components, source, adoptedAt }, values: { tokens, assets }, evidence: { observations: {}, installedRac }, packageExports });
if (profile.check.findings.some(finding => finding.severity === "error")) throw new Error("Default profile has blocking findings");
const emitted = emitComponents(profile, ["component-index"], { glyphModule: { path: "adapters/glyphs.ts", glyphs } });
const files = new Map(emitted.map(file => [file.path, file]));
const retained = new Set();
function visit(path) {
  if (retained.has(path)) return;
  retained.add(path);
  for (const match of files.get(path).content.matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g)) {
    const base = posix.normalize(posix.join(posix.dirname(path), match[1]));
    const dependency = [base, base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"), `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(key => files.has(key));
    if (!dependency) throw new Error(`Default source closure missing ${path} -> ${base}`);
    visit(dependency);
  }
}
const sourceComponents = Object.values(profile.components).filter(component => component.impl.kind === "source");
for (const component of sourceComponents) visit(component.impl.entry);
retained.add("adapters/glyphs.ts");
for (const file of emitted) if (file.path.startsWith("notices/")) retained.add(file.path);
const target = resolve(root, "src/components/preview-runtime");
function write(path, content) {
  path = resolve(outputRoot, posix.relative(root, path));
  if (process.argv.includes("--check")) {
    if (readFileSync(path, "utf8") !== content) throw new Error(`Default profile is stale: ${posix.relative(root, path)}`);
  } else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
}
for (const file of emitted) {
  let content = "// Consumer-only adapter omitted from the private preview dependency closure.\nexport {};\n";
  if (retained.has(file.path)) {
    content = previewModuleSource(file.content, file.path, { root, target });
  }
  write(resolve(target, file.path), content);
}
const modules = [...new Set(sourceComponents.map(component => component.impl.entry))].sort();
write(resolve(target, "modules.ts"), "// Private, statically compiled approved default closure. No source evaluation.\n" + modules.map((entry, index) => `import * as module${index} from ${JSON.stringify(`./${entry.replace(/\.tsx?$/, ".js")}`)};`).join("\n") + "\nexport const defaultSourceModules = {\n" + modules.map((entry, index) => `  ${JSON.stringify(entry)}: module${index},`).join("\n") + "\n};\n");
function identity(component) {
  const { source: _consumer, ...descriptor } = component.descriptor;
  delete descriptor.origin;
  const origin = component.origin.kind === "adopted" ? { kind: component.origin.kind, source: component.origin.source, fill: component.origin.fill, pin: component.origin.pin } : { kind: component.origin.kind, rule: ["composed", "derived"].includes(component.origin.kind) ? component.origin.rule : undefined };
  const { themes: _bindings, ...reads } = component.reads;
  return sha256(stableStringify({ descriptor, impl: component.impl, propMap: component.propMap, reads, origin }));
}
write(resolve(root, "src/studio/default-component-preview-profile.json"), JSON.stringify(profile, null, 2) + "\n");
write(resolve(target, "identities.json"), JSON.stringify({ components: Object.fromEntries(Object.entries(profile.components).map(([id, component]) => [id, identity(component)])), themes: Object.fromEntries(Object.entries(tokens).map(([id, token]) => [id, token.property])) }, null, 2) + "\n");
console.log(`Default component profile: ${plan.decisions.length} selected leaves, ${unchosen.length} unchosen, ${modules.length} source modules; ${process.argv.includes("--check") ? "current" : "refreshed"}`);
