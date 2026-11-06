/**
 * Dependency closure for a component selection. Every relative import a selected source makes must
 * resolve to a selected file, or to the generated index of a selected leaf (`components/<leaf>/index`,
 * which `emitComponents` writes for every selected leaf). Anything else can never build, so it is an
 * error finding that names the missing leaf and the fills that would satisfy it, never a pass.
 */
import type { ComponentFinding } from "./check-components.js";
import type { ComponentCandidate, ComponentCatalog, ComponentFile } from "./resolve-components.js";
import { emitsGlyphModule } from "./emit-components.js";

const SPECIFIERS = /\b(?:import|export)\s+(?:type\s+)?(?:[\w$*\s{},]+?\s+from\s*)?["']([^"']+)["']/g;
const LEAF_INDEX = /^components\/([a-z][a-z0-9-]*)\/index(?:\.(?:js|ts|tsx))?$/;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
/** The consumer glyph module `emitComponents` writes when a selected leaf reads an asset. */
export const COMPONENT_GLYPH_MODULE_PATH = "adapters/glyphs.ts";

/** Static module specifiers only; comments are stripped so documentation never counts as an import. */
export function componentRelativeImports(code: string): string[] {
  const commentless = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return [...new Set([...commentless.matchAll(SPECIFIERS)].map(match => match[1]!).filter(specifier => specifier.startsWith(".")))].sort(compare);
}
/** Library-relative target of one specifier, or undefined when it climbs out of the library. */
function normalize(from: string, specifier: string): string | undefined {
  const parts = from.split("/").slice(0, -1);
  for (const part of specifier.split("/")) {
    if (part === "." || part === "") continue;
    if (part !== "..") parts.push(part);
    else if (!parts.pop()) return undefined;
  }
  return parts.join("/");
}
function resolvesTo(path: string, paths: ReadonlySet<string>): boolean {
  const stem = path.replace(/\.(?:js|ts|tsx)$/, "");
  return [path, `${stem}.ts`, `${stem}.tsx`].some(candidate => paths.has(candidate));
}
/** Catalog offers for a leaf, the importing source's own family first: implementation fills, then registered rules. */
export function componentSatisfyingFills(catalog: Pick<ComponentCatalog, "fills" | "rules">, slot: string, family?: string): string[] {
  const rank = (source: string): number => source === family ? 0 : 1;
  const fills = catalog.fills.map(doc => doc.$extensions["com.clossys.fill"])
    .filter(meta => meta.slot === slot && meta.mode === "implementation" && !meta.originKinds?.includes("composed"))
    .sort((a, b) => rank(a.source) - rank(b.source) || compare(a.id, b.id)).map(meta => meta.id);
  const rules = (catalog.rules ?? []).filter(rule => rule.slot === slot)
    .sort((a, b) => rank(a.template.source) - rank(b.template.source) || compare(a.id, b.id)).map(rule => `${rule.template.source} rule ${rule.id}`);
  return [...fills, ...rules];
}
export interface ComponentImportClosureInput {
  catalog: Pick<ComponentCatalog, "fills" | "rules">;
  /** Selected leaves by slot; `family` is the source a fill was adopted from, when it was. */
  fills: ReadonlyMap<string, ComponentCandidate & { family?: string }>;
  files: readonly ComponentFile[];
}
/** K9 is the registry-dependency rule: a dependency that is neither materialized nor emitted. */
export function componentImportClosureFindings(input: ComponentImportClosureInput): ComponentFinding[] {
  const paths = new Set(input.files.map(file => file.path));
  // The glyph module is emitted, not materialized: a selection that reads an asset satisfies its import.
  // A fill that declares no reads reads no asset.
  const reads = [...input.fills.values()].map(fill => ({ slot: fill.slot, reads: { assets: fill.reads?.assets ?? [] } }));
  if (emitsGlyphModule(reads)) paths.add(COMPONENT_GLYPH_MODULE_PATH);
  const findings: ComponentFinding[] = [];
  const add = (subject: string, message: string): void => { findings.push({ code: "K9", rule: "K9", subject, severity: "error", message }); };
  for (const [slot, fill] of [...input.fills].sort(([a], [b]) => compare(a, b))) {
    if (fill.impl.kind !== "source") continue;
    for (const receipt of fill.outputSha256 ?? []) {
      const file = input.files.find(candidate => candidate.path === receipt.path);
      if (!file || !/\.tsx?$/.test(file.path)) continue;
      for (const specifier of componentRelativeImports(file.content)) {
        const target = normalize(file.path, specifier);
        if (target === undefined) { add(slot, `Source import ${specifier} in ${file.path} escapes the component library`); continue; }
        if (resolvesTo(target, paths)) continue;
        const leaf = LEAF_INDEX.exec(target)?.[1];
        if (leaf && input.fills.has(`components.${leaf}`)) continue;
        if (!leaf) { add(slot, `Source import ${specifier} in ${file.path} resolves to no selected file`); continue; }
        const offers = componentSatisfyingFills(input.catalog, `components.${leaf}`, fill.family ?? fill.source);
        add(slot, `Source import ${specifier} in ${file.path} needs components.${leaf}, which is not selected; ${offers.length ? `satisfied by ${offers.join(" or ")}` : "no catalog fill satisfies it"}`);
      }
    }
  }
  return findings;
}
