/**
 * `clossys migrate slot-1-to-2` (release2 ia-target system.md 4, 6.1; ticket foundry-build-0010 step 5):
 * rewrites every consumer `clossys.slot/1` file as `clossys.slot/2`. Idempotent: a slot/2 file is left alone,
 * so a second run writes no byte.
 *
 * - kind:    designer element by `contract.kind` (token, asset, component, section, frame); writer lexicon -> voice,
 *            narrative -> prose, passage/pattern/string -> copy (and the Copy tree's components, sections, frames,
 *            assets, page and publication prefixes); publisher by id prefix; director brief -> brief.
 *            A Producer `seat` has no slot/2 kind (seats become loop steps) and is reported, not migrated.
 * - ia:      `l0`, `l0/<l1>`, `l0/<l1>/<l2>` (slash paths) of the slot's position in the agent ia.json as it
 *            stands (positionIa: a recut that drops retired ids moves the order of every later slot), else of
 *            the slot/1 `ia`; a missing `l0` is the id's first segment.
 * - refs:    slot/1 `inputs` -> rel `input`, `uses` -> rel `uses`; a bare id resolves to the agent whose consumer
 *            folder holds it (same agent first). An id no folder holds is a finding and the file is not migrated.
 * - base:    the installed package base when the package ships one (the file is then exactly what `ia sync`
 *            writes, keeping status); otherwise null (records.computed-match checks format only).
 * - brief:   purpose from `contract.purpose`, else `contract.question`, else a sentence from the standard;
 *            mustDo from `contract.mustContain`; inputs = the input refs; acceptance empty.
 * - status:  `parked` when slot/1 carried `notNeeded` (kept as `contract.notNeeded`), `live` with a pin.json,
 *            else `starter`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SLOT_SCHEMA, SLOT_V1_SCHEMA, consumerSlotFolders, positionIa, readBaseSlot, serializeSlot, syncedSlot, validateSlot, writeSlot,
} from "../records/slot.js";
import { readIa } from "../records/slots.js";
import { slotPositions, type SlotAgent, type SlotPosition } from "../records/slot-model/index.js";
import type { AgentId, Iso, Ref, Slot, TargetSlotKind } from "../records/types.js";

export const SLOT_1_TO_2 = "slot-1-to-2";
export const SLOT_1_TO_2_CLI = "clossys migrate slot-1-to-2";

export interface SlotV1 {
  schema: typeof SLOT_V1_SCHEMA;
  id: string;
  agent: AgentId;
  ia?: { l0?: string; l1?: string; l2?: string; order?: number };
  kind: string;
  contract?: Record<string, unknown>;
  inputs?: string[];
  uses?: string[];
  standard?: string;
  options?: number;
  varyOn?: string;
  notNeeded?: unknown;
}

export interface MigrateFinding { subject: string; detail: string }
export interface SlotMigration { agent: AgentId; id: string; file: string; slot: Slot; text: string }
export interface Slot1To2Plan {
  root: string;
  migrations: SlotMigration[];
  /** Files already `clossys.slot/2`: left alone. */
  current: string[];
  /** Files with no slot/2 kind (Producer seats): left alone and reported. */
  skipped: MigrateFinding[];
  findings: MigrateFinding[];
}

const DESIGNER_KINDS: Record<string, TargetSlotKind> = {
  token: "element/token", asset: "element/asset", component: "element/component", section: "element/section", frame: "element/frame",
};
const DESIGNER_PREFIXES: Record<string, TargetSlotKind> = {
  themes: "element/token", tokens: "element/token", assets: "element/asset", components: "element/component", sections: "element/section", frames: "element/frame",
};
const WRITER_KINDS: Record<string, TargetSlotKind> = {
  lexicon: "voice", narrative: "prose", narratives: "prose", passage: "copy", passages: "copy", pattern: "copy", patterns: "copy", string: "copy", strings: "copy",
  // The Copy tree's id prefixes (src/catalog/ia/copy.json): the copy of a Designer unit, a page or a publication.
  components: "copy", sections: "copy", frames: "copy", assets: "copy", page: "copy", publication: "copy",
};
const PUBLISHER_PREFIXES: Record<string, TargetSlotKind> = {
  page: "page", pages: "page", layout: "layout", layouts: "layout", chrome: "chrome", release: "release", publication: "publication",
};

/** The slot/2 kind of a slot/1 file, or undefined when it has none. */
export function targetKind(doc: SlotV1): TargetSlotKind | undefined {
  const prefix = doc.id.split(".")[0]!;
  const contractKind = typeof doc.contract?.kind === "string" ? doc.contract.kind : "";
  switch (doc.agent) {
    case "director": return doc.kind === "brief" ? "brief" : undefined;
    case "designer": return DESIGNER_KINDS[contractKind] ?? DESIGNER_PREFIXES[prefix];
    case "writer": return WRITER_KINDS[contractKind] ?? WRITER_KINDS[prefix];
    case "publisher": return PUBLISHER_PREFIXES[prefix];
    case "producer": return prefix === "loop" ? "loop" : undefined;
  }
}

/** slot/1 `ia` as slot/2 slash paths. */
export function targetIa(doc: SlotV1): Slot["ia"] {
  return positionIa(doc.id, doc.ia);
}

/** A slot/2 brief purpose from a contract: `purpose`, else `question`, else a sentence from the standard. */
export function briefPurpose(agent: AgentId, id: string, contract: Readonly<Record<string, unknown>> | undefined, standard: string): string {
  for (const key of ["purpose", "question"]) {
    const value = contract?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return `Fill ${agent}/${id} to the ${standard} standard.`;
}

/** A slot/2 brief mustDo from a contract's `mustContain` (`Answer <key>[: <hint>]`). */
export function briefMustDo(contract: Readonly<Record<string, unknown>> | undefined): string[] {
  const list = contract?.mustContain;
  if (!Array.isArray(list)) return [];
  return list.flatMap(item => {
    if (typeof item === "string") return item.trim() ? [`Answer ${item.trim()}`] : [];
    const { key, hint } = (item ?? {}) as { key?: unknown; hint?: unknown };
    if (typeof key !== "string" || !key.trim()) return [];
    return [typeof hint === "string" && hint.trim() ? `Answer ${key.trim()}: ${hint.trim()}` : `Answer ${key.trim()}`];
  });
}

/** The ia.json positions of one agent, or none when it has no ia.json or one that is not valid. */
export interface SlotFromV1 {
  readonly kind: TargetSlotKind;
  readonly status: Slot["status"];
  readonly ia: Slot["ia"];
  readonly inputs: readonly Ref[];
  readonly uses: readonly Ref[];
  readonly createdBy: Slot["createdBy"];
  readonly at: Iso;
}

/**
 * The `clossys.slot/2` a slot/1 document becomes when no package base ships it (pure): the mapping in this
 * file's header. Shared by this migration and `clossys ia` on a recut store, so both write the same file.
 */
export function slotFromV1(doc: SlotV1, to: SlotFromV1): Slot {
  const standard = typeof doc.standard === "string" && doc.standard ? doc.standard : to.kind;
  const contract: Record<string, unknown> = structuredClone(doc.contract ?? {});
  if (doc.notNeeded !== undefined) contract.notNeeded = structuredClone(doc.notNeeded);
  const slot: Slot = {
    schema: SLOT_SCHEMA, id: doc.id, agent: doc.agent, kind: to.kind, status: to.status, ia: to.ia,
    createdBy: to.createdBy, createdAt: to.at, refs: [...to.inputs, ...to.uses], base: null, standard,
    brief: { purpose: briefPurpose(doc.agent, doc.id, doc.contract, standard), mustDo: briefMustDo(doc.contract), inputs: structuredClone([...to.inputs]), acceptance: [] },
    contract, tighten: [],
  };
  if (doc.options === 1 || doc.options === 2 || doc.options === 3) slot.options = doc.options;
  if (typeof doc.varyOn === "string" && doc.varyOn) slot.varyOn = doc.varyOn;
  return slot;
}

function placedPositions(root: string, agent: AgentId): ReadonlyMap<string, SlotPosition> {
  if (agent === "producer") return new Map();
  try {
    const ia = readIa(join(root, "clossys"), agent as SlotAgent);
    return ia ? slotPositions(agent as SlotAgent, ia) : new Map();
  } catch { return new Map(); }
}

/** What the migration would write under `root` (a directory holding `clossys/agents/`), without writing it. */
export function planSlot1To2(root: string, options: { at: Iso; version: string }): Slot1To2Plan {
  const plan: Slot1To2Plan = { root, migrations: [], current: [], skipped: [], findings: [] };
  const positions = new Map<AgentId, ReadonlyMap<string, SlotPosition>>();
  const iaOf = (doc: SlotV1): Slot["ia"] => {
    if (!positions.has(doc.agent)) positions.set(doc.agent, placedPositions(root, doc.agent));
    const position = positions.get(doc.agent)!.get(doc.id);
    return position ? positionIa(doc.id, position) : targetIa(doc);
  };
  const folders = consumerSlotFolders(root).filter(folder => folder.hasSlot);
  const holders = new Map<string, AgentId[]>();
  for (const folder of folders) holders.set(folder.id, [...(holders.get(folder.id) ?? []), folder.agent]);

  for (const folder of folders) {
    const subject = `${folder.agent}/${folder.id}`;
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(folder.file, "utf8")); } catch (error) { plan.findings.push({ subject, detail: `not JSON: ${(error as Error).message}` }); continue; }
    const schema = (raw as { schema?: unknown }).schema;
    if (schema === SLOT_SCHEMA) { plan.current.push(subject); continue; }
    if (schema !== SLOT_V1_SCHEMA) { plan.findings.push({ subject, detail: `schema is ${String(schema)}, not ${SLOT_V1_SCHEMA}` }); continue; }
    const doc = raw as SlotV1;
    if (doc.id !== folder.id || doc.agent !== folder.agent) { plan.findings.push({ subject, detail: `slot.json names ${doc.agent}/${doc.id}, not its folder` }); continue; }
    const kind = targetKind(doc);
    if (!kind) { plan.skipped.push({ subject, detail: `slot/1 kind ${doc.kind} has no slot/2 kind; left as ${SLOT_V1_SCHEMA}` }); continue; }

    const unresolved: string[] = [];
    const refsOf = (ids: readonly string[] | undefined, rel: Ref["rel"]): Ref[] => (ids ?? []).flatMap(id => {
      const agents = holders.get(id) ?? [];
      const agent = agents.includes(doc.agent) ? doc.agent : agents[0];
      if (!agent) { unresolved.push(id); return []; }
      return [{ to: `${agent}/${id}` as Ref["to"], rel }];
    });
    const inputs = refsOf(doc.inputs, "input");
    const uses = refsOf(doc.uses, "uses");
    if (unresolved.length) { plan.findings.push({ subject, detail: `no consumer slot folder holds ${unresolved.join(", ")}` }); continue; }

    const status: Slot["status"] = doc.notNeeded !== undefined ? "parked" : existsSync(join(folder.dir, "pin.json")) ? "live" : "starter";
    let slot: Slot;
    let base;
    try { base = readBaseSlot(root, doc.agent, doc.id); } catch (error) { plan.findings.push({ subject, detail: (error as Error).message }); continue; }
    if (base) {
      slot = syncedSlot(base, undefined, options.at);
      slot.status = status;
      slot.ia.order = iaOf(doc).order;
    } else {
      slot = slotFromV1(doc, { kind, status, ia: iaOf(doc), inputs, uses, createdBy: { actor: "code", cli: SLOT_1_TO_2_CLI, version: options.version }, at: options.at });
    }
    const issues = validateSlot(slot);
    if (issues.length) { plan.findings.push({ subject, detail: `migrated file is not a valid ${SLOT_SCHEMA}: ${issues.map(issue => `${issue.path} ${issue.message}`).join("; ")}` }); continue; }
    plan.migrations.push({ agent: doc.agent, id: doc.id, file: folder.file, slot, text: serializeSlot(slot) });
  }
  return plan;
}

/** Writes the planned files. Returns the subjects written. */
export function applySlot1To2(plan: Slot1To2Plan): string[] {
  const written: string[] = [];
  for (const migration of plan.migrations) if (writeSlot(migration.file, migration.slot)) written.push(`${migration.agent}/${migration.id}`);
  return written;
}

/** Plan and apply in one call (the verb body; wiring into `clossys migrate` is a follow-up outside this unit). */
export function migrateSlot1To2(root: string, options: { at: Iso; version: string }): Slot1To2Plan & { written: string[] } {
  const plan = planSlot1To2(root, options);
  return { ...plan, written: applySlot1To2(plan) };
}
