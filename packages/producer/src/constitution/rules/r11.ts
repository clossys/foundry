/**
 * R11 One resolver (slot-constitution.md R11; unit W2-D).
 *
 * R11.1 Only records/slots.ts reads the agent trees and only records/slot-write.ts writes them:
 * scripts/check-single-reader.mjs (not shipped), its reader scan (`reader` findings) and its writer scan of the
 * reader itself (`writer` findings).
 * R11.2 Only records/citations.ts `resolveCitation()` turns a citation into a candidate: the same
 * script's resolver scan (a citation parser imported anywhere else), plus every slot reference the
 * compiled records make that resolves to no registered slot. A slot-shaped id under a reference key
 * (icon, frame, frameId, section, sections, sectionIds, slot, uses, the keys of `inputs`) in a
 * pinned Publisher record or in packages/producer/studio/generated/studio-map.json must be a live
 * slot of some agent; a dangling one would otherwise be skipped silently by the consumers.
 *
 * These are code rules: unlike the record rules they read code and compiled output, so they run
 * the repository's check scripts (one spawn each) and read the compiled Studio map. A root without
 * packages/producer/package.json has no code to judge and gives no row.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CITATION_SLOT_ID } from "@clossys/director";
import { isObject, liveSlotRecords } from "../checks/shared.js";
import type { ConstitutionContext, Row, RuleId, RuleModule } from "../types.js";

/** The repository this module ships in (src/constitution/rules or dist/constitution/rules). */
export const MODULE_REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");

/** Whether `root` holds code to judge (the Producer package). */
export const hasCode = (root: string): boolean => existsSync(join(root, "packages/producer/package.json"));

/**
 * Whether the repository code scripts run: `root` holds code and the run is not focused. A focused
 * run (`check --slot`, `check --changed`, a write guard) keeps only the rows on its slots, and a
 * code finding belongs to no slot (codeRow), so the scripts would cost seconds for rows the run
 * drops; the unfocused root check runs them (foundry-feedback-0018).
 */
export const judgesCode = (ctx: ConstitutionContext): boolean => !ctx.focus && hasCode(ctx.root);

/** A code finding: no slot owns it. */
export function codeRow(rule: RuleId, check: string, reason: string, path: string): Row {
  return { rule, check, agent: "*", slot: "*", reason, path };
}

export interface ScriptRun { readonly status: number | null; readonly stdout: string; readonly stderr: string; readonly error?: string }

/** Runs one repository check script (relative to MODULE_REPO) against `root`. */
export function runScript(script: string, args: readonly string[]): ScriptRun {
  const result = spawnSync(process.execPath, [join(MODULE_REPO, script), ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600_000 });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", ...(result.error ? { error: result.error.message } : {}) };
}

/** The row for a script that did not run to a verdict (usage error, crash, unparseable output). */
export function brokenScript(rule: RuleId, check: string, script: string, run: ScriptRun): Row {
  const tail = (run.error ?? (run.stderr || run.stdout)).trim().split("\n").slice(-2).join(" | ").slice(0, 240);
  return codeRow(rule, check, `${script} gave no verdict (exit ${run.status ?? "signal"}): ${tail}`, script);
}

export interface SingleReaderFinding { readonly file: string; readonly line: number; readonly call?: string; readonly text?: string; readonly kind?: string }

const SINGLE_READER = "scripts/check-single-reader.mjs";

/** Rows for R11.1 (reader and writer findings) and R11.2 (resolver findings) from the script's JSON. */
export function singleReaderRows(findings: readonly SingleReaderFinding[]): { r111: Row[]; r112: Row[] } {
  const r111: Row[] = [], r112: Row[] = [];
  for (const finding of findings) {
    const at = `${finding.file}:${finding.line}`;
    const text = (finding.text ?? finding.call ?? "").replace(/\s+/g, " ").slice(0, 120);
    if (finding.kind === "resolver") r112.push(codeRow("R11", "R11.2", `a citation parser is used outside the resolver: ${text}`, at));
    else if (finding.kind === "writer") r111.push(codeRow("R11", "R11.1", `the reader writes the slot model (only records/slot-write.ts writes it): ${text}`, at));
    else r111.push(codeRow("R11", "R11.1", `the slot model is opened outside records/slots.ts and records/slot-write.ts: ${text}`, at));
  }
  return { r111, r112 };
}

/** One script run per context: R11.1 and R11.2 share it. */
const singleReaderRuns = new WeakMap<ConstitutionContext, { r111: Row[]; r112: Row[] }>();
function singleReader(ctx: ConstitutionContext): { r111: Row[]; r112: Row[] } {
  const cached = singleReaderRuns.get(ctx);
  if (cached) return cached;
  const run = runScript(SINGLE_READER, ["--root", ctx.root, "--json"]);
  let rows: { r111: Row[]; r112: Row[] };
  try {
    if (run.status !== 0 && run.status !== 1) throw new Error("exit");
    const doc = JSON.parse(run.stdout) as { findings?: SingleReaderFinding[] };
    if (!Array.isArray(doc.findings)) throw new Error("shape");
    rows = singleReaderRows(doc.findings);
  } catch {
    const broken = brokenScript("R11", "R11.1", SINGLE_READER, run);
    rows = { r111: [broken], r112: [{ ...broken, check: "R11.2" }] };
  }
  singleReaderRuns.set(ctx, rows);
  return rows;
}

/** Keys whose values (and `inputs`, whose keys) name slots. */
const REFERENCE_KEYS = new Set(["icon", "frame", "frameId", "section", "sections", "sectionIds", "slot", "uses"]);

/** A slot id from a reference value: an optional `<agent>:` prefix and `#<key>` suffix dropped. */
function referencedSlot(value: string): string | undefined {
  const id = value.replace(/^(?:director|designer|writer|publisher|producer):/, "").split("#")[0]!;
  return CITATION_SLOT_ID.test(id) ? id : undefined;
}

export interface DanglingReference { readonly id: string; readonly at: string; readonly count: number }

/** Slot references in a JSON document that name no registered slot: one entry per id, first JSON path and count. */
export function danglingReferences(doc: unknown, registered: ReadonlySet<string>): DanglingReference[] {
  const found = new Map<string, { at: string; count: number }>();
  const note = (value: unknown, at: string) => {
    if (typeof value !== "string") return;
    const id = referencedSlot(value);
    if (!id || registered.has(id)) return;
    const seen = found.get(id);
    if (seen) seen.count++; else found.set(id, { at, count: 1 });
  };
  const walk = (node: unknown, at: string) => {
    if (Array.isArray(node)) { node.forEach((item, index) => walk(item, `${at}[${index}]`)); return; }
    if (!isObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const here = at ? `${at}.${key}` : key;
      if (REFERENCE_KEYS.has(key)) {
        if (Array.isArray(value)) value.forEach((item, index) => note(item, `${here}[${index}]`));
        else note(value, here);
      }
      if (key === "inputs" && isObject(value)) for (const name of Object.keys(value)) note(name, `${here}{${name}}`);
      walk(value, here);
    }
  };
  walk(doc, "");
  return [...found].map(([id, { at, count }]) => ({ id, at, count })).sort((a, b) => a.id.localeCompare(b.id));
}

/** Every live slot id across the agent trees. */
export function registeredSlots(ctx: ConstitutionContext): Set<string> {
  return new Set(ctx.agents.flatMap(agent => agent.liveIds));
}

export const STUDIO_MAP = "packages/producer/studio/generated/studio-map.json";

/** R11.2 dangling references: pinned Publisher records (the content map) and the compiled Studio map. */
export function danglingRows(ctx: ConstitutionContext, studioMap: { present: boolean; doc?: unknown; error?: string } | undefined): Row[] {
  const registered = registeredSlots(ctx);
  const rows: Row[] = [];
  for (const slot of liveSlotRecords(ctx)) {
    if (slot.agent !== "publisher") continue;
    const pinned = isObject(slot.pin?.value) && typeof slot.pin.value.candidate === "string" ? slot.pin.value.candidate : undefined;
    const candidate = pinned ? slot.candidates.find(item => item.name === pinned) : undefined;
    if (!candidate?.json) continue;
    for (const ref of danglingReferences(candidate.json, registered)) {
      rows.push({ rule: "R11", check: "R11.2", agent: slot.agent, slot: slot.id, candidate: candidate.name, reason: `${ref.at} names ${ref.id}, which is no registered slot (${ref.count} reference${ref.count === 1 ? "" : "s"})`, path: candidate.path });
    }
  }
  if (studioMap) {
    if (!studioMap.present) rows.push(codeRow("R11", "R11.2", "the compiled Studio map is missing: run clossys compile", STUDIO_MAP));
    else if (studioMap.error !== undefined) rows.push(codeRow("R11", "R11.2", `the compiled Studio map is unreadable: ${studioMap.error}`, STUDIO_MAP));
    else for (const ref of danglingReferences(studioMap.doc, registered)) {
      rows.push(codeRow("R11", "R11.2", `${ref.at} names ${ref.id}, which is no registered slot (${ref.count} reference${ref.count === 1 ? "" : "s"} in the compiled map)`, STUDIO_MAP));
    }
  }
  return rows;
}

function readStudioMap(root: string): { present: boolean; doc?: unknown; error?: string } | undefined {
  if (!existsSync(join(root, "packages/producer/studio"))) return undefined;
  const path = join(root, STUDIO_MAP);
  if (!existsSync(path)) return { present: false };
  try { return { present: true, doc: JSON.parse(readFileSync(path, "utf8")) as unknown }; }
  catch (error) { return { present: true, error: error instanceof Error ? error.message : String(error) }; }
}

export const R11: RuleModule = {
  rule: "R11",
  checks: {
    "R11.1": ctx => (judgesCode(ctx) ? singleReader(ctx).r111 : []),
    "R11.2": ctx => [
      ...(judgesCode(ctx) ? singleReader(ctx).r112 : []),
      ...danglingRows(ctx, hasCode(ctx.root) ? readStudioMap(ctx.root) : undefined),
    ],
  },
};
