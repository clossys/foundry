import { assertComponentDescriptor, assertComponentFiles, type ComponentCandidate, type ComponentFile } from "./resolve-components.js";
import type { DtcgToken } from "./types.js";

/** Consumer-owned picks, in dependency order. `value` is a map of relative token members. */
export type LibraryDecision = { slot: string; note: string } & (
  | { kind: "adopt"; source: string; fill?: string }
  | { kind: "author"; value: Readonly<Record<string, DtcgToken>> }
  | { kind: "author"; fill: ComponentCandidate; files: readonly ComponentFile[] }
  | { kind: "derive"; rule: string; reads: readonly string[] }
  | { kind: "compose"; rule: string; reads: readonly string[] }
);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && !/[\u0000-\u001f]/.test(value);
const member = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(value) && !value.split(".").some(part => ["__proto__", "constructor", "prototype"].includes(part));
const texts = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const keys = (value: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));

/** Closed JSON envelope; semantic contract, hash, licence and rule validation remains with the engine. */
export function isLibraryDecisions(value: unknown): value is readonly LibraryDecision[] {
  if (!Array.isArray(value) || value.length > 256) return false;
  const seen = new Set<string>();
  return value.every(row => {
    if (!record(row) || !text(row.slot) || !/^(themes|assets|components)\.[a-z][a-z0-9-]*$/.test(row.slot) || seen.has(row.slot) || !text(row.note)) return false;
    seen.add(row.slot);
    const common = ["slot", "kind", "note"], component = row.slot.startsWith("components.");
    if (row.kind === "adopt") return keys(row, [...common, "source"], ["fill"]) && text(row.source) && (row.fill === undefined || text(row.fill));
    if (row.kind === "author") {
      if (!component) return keys(row, [...common, "value"]) && record(row.value) && Object.keys(row.value).length > 0 && Object.entries(row.value).every(([id, token]) => member(id) && record(token) && text(token.$type) && Object.hasOwn(token, "$value"));
      if (!keys(row, [...common, "fill", "files"]) || !record(row.fill) || row.fill.slot !== row.slot || !Array.isArray(row.files) || !row.files.every(file => record(file) && keys(file, ["path", "content"]) && typeof file.path === "string" && typeof file.content === "string")) return false;
      const fill = row.fill;
      if (!text(fill.source) || !text(fill.root) || !text(fill.license) || !texts(fill.members) || !texts(fill.props) || !texts(fill.composes)
        || !record(fill.propMap) || !Object.values(fill.propMap).every(text) || !record(fill.reads) || ![fill.reads.themes, fill.reads.assets, fill.reads.components].every(texts)
        || !record(fill.impl) || !["package", "source"].includes(String(fill.impl.kind)) || !Array.isArray(fill.deps)
        || !fill.deps.every(dep => record(dep) && text(dep.name) && text(dep.version) && text(dep.license))) return false;
      try { assertComponentDescriptor(row.fill as unknown as ComponentCandidate); assertComponentFiles(row.files); return true; } catch { return false; }
    }
    if (row.kind === "derive" || row.kind === "compose") return (component || row.kind === "derive") && keys(row, [...common, "rule", "reads"]) && text(row.rule) && Array.isArray(row.reads) && new Set(row.reads).size === row.reads.length && row.reads.every(id => member(id) && (component ? /^components\.[a-z][a-z0-9-]*$/.test(id) : /^(themes|assets)\.[a-z][a-z0-9-]*\./.test(id)));
    return false;
  });
}
