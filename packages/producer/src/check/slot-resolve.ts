/** Report-only slot resolution. Store deviations belong in adapters, never in the rule. */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import type { AgentKind } from "../agents.js";
import { resolveAgent } from "../agents.js";
import { agentModule } from "../server/cells.js";
import { buildCheckOutputEnvelope } from "../generated/check-output-envelope.js";
import { hashFiles, sha256Hex } from "../records/hash.js";
import { payloadFiles, readElementVersion } from "../records/library.js";
import { loadReferencesManifest } from "../records/validate.js";
import { pageCopy } from "../publish/site-source.js";

export type SlotFailureCode = "not-in-ia" | "no-candidate" | "no-pin" | "multi-pin" | "pin-missing-file" | "hash-drift" | "schema" | "copy-missing-key" | "copy-empty" | "no-source" | "source-ref-unknown" | "orphan-candidate";
export interface SlotSource { kind: "registry" | "derived" | "original"; ref?: string; hash?: string }
export interface SlotCandidate {
  id: string; hash?: string; schemaIssues: string[]; copyKeys: string[]; source?: SlotSource;
  /** Adapter evidence only; absent legacy hashes are never synthesized. */
  deviations?: string[];
}
export interface SlotPin { id: string; hash?: string }
export interface SlotStore {
  agent: AgentKind; ia: string[]; iaSource: string;
  candidates: Record<string, SlotCandidate[]>; pins: Record<string, SlotPin[]>;
  errors?: string[];
}
export interface SlotFinding { code: SlotFailureCode; message: string }
export interface SlotRow {
  agent: AgentKind; slot: string; pinned: string[]; source: SlotSource | null;
  copy: { keys: string[]; resolved: number }; status: "satisfied" | "violated";
  findings: SlotFinding[]; deviations: string[];
}

/** One uniform rule for every normalized store, including the inverse IA check. */
export function resolveSlots(stores: readonly SlotStore[], writer: ReadonlyMap<string, readonly string[]>, references: ReadonlyMap<string, string>): SlotRow[] {
  return stores.flatMap(store => [...new Set([...store.ia, ...Object.keys(store.candidates), ...Object.keys(store.pins)])].sort().map(slot => {
    const candidates = store.candidates[slot] ?? [], pins = store.pins[slot] ?? [];
    const findings: SlotFinding[] = [];
    const add = (code: SlotFailureCode, message: string) => findings.push({ code, message });
    if (!store.ia.includes(slot)) {
      add("not-in-ia", "Slot is absent from the adapter's declared IA.");
      if (candidates.length) add("orphan-candidate", "Candidate files have no IA slot.");
    }
    if (!candidates.length) add("no-candidate", "No candidate file exists.");
    if (!pins.length) add("no-pin", "No candidate is pinned.");
    if (pins.length > 1) add("multi-pin", "More than one candidate is pinned.");
    let source: SlotSource | null = null;
    const keys = new Set<string>(), deviations = new Set<string>();
    for (const issue of store.errors ?? []) add("schema", issue);
    for (const pin of pins) {
      const candidate = candidates.find(row => row.id === pin.id);
      if (!candidate) { add("pin-missing-file", "Pin names no existing candidate file."); continue; }
      for (const deviation of candidate.deviations ?? []) deviations.add(deviation);
      if (!pin.hash || !candidate.hash || pin.hash !== candidate.hash) add("hash-drift", !pin.hash ? "Pin has no stored hash; integrity is unverified." : "Pin hash does not match candidate bytes.");
      for (const issue of candidate.schemaIssues) add("schema", issue);
      source = candidate.source ?? null;
      if (!source || !source.hash || (source.kind !== "original" && !source.ref)) add("no-source", "Normalized source kind, ref or hash evidence is incomplete.");
      if (source && source.kind !== "original" && source.ref && (!references.has(source.ref) || references.get(source.ref) !== source.hash)) add("source-ref-unknown", "Source ref and hash do not match the references manifest.");
      for (const key of candidate.copyKeys) keys.add(key);
    }
    let resolved = 0;
    for (const key of keys) {
      const values = writer.get(key);
      if (!values?.length) add("copy-missing-key", `No active Writer string resolves ${key}.`);
      else if (values.some(value => !value.trim() || /\b(?:TODO|TBD|lorem(?: ipsum)?)\b/i.test(value) || value.trim() === key || value.trim() === key.slice(key.lastIndexOf(".") + 1))) add("copy-empty", `Writer string ${key} is empty, placeholder text or a raw key echo.`);
      else resolved++;
    }
    return { agent: store.agent, slot, pinned: pins.map(pin => pin.id), source, copy: { keys: [...keys], resolved }, status: findings.length ? "violated" : "satisfied", findings, deviations: [...deviations] };
  }));
}

// No symlink traversal, including ancestors and declared payload paths. Never open ambient files.
function safe(path: string): string {
  let cursor = resolve(path);
  for (;;) { try { if (lstatSync(cursor).isSymbolicLink()) throw new Error("Symlink input is unsupported."); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  return path;
}
const text = (path: string) => readFileSync(safe(path), "utf8");
const json = (path: string): any => JSON.parse(text(path));
function dirs(path: string): string[] {
  try { return readdirSync(safe(path), { withFileTypes: true }).filter(row => row.isDirectory() && !row.isSymbolicLink()).map(row => row.name).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}
const segment = (name: string) => /^[a-z0-9][a-z0-9.-]*$/.test(name) && !name.includes("..");
function treeSlots(tree: any): string[] {
  const out: string[] = [];
  const walk = (nodes: any[]) => { for (const node of nodes) { out.push(...(node.cells ?? [])); walk(node.children ?? []); } };
  walk(tree.tree ?? []); return [...new Set(out)];
}

/** Library directories + selection.json, not the obsolete Designer cell store. */
async function libraryAdapter(root: string): Promise<SlotStore> {
  const module = await agentModule("designer", "catalog-core/index.js");
  const catalog = module.loadBuildCatalog();
  const ia: string[] = [];
  const walk = (nodes: any[]) => { for (const node of nodes) { ia.push(...(node.leaves ?? [])); walk(node.children ?? []); } };
  for (const placement of catalog.placements) walk(placement.nodes);
  const store: SlotStore = { agent: "designer", ia: [...new Set(ia)], iaSource: "Foundry Designer build catalog placements", candidates: Object.create(null), pins: Object.create(null) };
  const library = join(root, "library");
  for (const slot of dirs(library).filter(segment)) for (const element of dirs(join(library, slot)).filter(segment)) {
    for (const version of dirs(join(library, slot, element)).filter(name => /^v[1-9]\d*$/.test(name))) {
      const id = `${slot}/${element}/${version}`, dir = join(library, id);
      const candidate: SlotCandidate = { id, schemaIssues: [], copyKeys: [] };
      try {
        // Validate both element and preview, plus identity, through their existing schema owners.
        safe(join(dir, "element.json")); safe(join(dir, "preview.json"));
        const read = readElementVersion(safe(library), slot, element, Number(version.slice(1)));
        const rejectAliases = (path: string): void => {
          for (const entry of readdirSync(safe(path), { withFileTypes: true })) {
            if (entry.isSymbolicLink()) throw new Error("Symlink payload is unsupported.");
            if (entry.isDirectory()) rejectAliases(join(path, entry.name));
          }
        };
        rejectAliases(dir);
        const payload = payloadFiles(read.dir, read.element);
        for (const file of payload) { if (file.startsWith("/") || file.split(/[\\/]/).includes("..")) throw new Error("Unsafe declared payload."); safe(join(dir, file)); }
        candidate.hash = hashFiles(dir, payload);
        if (candidate.hash !== read.element.hash) candidate.schemaIssues.push("Element payload hash differs from its record.");
        candidate.copyKeys = [...read.element.reads.copyKeys];
        const lineage = read.element.lineage;
        candidate.source = lineage.mode === "original" ? { kind: "original", hash: read.element.hash }
          : { kind: lineage.mode === "verbatim" ? "registry" : "derived", ref: lineage.source ? `${lineage.source.registry}/${lineage.source.item}@${lineage.source.version}` : undefined, hash: lineage.source?.hash };
      } catch { candidate.schemaIssues.push("Element or preview schema, identity or payload could not be validated."); }
      (store.candidates[slot] ??= []).push(candidate);
    }
  }
  let selection: any;
  try { selection = json(join(root, "selection.json")); } catch { store.errors = ["Selection record is missing or unreadable."]; return store; }
  for (const [slot, value] of Object.entries(selection.pins ?? {})) {
    const pins: any[] = Array.isArray(value) ? value : [value];
    store.pins[slot] = pins.map(pin => ({ id: `${slot}/${pin?.element}/v${pin?.version}`, hash: pin?.hash }));
  }
  return store;
}

/** File cells + tree.active, with source and pin-hash gaps retained as adapter deviations. */
async function cellAdapter(root: string, agent: "director" | "writer" | "publisher", writer: Map<string, string[]>): Promise<SlotStore> {
  const base = join(root, "agents", agent), tree = json(join(base, "tree.json"));
  const generic = await agentModule("director", "cell-format/index.js");
  const api = await agentModule(agent, agent === "writer" ? "cells/parse.js" : agent === "director" ? "index.js" : "content-map/cells.js");
  const ia = agent === "director" ? api.loadCatalog().ia.nodes.flatMap((node: any) => node.children.flatMap((child: any) => child.leaves)) : treeSlots(tree);
  const store: SlotStore = { agent, ia, iaSource: agent === "director" ? "Foundry Director catalog IA" : "Consumer tree.json contextual IA (Studio gallery); Foundry cell IA unavailable", candidates: Object.create(null), pins: Object.create(null) };
  let publisherSchema = true;
  if (agent === "publisher") {
    try { for (const pub of tree.meta?.publications ?? []) await api.contentMapFromCells(base, pub.id); if (!tree.meta?.publications?.length) publisherSchema = false; }
    catch { publisherSchema = false; }
  }
  for (const slot of dirs(join(base, "cells")).filter(segment)) {
    for (const file of readdirSync(safe(join(base, "cells", slot))).filter(name => /^v[1-9]\d*\.md$/.test(name)).sort()) {
      const id = `cells/${slot}/${file}`, source = text(join(base, id)), parsed = generic.parseDocument(source);
      const candidate: SlotCandidate = { id, hash: `sha256:${sha256Hex(source)}`, schemaIssues: [], copyKeys: [], deviations: ["tree.active carries a version only, with no stored pin hash", "Legacy source citations/links have no normalized content hash"] };
      const f = parsed.ok ? parsed.value.fields : {};
      if (!parsed.ok || f.id !== slot || f.version !== Number(file.slice(1, -3))) candidate.schemaIssues.push("Cell document identity or frontmatter is invalid.");
      try {
        if (agent === "director") {
          if (!api.parseCell(source, id).ok) throw new Error();
          const checks = await agentModule("director", "slot-contracts/checks.js");
          if (checks.runDirectorSuite({ cells: [{ path: id, text: source }] }).findings.some((row: any) => row.slot === slot && ["INPUT", "D-REQ"].includes(row.check))) throw new Error();
        } else if (agent === "writer") {
          const cell = api.parseWriterCell(source, id);
          const checks = await agentModule("writer", "slot-contracts/checks.js");
          if (checks.runWriterSuite({ cells: [{ path: id, text: source }] }).findings.some((row: any) => row.severity === "error")) throw new Error();
          for (const row of cell.records) if (typeof row.record.text === "string") {
            const key = String(row.record.context); candidate.copyKeys.push(key);
            if (tree.active[slot] === cell.version && cell.status === "active") {
              for (const alias of new Set([key, String(row.record.id)])) writer.set(alias, [...(writer.get(alias) ?? []), row.record.text]);
            }
          }
        } else {
          if (!publisherSchema) throw new Error();
          candidate.copyKeys = pageCopy(source).map(row => `${row.cell}.${row.key}`);
        }
      } catch { candidate.schemaIssues.push("Owning agent schema or slot contract did not validate."); }
      const cites = agent === "director" ? [...(Array.isArray(f.cites) ? f.cites : []), ...(f.confirmed ? [f.confirmed] : [])] : f.links;
      if (Array.isArray(cites) && cites.length) candidate.source = { kind: "derived", ref: cites.join(",") };
      (store.candidates[slot] ??= []).push(candidate);
    }
  }
  if (agent === "writer") {
    try {
      // The owning compiler projects aliases from active source cells without an output directory.
      const compiler = await agentModule("writer", "cells/compile.js");
      const projected = await compiler.compileWriterCells(base);
      for (const file of Object.values(projected.files) as any[]) {
        for (const [alias, id] of Object.entries(file?.aliases ?? {})) {
          const values = typeof id === "string" ? writer.get(id) : undefined;
          if (values) writer.set(alias, [...values]);
        }
      }
    } catch { store.errors = ["Active Writer alias projection could not be validated."]; }
  }
  for (const [slot, value] of Object.entries(tree.active ?? {})) {
    const versions = Array.isArray(value) ? value : value === null ? [] : [value];
    store.pins[slot] = versions.map(version => ({ id: `cells/${slot}/v${version}.md` }));
  }
  return store;
}

export async function runSlotResolve(rootIn: string) {
  const root = resolve(rootIn), writer = new Map<string, string[]>(), stores: SlotStore[] = [], inputErrors: string[] = [];
  const references = new Map<string, string>();
  let referenceSource = "Foundry Designer references manifest";
  let referenceHash: string | undefined;
  try { const foundry = resolveAgent("designer").packageRoot; const path = join(foundry, "references", "manifest.json"); const manifest = loadReferencesManifest(path); referenceHash = `sha256:${sha256Hex(text(path))}`; for (const item of manifest.items) references.set(item.dir, item.hash); }
  catch { inputErrors.push("References manifest could not be validated."); referenceSource = "unavailable"; }
  for (const agent of ["writer", "director", "designer", "publisher"] as const) {
    try { stores.push(agent === "designer" ? await libraryAdapter(root) : await cellAdapter(root, agent, writer)); }
    catch { inputErrors.push(`${agent} adapter inputs could not be read or validated.`); }
  }
  const rows = resolveSlots(stores, writer, references);
  const findings = [...inputErrors.map(message => ({ rule: "schema", severity: "warning" as const, message })), ...rows.flatMap(row => row.findings.map(finding => ({ rule: finding.code, severity: "warning" as const, message: finding.message, path: `${row.agent}:${row.slot}` })))];
  const version = createRequire(import.meta.url)("../../package.json").version as string;
  const envelope = buildCheckOutputEnvelope({ package: "@clossys/producer", version, verdict: inputErrors.length ? "indeterminate" : findings.length ? "violated" : "satisfied", summary: `Slot inspection reported ${findings.length} findings across ${rows.length} slots.`, findings });
  // Packet explicitly authorizes reporting only, including unreadable inputs; no enforcement switch.
  return { ...envelope, reportOnly: true as const, exitCode: 0 as const, rows, sources: { references: { source: referenceSource, hash: referenceHash }, ia: stores.map(store => ({ agent: store.agent, source: store.iaSource, slotsHash: `sha256:${sha256Hex(JSON.stringify([...store.ia].sort()))}` })), root } };
}
export type SlotResolveReport = Awaited<ReturnType<typeof runSlotResolve>>;
export function slotResolveSummary(report: SlotResolveReport): string {
  return ["Slot resolution (report only): " + report.summary, ...report.rows.flatMap(row => row.findings.map(finding => `  ${row.agent}:${row.slot} [${finding.code}] ${finding.message}`)), ...report.findings.filter(finding => !finding.path).map(finding => `  [${finding.rule}] ${finding.message}`)].join("\n");
}
