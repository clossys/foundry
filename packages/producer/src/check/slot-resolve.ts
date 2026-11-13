/** Slot integrity over the common IA / slot / candidate / pin model. */
import { lstatSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import type { AgentKind } from "../agents.js";
import { resolveAgent } from "../agents.js";
import { buildCheckOutputEnvelope, envelopeToExitCode } from "../generated/check-output-envelope.js";
import { sha256Hex } from "../records/hash.js";
import { loadReferencesManifest } from "../records/validate.js";
import { assertModelTree, listSlots, readAgentFile, readCandidate, readIa, readSlot } from "../records/slots.js";
import { agentModule } from "../server/cells.js";
import { checkSlotModel, formatCoverage, slotCoverage, writerRecords, type AgentCoverage } from "../records/slot-check.js";
import {
  SLOT_AGENTS, parseFrontmatter, validateIa, validateSource,
  type SlotModelCode, type SourceDoc,
} from "../records/slot-model/index.js";

export type SlotFailureCode = "not-in-ia" | "no-candidate" | "no-pin" | "multi-pin" | "pin-missing-file" | "hash-drift" | "schema" | "copy-missing-key" | "copy-empty" | "no-source" | "source-ref-unknown" | "orphan-candidate" | "ia-path" | "candidate-status";
export type SlotSource = SourceDoc;
export interface SlotCandidate {
  id: string; hash?: string; schemaIssues: string[]; copyKeys: string[]; source?: SlotSource;
}
export interface SlotPin { id: string; hash?: string }
export interface SlotStore {
  agent: AgentKind; ia: string[]; iaSource: string;
  candidates: Record<string, SlotCandidate[]>; pins: Record<string, SlotPin[]>;
  /** IA slots the loader decides are `not-needed` (slot.json `notNeeded`): they hold no pin by design. */
  notNeeded?: readonly string[];
  errors?: string[];
}
export interface SlotFinding { code: SlotFailureCode; message: string }
export interface SlotRow {
  agent: AgentKind; slot: string; pinned: string[]; source: SlotSource | null;
  copy: { keys: string[]; resolved: number }; status: "satisfied" | "violated";
  findings: SlotFinding[];
}

/**
 * Page copy `<cell>#<key>` with no Writer slot of that name reads the Writer declarations alias
 * `<cell>.<key>`, the same alias the Publisher page records bind (`page.<entry>.meta-title`).
 */
function aliased(key: string, writer: ReadonlyMap<string, readonly string[]>, aliases: ReadonlyMap<string, readonly string[]>): readonly string[] | undefined {
  const hash = key.indexOf("#");
  if (hash < 1) return undefined;
  const ids = aliases.get(`${key.slice(0, hash)}.${key.slice(hash + 1)}`) ?? [];
  const values = ids.flatMap(id => writer.get(id) ?? []);
  return values.length ? values : undefined;
}

/** One rule for every agent. Source hashes are optional under the model contract. */
export function resolveSlots(stores: readonly SlotStore[], writer: ReadonlyMap<string, readonly string[]>, references: ReadonlyMap<string, string>, aliases: ReadonlyMap<string, readonly string[]> = new Map()): SlotRow[] {
  return stores.flatMap(store => [...new Set([...store.ia, ...Object.keys(store.candidates), ...Object.keys(store.pins)])].map(slot => {
    const candidates = store.candidates[slot] ?? [], pins = store.pins[slot] ?? [];
    const findings: SlotFinding[] = [];
    const add = (code: SlotFailureCode, message: string) => findings.push({ code, message });
    if (!store.ia.includes(slot)) {
      add("not-in-ia", "Slot is absent from the declared IA.");
      if (candidates.length) add("orphan-candidate", "Candidate files have no IA slot.");
    }
    const notNeeded = store.notNeeded?.includes(slot) && !pins.length;
    if (!candidates.length && !notNeeded) add("no-candidate", "No candidate file exists.");
    if (!pins.length && !notNeeded) add("no-pin", "No candidate is pinned.");
    if (pins.length > 1) add("multi-pin", "More than one candidate is pinned.");
    let source: SlotSource | null = null;
    const keys = new Set<string>();
    for (const issue of store.errors ?? []) add("schema", issue);
    for (const pin of pins) {
      const candidate = candidates.find(row => row.id === pin.id);
      if (!candidate) { add("pin-missing-file", "Pin names no existing candidate file."); continue; }
      if (!pin.hash || !candidate.hash || pin.hash !== candidate.hash) add("hash-drift", "Pin sha256 does not match candidate bytes.");
      for (const issue of candidate.schemaIssues) add("schema", issue);
      source = candidate.source ?? null;
      if (!source || validateSource(source, "source").length) add("no-source", "Candidate source does not satisfy the slot model contract.");
      // Every ref is a vendored manifest item; `source.hash` is the primary (first) ref's tree hash,
      // as check-ref-verbatim proves it.
      const registry = source?.kind === "registry" && Array.isArray(source.ref) ? source : undefined;
      registry?.ref.forEach((ref, index) => {
        if (!references.has(ref) || (index === 0 && registry.hash !== undefined && references.get(ref) !== registry.hash)) add("source-ref-unknown", "Registry source ref or hash does not match the references manifest.");
      });
      for (const key of candidate.copyKeys) keys.add(key);
    }
    let resolved = 0;
    for (const key of keys) {
      const values = writer.get(key) ?? aliased(key, writer, aliases);
      if (!values?.length) add("copy-missing-key", `No pinned Writer string resolves ${key}.`);
      else if (values.some(value => !value.trim() || /\b(?:TODO|TBD|lorem(?: ipsum)?)\b/i.test(value) || value.trim() === key || value.trim() === key.slice(key.lastIndexOf(".") + 1))) add("copy-empty", `Writer string ${key} is empty, placeholder text or a raw key echo.`);
      else resolved++;
    }
    return { agent: store.agent, slot, pinned: pins.map(pin => pin.id), source, copy: { keys: [...keys], resolved }, status: findings.length ? "violated" as const : "satisfied" as const, findings };
  }));
}

// Reject aliases on non-model inputs (the references manifest); the model tree is
// checked by the one reader (`assertModelTree`). Legacy stores are never opened.
function safe(path: string): string {
  let cursor = resolve(path);
  for (;;) {
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error("Symlink input is unsupported."); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  return path;
}
function document(bytes: string, markdown: boolean): Record<string, any> {
  if (!markdown) return JSON.parse(bytes);
  const parsed = parseFrontmatter(bytes);
  if (!parsed.ok) throw new Error("Invalid candidate frontmatter.");
  return { ...parsed.value.fields, body: parsed.value.body };
}

function modelStores(root: string, writer: Map<string, string[]>): SlotStore[] {
  const stores: SlotStore[] = [];
  for (const agent of SLOT_AGENTS) {
    const ia = readIa(root, agent);
    if (!ia || validateIa(ia).length) continue;
    const entries = listSlots(root, agent);
    const store: SlotStore = { agent, ia: entries.map(entry => entry.id), iaSource: ia.source, candidates: Object.create(null), pins: Object.create(null), notNeeded: entries.filter(entry => entry.state.state === "not-needed").map(entry => entry.id) };
    stores.push(store);
    for (const entry of entries) {
      store.candidates[entry.id] = [];
      store.pins[entry.id] = entry.pin ? [{ id: entry.pin.candidate, hash: entry.pin.sha256 }] : [];
      for (const name of entry.candidates) {
        const candidate = readCandidate(root, agent, entry.id, name);
        const normalized: SlotCandidate = { id: name, hash: candidate.sha256, schemaIssues: [], copyKeys: [] };
        store.candidates[entry.id]!.push(normalized);
        try {
          const doc = document(candidate.bytes, name.endsWith(".md"));
          normalized.source = name.endsWith(".md") ? doc.source : doc.meta?.source;
          const slot = readSlot(root, agent, entry.id);
          if (slot.kind === "strings") {
            const records = writerRecords(doc.body);
            normalized.copyKeys = records.map(row => row.key);
            // Only hash-verified pins can feed downstream copy resolution.
            if (entry.pin?.candidate === name && entry.pin.sha256 === candidate.sha256) for (const row of records) {
              for (const key of new Set([row.key, String(row.meta.id), `${entry.id}#${row.key}`])) writer.set(key, [...(writer.get(key) ?? []), row.text]);
            }
          } else if (slot.kind === "page") {
            // Page copy maps copy slot to `<writer slot>#<key>`, page-wide and per section instance.
            const bound = [doc.copy, ...Object.values(doc.bindings ?? {}).map((binding: any) => binding?.copy)];
            normalized.copyKeys = [...new Set(bound.flatMap(copy => Object.values(copy ?? {}) as string[]))];
          }
          else if (slot.kind === "element") {
            // A copy slot `{ slot, prop, previewKey }` reads its preview key; a bare string is a key read through host data.
            const keys = doc.meta?.element?.reads?.copyKeys ?? [];
            const slotEntry = (key: any) => !!key && typeof key === "object" && !Array.isArray(key) && typeof key.slot === "string" && !!key.slot && typeof key.prop === "string" && !!key.prop && typeof key.previewKey === "string" && !!key.previewKey;
            if (Array.isArray(keys) && keys.every(key => typeof key === "string" || slotEntry(key))) normalized.copyKeys = keys.map((key: any) => typeof key === "string" ? key : key.previewKey);
            else normalized.schemaIssues.push("Element copy keys must list Writer keys or { slot, prop, previewKey } copy slots.");
          }
        } catch { normalized.schemaIssues.push("Candidate or slot document could not be read."); }
      }
    }
  }
  return stores;
}

/** Writer declarations aliases (`<cell>.<key>` to record ids, every locale), read by the Writer's own parser. */
async function writerAliases(root: string, inputErrors: string[]): Promise<Map<string, string[]>> {
  const aliases = new Map<string, string[]>();
  try {
    const text = readAgentFile(root, "writer", "declarations.json");
    if (text === undefined) return aliases;
    const declarations = (await agentModule("writer", "declarations.js")).parseWriterDeclarations(text) as { locales: Record<string, { aliases: Record<string, string> }> };
    for (const locale of Object.values(declarations.locales)) for (const [alias, id] of Object.entries(locale.aliases)) aliases.set(alias, [...new Set([...(aliases.get(alias) ?? []), id])]);
  } catch { inputErrors.push("Writer declarations could not be read or validated."); }
  return aliases;
}

const modelCode = (code: SlotModelCode): SlotFailureCode => {
  if (code === "ia-path" || code === "candidate-status") return code;
  if (code === "pin-hash") return "hash-drift";
  if (code === "pin-candidate") return "pin-missing-file";
  if (code === "candidate-source") return "no-source";
  if (code === "orphan") return "orphan-candidate";
  return "schema";
};

export async function runSlotResolve(rootIn: string) {
  const root = resolve(rootIn), writer = new Map<string, string[]>(), inputErrors: string[] = [];
  let stores: SlotStore[] = [], rows: SlotRow[] = [], coverage: AgentCoverage[] = [];
  let modelIssues: ReturnType<typeof checkSlotModel> = [];
  const references = new Map<string, string>();
  let referenceHash: string | undefined;
  let referenceSource = "not required (no registry sources)";
  try {
    assertModelTree(root);
    modelIssues = checkSlotModel(root);
    stores = modelStores(root, writer);
    if (stores.some(store => Object.values(store.candidates).flat().some(candidate => candidate.source?.kind === "registry"))) {
      referenceSource = "Foundry Designer references manifest";
      try {
        const path = join(resolveAgent("designer").packageRoot, "references", "manifest.json");
        const bytes = readFileSync(safe(path), "utf8");
        const manifest = loadReferencesManifest(path);
        referenceHash = `sha256:${sha256Hex(bytes)}`;
        for (const item of manifest.items) references.set(item.dir, item.hash);
      } catch { referenceSource = "unavailable"; inputErrors.push("References manifest could not be read or validated."); }
    }
    rows = resolveSlots(stores, writer, references, await writerAliases(root, inputErrors));
    coverage = slotCoverage(root);
  } catch { inputErrors.push("Slot model inputs could not be read or validated."); }
  for (const issue of modelIssues) {
    const row = rows.find(row => {
      const prefix = `agents/${row.agent}/`;
      return issue.path.startsWith(prefix) && issue.path.split("/")[4] === row.slot;
    });
    const code = issue.code === "pin-invalid" && issue.message.startsWith("one pin only:") ? "multi-pin" : modelCode(issue.code);
    if (row && !row.findings.some(finding => finding.code === code && finding.message === issue.message)) {
      row.findings.push({ code, message: issue.message }); row.status = "violated";
    }
  }
  const findings = [
    ...inputErrors.map(message => ({ rule: "schema", severity: "error" as const, message })),
    ...modelIssues.filter(issue => !rows.some(row => issue.path.startsWith(`agents/${row.agent}/`) && issue.path.split("/")[4] === row.slot)).map(issue => ({ rule: modelCode(issue.code), severity: "error" as const, message: issue.message, path: issue.path })),
    ...rows.flatMap(row => row.findings.map(finding => ({ rule: finding.code, severity: "error" as const, message: finding.message, path: `${row.agent}:${row.slot}` }))),
  ];
  const version = createRequire(import.meta.url)("../../package.json").version as string;
  const envelope = buildCheckOutputEnvelope({ package: "@clossys/producer", version, verdict: inputErrors.length ? "indeterminate" : findings.length ? "violated" : "satisfied", summary: `Slot integrity found ${findings.length} findings across ${rows.length} slots.`, findings });
  return { ...envelope, reportOnly: false as const, exitCode: envelopeToExitCode(envelope), rows, coverage, sources: { references: { source: referenceSource, hash: referenceHash }, ia: stores.map(store => ({ agent: store.agent, source: store.iaSource, slotsHash: `sha256:${sha256Hex(JSON.stringify(store.ia))}` })), root } };
}
export type SlotResolveReport = Awaited<ReturnType<typeof runSlotResolve>>;
export function slotResolveSummary(report: SlotResolveReport, readiness = false): string {
  return ["Slot resolution: " + report.summary, formatCoverage(report.coverage, readiness), ...report.findings.map(finding => `  ${finding.path ?? "model"} [${finding.rule}] ${finding.message}`)].filter(Boolean).join("\n");
}
