/**
 * The slot.json of a recut target that has none (foundry-build-0031, review P2-1). A retired id that moves to a
 * live leaf with no consumer folder gets a candidates-only folder that ia.json places; this writes that folder's
 * `clossys.slot/2` from the package's own definition of the leaf, the `slots` rows of the package's
 * src/catalog/ia/<group>.json (`{id, kind, mark, inputs, contract}`, the Writer target trees), never from
 * invented fields:
 *
 * - kind, contract: the definition's; refs: its inputs (rel `input` unless named), in order.
 * - ia: the slash-path ia of the target's position in the recut ia.json (positionIa, as slot-1-to-2 writes).
 * - status: `parked` for a `parked` mark, else `starter` (no pin yet); base null (the package ships no base).
 * - standard: the kind; brief: purpose and mustDo from the contract (as slot-1-to-2), inputs = the refs.
 * - createdBy: `{actor: code, cli: clossys migrate recut}`.
 *
 * A target the package defines no slot for is named, and no file is written for it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { agentPackageRoot, positionIa, serializeSlot, SLOT_SCHEMA, validateSlot } from "../records/slot.js";
import type { SlotPosition } from "../records/slot-model/types.js";
import type { AgentId, Iso, Ref, Slot, TargetSlotKind } from "../records/types.js";
import { briefMustDo, briefPurpose } from "./slot-1-to-2.js";

export interface SlotDefinition {
  readonly id: string;
  readonly kind: string;
  readonly mark?: string;
  readonly inputs: readonly { readonly to: string; readonly rel?: string; readonly key?: string }[];
  readonly contract: Record<string, unknown>;
  /** The package file that defines it, package-relative. */
  readonly file: string;
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Every slot the package of `agent` defines in src/catalog/ia/*.json `slots` rows, by id. */
export function slotDefinitions(dir: string, agent: AgentId): Map<string, SlotDefinition> {
  const out = new Map<string, SlotDefinition>();
  const iaDir = join(agentPackageRoot(dir, agent), "src", "catalog", "ia");
  if (!existsSync(iaDir) || !statSync(iaDir).isDirectory()) return out;
  for (const name of readdirSync(iaDir).filter(file => file.endsWith(".json")).sort()) {
    let doc: unknown;
    try { doc = JSON.parse(readFileSync(join(iaDir, name), "utf8")); } catch { continue; }
    if (!object(doc) || !Array.isArray(doc.slots)) continue;
    for (const row of doc.slots) {
      if (!object(row) || typeof row.id !== "string" || typeof row.kind !== "string" || !object(row.contract)) continue;
      const inputs = Array.isArray(row.inputs) ? row.inputs.filter(object).flatMap(input => typeof input.to === "string"
        ? [{ to: input.to, ...(typeof input.rel === "string" ? { rel: input.rel } : {}), ...(typeof input.key === "string" ? { key: input.key } : {}) }] : []) : [];
      out.set(row.id, { id: row.id, kind: row.kind, ...(typeof row.mark === "string" ? { mark: row.mark } : {}), inputs, contract: row.contract, file: `src/catalog/ia/${name}` });
    }
  }
  return out;
}

/** The current slot.json the definition gives at `position`. Throws when the result is not a valid clossys.slot/2. */
export function definedSlot(definition: SlotDefinition, agent: AgentId, position: SlotPosition, options: { at: Iso; cli: string; version: string }): Slot {
  const refs: Ref[] = definition.inputs.map(input => ({ to: input.to as Ref["to"], rel: (input.rel ?? "input") as Ref["rel"], ...(input.key !== undefined ? { key: input.key } : {}) }));
  const kind = definition.kind as TargetSlotKind;
  const contract = structuredClone(definition.contract);
  const slot: Slot = {
    schema: SLOT_SCHEMA, id: definition.id, agent, kind, status: definition.mark === "parked" ? "parked" : "starter",
    ia: positionIa(definition.id, position),
    createdBy: { actor: "code", cli: options.cli, version: options.version }, createdAt: options.at,
    refs, base: null, standard: kind,
    brief: { purpose: briefPurpose(agent, definition.id, contract, kind), mustDo: briefMustDo(contract), inputs: structuredClone(refs.filter(ref => ref.rel === "input")), acceptance: [] },
    contract, tighten: [],
  };
  const issues = validateSlot(slot);
  if (issues.length) throw new Error(`${agent}/${definition.id}: the package definition (${definition.file}) gives no valid ${SLOT_SCHEMA}: ${issues.slice(0, 3).map(issue => `${issue.path} ${issue.message}`).join("; ")}`);
  return slot;
}

export const definedSlotBytes = (slot: Slot): string => serializeSlot(slot);
