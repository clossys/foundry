/**
 * `refs.dangling` (system.md 5, 8, 9): every ref in a committed record points at something that exists.
 *
 * Refs read: slot.json `refs` and `brief.inputs`; consumer candidate header `refs` and `rationale[].sources`;
 * pin and pin map `refs`; Producer queue entry `refs` and `subject`; ledger entry `refs` and `trigger.ref`.
 *
 * A ref dangles when it names
 * - a slot folder that does not exist in the consumer, or a retired slot;
 * - a consumer candidate file that does not exist;
 * - `package:<name>-v<n>.<ext>`, a package default that is not installed under the slot's package defaults folder;
 * - a record of a Writer record slot that neither the pin map nor a package default lists;
 * - a queue or ledger entry (`producer/queue.<kind>` or `producer/ledger.<loop>` with `record`) that does not exist;
 * - a check record (`producer/checks.<name>` with record `<agent>/<slot>`, the pin's CHOOSE scorecard) whose
 *   `.clossys/checks/<agent>/<slot>/<name>.json` does not exist, or whose bytes no longer hash to the ref's sha256;
 * - `facts` when `clossys/facts.json` does not exist.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { candidatePath, packageDefaultDir, parseCandidateName, slotDir } from "../records/candidate.js";
import { pinPath } from "../records/pin.js";
import { sha256Hex } from "../records/hash.js";
import { readPinFile } from "../records/pin-map.js";
import { consumerCandidates, isRecordSlot, listConsumerSlots, packageDefaults, parseRefString, readSlotJson } from "../records/resolve.js";
import { readRecordHeader } from "../records/schema.js";
import type { Ref } from "../records/types.js";
import { runOf, type TargetCheckRun, type TargetFinding } from "./pins-resolve.js";

export const REFS_DANGLING = "refs.dangling";

const isDir = (path: string): boolean => existsSync(path) && statSync(path).isDirectory();
const isRef = (value: unknown): value is Ref =>
  typeof value === "object" && value !== null && typeof (value as { to?: unknown }).to === "string";
const refsOf = (value: unknown): Ref[] => (Array.isArray(value) ? value.filter(isRef) : []);
const label = (ref: Ref): string => `${ref.to}${ref.record ? `#${ref.record}` : ""}${ref.key ? `:${ref.key}` : ""}`;

/** Why a ref dangles, or undefined when its target exists. */
export function danglingReason(root: string, ref: Ref): string | undefined {
  if (ref.to === "facts") return existsSync(join(root, "clossys", "facts.json")) ? undefined : "clossys/facts.json does not exist";
  const parsed = parseRefString(ref.to);
  if (!parsed) return `${ref.to} is not a ref`;
  const { agent, slotId } = parsed;
  if (agent === "producer" && /^(queue|ledger)\./.test(slotId)) {
    const folder = join(root, "clossys", "agents", "producer", slotId);
    if (ref.record === undefined) return isDir(folder) ? undefined : `${ref.to}: no such queue or ledger folder`;
    return existsSync(join(folder, "entries", `${ref.record}.json`)) ? undefined : `${ref.to}#${ref.record}: no such entry`;
  }
  if (agent === "producer" && /^checks\.[a-z][a-z0-9-]*$/.test(slotId)) {
    if (ref.record === undefined || !/^[a-z]+\/[a-z0-9][a-z0-9.-]*$/.test(ref.record)) return `${ref.to}: a check record names <agent>/<slot> as its record`;
    const file = join(root, ".clossys", "checks", ...ref.record.split("/"), `${slotId.slice("checks.".length)}.json`);
    if (!existsSync(file)) return `${ref.to}#${ref.record}: no such check record`;
    // A cited check record is the one the pin saw: a later write over it (a re-pin's scorecard) leaves the old cite dangling.
    if (ref.sha256 !== undefined) {
      const now = sha256Hex(readFileSync(file));
      if (now !== ref.sha256) return `${ref.to}#${ref.record}: the check record's sha256 is ${now.slice(0, 12)}, not the cited ${ref.sha256.slice(0, 12)}`;
    }
    return undefined;
  }
  if (parsed.packageDefault) {
    const name = parsed.candidate!;
    if (parseCandidateName(name)?.version !== 1) return `${ref.to}: a package default is v1 of its name`;
    return existsSync(join(packageDefaultDir(root, agent, slotId), name)) ? undefined : `${ref.to}: package default ${name} is not installed for ${agent}/${slotId}`;
  }
  const slot = readSlotJson(root, agent, slotId);
  if (!existsSync(join(slotDir(root, agent, slotId), "slot.json"))) return `${agent}/${slotId}: no such slot folder in the consumer`;
  if (slot?.status === "retired") return `${agent}/${slotId} is retired`;
  if (parsed.candidate && !existsSync(candidatePath(root, agent, slotId, parsed.candidate))) return `${ref.to}: no such candidate file`;
  if (ref.record !== undefined && isRecordSlot(root, agent, slotId)) {
    const pin = readPinFile(pinPath(root, agent, slotId));
    const listed = pin.kind === "pin-map" && ref.record in pin.doc.records;
    const sample = packageDefaults(root, agent, slotId).some(name => parseCandidateName(name)!.name === ref.record);
    if (!listed && !sample) return `${agent}/${slotId}#${ref.record}: no pin map record and no package default for it`;
  }
  return undefined;
}

interface Source { readonly subject: string; readonly refs: readonly Ref[] }

function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, "utf8")) as unknown; } catch { return undefined; }
}

/** Every committed record and its refs, in a stable order. */
function sources(root: string): Source[] {
  const out: Source[] = [];
  for (const { agent, slotId } of listConsumerSlots(root)) {
    const slot = readJson(join(slotDir(root, agent, slotId), "slot.json")) as { refs?: unknown; brief?: { inputs?: unknown } } | undefined;
    out.push({ subject: `${agent}/${slotId}/slot.json`, refs: [...refsOf(slot?.refs), ...refsOf(slot?.brief?.inputs)] });
    for (const name of consumerCandidates(root, agent, slotId)) {
      let header: { refs?: unknown; rationale?: unknown } | undefined;
      try { header = readRecordHeader(name, readFileSync(candidatePath(root, agent, slotId, name), "utf8")) as typeof header; } catch { header = undefined; }
      const rationale = Array.isArray(header?.rationale) ? header!.rationale as { sources?: unknown }[] : [];
      out.push({ subject: `${agent}/${slotId}/${name}`, refs: [...refsOf(header?.refs), ...rationale.flatMap(item => refsOf(item?.sources))] });
    }
    const pin = readPinFile(pinPath(root, agent, slotId));
    if (pin.kind === "pin" || pin.kind === "pin-map") out.push({ subject: `${agent}/${slotId}/pin.json`, refs: refsOf(pin.doc.refs) });
  }
  const producer = join(root, "clossys", "agents", "producer");
  if (isDir(producer)) {
    for (const folder of readdirSync(producer).filter(name => /^(queue|ledger)\./.test(name)).sort()) {
      const entries = join(producer, folder, "entries");
      if (!isDir(entries)) continue;
      for (const name of readdirSync(entries).filter(file => file.endsWith(".json")).sort()) {
        const doc = readJson(join(entries, name)) as { refs?: unknown; subject?: unknown; trigger?: { ref?: unknown } } | undefined;
        out.push({ subject: `producer/${folder}/entries/${name}`, refs: [...refsOf(doc?.refs), ...refsOf([doc?.subject]), ...refsOf([doc?.trigger?.ref])] });
      }
    }
  }
  return out;
}

export function checkRefsDangling(root: string): TargetCheckRun {
  const findings: TargetFinding[] = [];
  for (const source of sources(root)) {
    for (const ref of source.refs) {
      const reason = danglingReason(root, ref);
      if (reason) findings.push({ check: REFS_DANGLING, subject: source.subject, detail: `${ref.rel} ${label(ref)}: ${reason}` });
    }
  }
  return runOf(REFS_DANGLING, findings);
}
