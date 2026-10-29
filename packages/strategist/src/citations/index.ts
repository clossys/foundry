import { createHash } from "node:crypto";
import { compileBrief, type Brief } from "../brief.js";
import type { BriefContract } from "../brief-contracts.js";
import { CELL_ID_PATTERN, parseRef, positiveInteger } from "../format/ref.js";
import type { CellRef, StrategyModel } from "../format/types.js";

export interface CitationEntry {
  ref: CellRef;
  by: { kind: "brief" | "marker" | "json"; path: string; line?: number; id?: string };
}
export interface BriefDrift { path: string; contract: string; written: string; fresh: string }
export interface CitationIndex {
  schemaVersion: 1; generatedAt: string; fingerprint: string;
  entries: CitationEntry[]; stale: CitationEntry[]; dangling: CitationEntry[]; drift: BriefDrift[];
}
export interface ScanInput {
  files?: { path: string; content: string }[];
  briefs?: { path: string; brief: Brief }[];
  contracts?: BriefContract[];
}

/** JSON Pointer identifies the object carrying a ref, without any consumer schema. */
function walk(value: unknown, visit: (ref: CellRef, pointer: string) => void, pointer = ""): void {
  if (value === null || typeof value !== "object") return;
  if (!Array.isArray(value) && "cell" in value && "version" in value && typeof value.cell === "string" && CELL_ID_PATTERN.test(value.cell) && positiveInteger(value.version)) {
    visit({ cell: value.cell, version: value.version }, pointer);
  }
  for (const [key, child] of Object.entries(value)) walk(child, visit, `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`);
}

/**
 * Builds from explicit source snapshots. Known non-active versions are stale;
 * unknown cells/versions are dangling. Drafts have no effect on active citations.
 * Brief fingerprints use the same compiler as the read API, including cited bytes.
 */
export function buildCitationIndex(model: StrategyModel, scan: ScanInput = {}): CitationIndex {
  if (!model.tree || model.issues.length) throw new Error("Strategy root is unreadable or invalid");
  const entries: CitationEntry[] = []; const drift: BriefDrift[] = [];
  const contracts = new Map((scan.contracts ?? []).map(contract => [contract.id, contract]));
  const fresh = new Map<string, string>();
  for (const { path, brief } of scan.briefs ?? []) {
    const contract = contracts.get(brief.contract);
    if (!contract) throw new Error(`Written brief has no installed contract: ${path}`);
    const fingerprint = compileBrief(model, contract).fingerprint;
    fresh.set(brief.contract, fingerprint);
    if (brief.fingerprint !== fingerprint) drift.push({ path, contract: brief.contract, written: brief.fingerprint, fresh: fingerprint });
    walk(brief, (ref, id) => entries.push({ ref, by: { kind: "brief", path, id } }));
  }
  for (const { path, content } of scan.files ?? []) {
    // HTML comment delimiters are boundaries even without surrounding spaces.
    // Otherwise reject valid prefixes of malformed IDs or version tokens.
    const pattern = /(?:(?<=<!--)|(?<![\w:.-]))strategy:([a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*@[1-9]\d*)(?=-->|[^\w@-]|$)/g;
    for (const match of content.matchAll(pattern)) {
      const ref = parseRef(match[1]!);
      if (ref?.kind === "cell") entries.push({ ref: ref.ref, by: { kind: "marker", path, line: content.slice(0, match.index).split("\n").length } });
    }
    if (path.toLowerCase().endsWith(".json")) {
      let value: unknown;
      try { value = JSON.parse(content); } catch { throw new Error(`Invalid scan JSON: ${path}`); }
      walk(value, (ref, id) => entries.push({ ref, by: { kind: "json", path, id } }));
    }
  }
  const key = (entry: CitationEntry) => JSON.stringify([entry.by.path, entry.by.kind, entry.by.line ?? 0, entry.by.id ?? "", entry.ref.cell, entry.ref.version]);
  const unique = [...new Map(entries.map(entry => [key(entry), entry])).values()].sort((a, b) => key(a).localeCompare(key(b)));
  drift.sort((a, b) => a.path.localeCompare(b.path));
  const known = new Set(model.cells.map(cell => `${cell.id}@${cell.version}`));
  const dangling = unique.filter(entry => !known.has(`${entry.ref.cell}@${entry.ref.version}`));
  const stale = unique.filter(entry => known.has(`${entry.ref.cell}@${entry.ref.version}`) && model.tree!.active[entry.ref.cell] !== entry.ref.version);
  // Hash only material sources and their current governing pointers: an unrelated
  // draft or a different enumeration order cannot change this index fingerprint.
  const targets = [...new Set(unique.map(entry => entry.ref.cell))].sort().map(id => [id, model.tree!.active[id] ?? null]);
  const bytes = [...new Set(unique.map(entry => `cells/${entry.ref.cell}/v${entry.ref.version}.md`))].sort().map(path => [path, model.files[path] ?? null]);
  const fingerprint = createHash("sha256").update(JSON.stringify({ entries: unique, targets, bytes, fresh: [...fresh].sort(([a], [b]) => a.localeCompare(b)) })).digest("hex");
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), fingerprint, entries: unique, stale, dangling, drift };
}
