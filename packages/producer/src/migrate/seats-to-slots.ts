/**
 * One-shot `migrate seats-to-slots` (W2-A, D5; deleted in E1): the Producer seats become slots of
 * kind `seat`. Each placed seat folder `agents/producer/<step>/` moves to `seat.<step>/` (candidates
 * and pin.json move with it, bytes unchanged), gains a slot.json (kind `seat`, its IA position, the
 * contract `{step, fixture: {step}}`; the sample seat is package data, pipeline/seats.json), and producer ia.json
 * places `seat.<step>` where it placed `<step>`.
 *
 * Deterministic and idempotent: a second run plans no change. `check` plans without writing and
 * fails while a change is still pending. A folder the IA does not place, or a move whose target
 * already exists, is a finding and is never touched.
 */
import { join, relative, sep } from "node:path";
import { isModelDir, listModelDir, modelExists, readModelText } from "../records/slots.js";
import { createModelFile, moveModelEntry, replaceModelFile } from "../records/slot-write.js";
import { agentDir, iaPath, jsonBytes, slotFile } from "../records/slot-model/layout.js";
import { slotPositions } from "../records/slot-model/foundry-ia.js";
import { SEAT_AGENT, SEAT_PREFIX, SLOT_SCHEMA, seatSlotId, seatStepOf, type IaDoc } from "../records/slot-model/types.js";
import { validateIa, validateSlotDoc } from "../records/slot-model/validate.js";

export interface SeatsToSlotsPlan {
  /** Folder moves, consumer-relative (`agents/producer/<step>` to `agents/producer/seat.<step>`). */
  readonly moves: readonly { readonly from: string; readonly to: string }[];
  /** slot.json files to write, consumer-relative path (after the move) and bytes. */
  readonly slots: readonly { readonly path: string; readonly bytes: string }[];
  /** The rewritten producer ia.json, when any id changes. */
  readonly ia?: { readonly path: string; readonly bytes: string };
  readonly findings: readonly string[];
}

const posix = (path: string) => path.split(sep).join("/");
// Reads go through the slot-model reader and writes through records/slot-write.ts (R11.1).
const isDir = isModelDir;

export function planSeatsToSlots(consumer: string): SeatsToSlotsPlan {
  const root = agentDir(consumer, SEAT_AGENT);
  const rel = (path: string) => posix(relative(consumer, path));
  const findings: string[] = [];
  const iaFile = iaPath(consumer, SEAT_AGENT);
  if (!modelExists(iaFile)) return { moves: [], slots: [], findings: [`${rel(iaFile)} is missing`] };
  const ia = JSON.parse(readModelText(iaFile)) as IaDoc;
  const renamed: IaDoc = {
    ...ia,
    nodes: ia.nodes.map(node => ({ ...node, children: node.children.map(child => ({ ...child, slots: child.slots.map(id => (id.startsWith(SEAT_PREFIX) ? id : seatSlotId(id))) })) })),
  };
  const iaIssues = validateIa(renamed, rel(iaFile), SEAT_AGENT);
  if (iaIssues.length) return { moves: [], slots: [], findings: iaIssues.map(issue => issue.message) };
  const positions = slotPositions(SEAT_AGENT, renamed);
  const placed = new Set(positions.keys());
  const moves: { from: string; to: string }[] = [];
  const slots: { path: string; bytes: string }[] = [];
  for (const name of [...listModelDir(root)].sort()) {
    if (!isDir(join(root, name)) || name.startsWith(SEAT_PREFIX)) continue;
    if (!placed.has(seatSlotId(name))) findings.push(`${rel(join(root, name))} is not a seat producer ia.json places; left as it is`);
  }
  for (const [id, position] of positions) {
    const step = seatStepOf(id)!;
    const from = join(root, step), to = join(root, id);
    let dir = to;
    if (isDir(from)) {
      if (modelExists(to)) { findings.push(`${rel(from)} and ${rel(to)} both exist; resolve by hand`); continue; }
      moves.push({ from: rel(from), to: rel(to) });
      dir = from;
    } else if (!isDir(to)) continue; // an open seat: placed, never written; its first `clossys seat` writes the folder.
    if (modelExists(slotFile(dir))) continue;
    const doc = { schema: SLOT_SCHEMA, id, agent: SEAT_AGENT, ia: position, kind: "seat", contract: { step, fixture: { step } }, inputs: [], uses: [] };
    const issues = validateSlotDoc(doc, rel(slotFile(to)));
    if (issues.length) { findings.push(...issues.map(issue => `${issue.path}: ${issue.message}`)); continue; }
    slots.push({ path: rel(slotFile(to)), bytes: jsonBytes(doc) });
  }
  const bytes = jsonBytes(renamed);
  const changed = bytes !== readModelText(iaFile);
  return { moves, slots, ...(changed ? { ia: { path: rel(iaFile), bytes } } : {}), findings };
}

export function applySeatsToSlots(consumer: string, plan: SeatsToSlotsPlan): void {
  if (plan.findings.length) throw new Error(`seats-to-slots: resolve the findings first: ${plan.findings.join("; ")}`);
  for (const move of plan.moves) moveModelEntry(join(consumer, move.from), join(consumer, move.to));
  for (const slot of plan.slots) createModelFile(join(consumer, slot.path), slot.bytes);
  if (plan.ia) replaceModelFile(join(consumer, plan.ia.path), plan.ia.bytes);
}

/** `check`: plan only, exit 1 while anything is pending or a finding stands. Otherwise apply, exit 1 on a finding. */
export function runSeatsToSlots(consumer: string, options: { readonly check?: boolean } = {}): { exitCode: number; message: string } {
  const plan = planSeatsToSlots(consumer);
  const summary = `seats-to-slots: ${plan.moves.length} folder(s) to move, ${plan.slots.length} slot.json to write, ia.json ${plan.ia ? "to rewrite" : "current"}`;
  const findings = plan.findings.map(finding => `  ${finding}`).join("\n");
  if (plan.findings.length) return { exitCode: 1, message: `${summary}\n${findings}` };
  const pending = plan.moves.length + plan.slots.length + (plan.ia ? 1 : 0);
  if (options.check) return { exitCode: pending ? 1 : 0, message: pending ? summary : "seats-to-slots: current" };
  applySeatsToSlots(consumer, plan);
  return { exitCode: 0, message: pending ? `seats-to-slots: moved ${plan.moves.length} folder(s), wrote ${plan.slots.length} slot.json, ia.json ${plan.ia ? "rewritten" : "current"}` : "seats-to-slots: current" };
}
