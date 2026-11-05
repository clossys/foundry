/**
 * `clossys migrate inputs`: declare each Designer and Writer slot's `inputs` from the
 * read graph the engines already have. Plumbing only: no candidate, pin or copy changes.
 *
 * - Designer: the Designer brief's Director slots (every Designer decision reads the brief,
 *   catalog and consumer-only slots alike) plus the Foundry IA's declared inputs (the theme
 *   and asset slots the slot contract reads), kept to slots the consumer has.
 * - Writer: the Foundry IA's declared inputs plus the `director:<slot>@N` refs the pinned
 *   candidate's frontmatter `source.ref` cites.
 *
 * Inputs are only added, never removed: a declared input the graph does not show stays.
 * Deterministic and idempotent: a second run plans no change.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { agentRefs, candidateDocument } from "../records/pinned.js";
import { listSlots, readCandidate, readSlotRecordText, slotIndex } from "../records/slots.js";
import { DESIGN_BRIEF_INPUTS } from "../records/slot-model/design-brief-inputs.js";
import { designerIa, writerIa, type FoundrySlot } from "../records/slot-model/foundry-ia.js";
import { slotFile } from "../records/slot-model/layout.js";

export type InputsAgent = "designer" | "writer";
/** Slot id -> the inputs the Foundry IA declares for it. */
export type InputsCatalog = Readonly<Record<InputsAgent, ReadonlyMap<string, readonly string[]>>>;

export interface InputsChange { readonly agent: InputsAgent; readonly slot: string; readonly added: readonly string[] }
export interface InputsFileChange { readonly path: string; readonly before: string; readonly after: string }
export interface InputsFinding { readonly agent: InputsAgent; readonly slot: string; readonly message: string }
export interface InputsPlan {
  readonly changes: readonly InputsChange[];
  readonly files: readonly InputsFileChange[];
  /** Slots that still declare no inputs after the plan. */
  readonly findings: readonly InputsFinding[];
}

/** The installed Designer and Writer catalogs' declared inputs per slot. */
export function foundryInputsCatalog(): InputsCatalog {
  const index = (slots: ReadonlyMap<string, FoundrySlot>) => new Map([...slots].map(([id, slot]) => [id, slot.declaredInputs]));
  return { designer: index(designerIa().slots), writer: index(writerIa().slots) };
}

/** Plan the declaration for one consumer (`clossys/` folder) against a catalog. Pure apart from reads. */
export function planInputsMigration(consumer: string, catalog: InputsCatalog = foundryInputsCatalog()): InputsPlan {
  const root = join(consumer, "..");
  const rel = (path: string) => relative(root, path).split(sep).join("/");
  const known = slotIndex(consumer);
  const changes: InputsChange[] = [], files: InputsFileChange[] = [], findings: InputsFinding[] = [];
  for (const agent of ["designer", "writer"] as const) {
    for (const entry of listSlots(consumer, agent)) {
      const before = readSlotRecordText(entry.dir, "slot.json");
      if (before === undefined) continue;
      let doc: { inputs?: unknown };
      try { doc = JSON.parse(before); } catch { continue; }
      const declared = Array.isArray(doc.inputs) ? doc.inputs.filter((input): input is string => typeof input === "string") : [];
      const read = new Set([...(agent === "designer" ? DESIGN_BRIEF_INPUTS.map(([, id]) => id as string) : []), ...(catalog[agent].get(entry.id) ?? [])]);
      if (agent === "writer" && entry.pin) {
        try {
          const candidate = readCandidate(consumer, agent, entry.id, entry.pin.candidate);
          for (const ref of agentRefs(candidateDocument({ bytes: candidate.bytes, path: entry.pin.candidate }).fields, "director")) read.add(ref.slot);
        } catch { /* An unreadable pinned candidate is the slot check's finding, not this plan's. */ }
      }
      const added = [...read].filter(input => input !== entry.id && known.has(input) && !declared.includes(input)).sort();
      if (!declared.length && !added.length) findings.push({ agent, slot: entry.id, message: `${agent}/${entry.id}: no input in the read graph; inputs stay undeclared` });
      if (!added.length) continue;
      changes.push({ agent, slot: entry.id, added });
      const after = `${JSON.stringify({ ...doc, inputs: [...declared, ...added] }, null, 2)}\n`;
      files.push({ path: rel(slotFile(entry.dir)), before, after });
    }
  }
  return { changes, files, findings };
}

/** Write a plan's files. The plan's `before` bytes must still be on disk. */
export function applyInputsMigration(consumer: string, plan: InputsPlan): void {
  const root = join(consumer, "..");
  for (const file of plan.files) if (readFileSync(join(root, file.path), "utf8") !== file.before) throw new Error(`${file.path} changed since the inputs plan was made`);
  for (const file of plan.files) writeFileSync(join(root, file.path), file.after);
}
