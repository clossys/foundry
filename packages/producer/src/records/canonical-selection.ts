/** Canonical pin persistence. Decisions come from the consumer's owner-maintained approvals, never this API. */
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { sha256Hex } from "./hash.js";
import { ownerApproval, type OwnerApproval } from "./owner-approval.js";
import { readCandidate, readIa, readPin, readSlot } from "./slots.js";
import {
  CANDIDATE_NAME, KIND_EXT, SLOT_AGENTS, SLOT_ID, candidatesDir, iaPath, jsonBytes, pinFile,
  slotDir, slotFile, slotPositions, validateCandidate, validatePin, validateSlotDoc,
  type PinDoc, type SlotAgent,
} from "./slot-model/index.js";

export interface CanonicalSelectionInput {
  readonly root: string;
  readonly agent: SlotAgent;
  readonly slot: string;
  /** Candidate filename stem; the returned full id is <slot>/<id>. */
  readonly id: string;
  readonly version: number;
  /** SHA256 of the actual candidate bytes, 64 lowercase hexadecimal characters. */
  readonly contentHash: string;
  /** Existing owner decision record id in <root>/approvals.json. */
  readonly approval: string;
  /** SHA256 of previous pin.json bytes; null explicitly requires no existing pin. */
  readonly expectedPinHash: string | null;
}

export interface CanonicalSelection {
  readonly root: string;
  readonly agent: SlotAgent;
  readonly slot: string;
  readonly id: string;
  readonly version: number;
  readonly contentHash: string;
  readonly selected: true;
  readonly approved: true;
  readonly approval: OwnerApproval;
  readonly pin: PinDoc;
  readonly pinHash: string;
  readonly refs: { readonly ia: string; readonly slot: string; readonly candidate: string; readonly pin: string; readonly approval: string };
}

const hex = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const refuse = (reason: string): never => { throw new Error(`CANONICAL-SELECTION: ${reason}`); };

/** Reject aliases, including dangling symlinks, before following any model path. */
function safePath(path: string): void {
  let cursor = resolve(path);
  for (;;) {
    try { if (lstatSync(cursor).isSymbolicLink()) refuse("symbolic link in model path"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const parent = dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

function fileBytes(path: string): Buffer {
  safePath(path);
  if (!lstatSync(path).isFile()) refuse("expected a regular model file");
  return readFileSync(path);
}

/**
 * Persist one explicit owner decision with a cooperative, exclusive per-slot guard.
 * A stale guard or previous-pin conflict refuses without retry. This is evidence
 * validation, not identity authentication; consumers control their approvals file.
 * Rename is the commit point. Unexpected I/O or readback failure afterward can
 * leave the new pin persisted; inspect the actual canonical pin before retrying.
 */
export function persistCanonicalSelection(input: CanonicalSelectionInput): CanonicalSelection {
  if (!SLOT_AGENTS.includes(input.agent) || !SLOT_ID.test(input.slot)
    || typeof input.id !== "string" || !/^[a-z0-9][a-z0-9.-]*$/.test(input.id) || input.id.includes("..")
    || !Number.isSafeInteger(input.version) || input.version < 1 || !hex(input.contentHash)
    || !(input.expectedPinHash === null || hex(input.expectedPinHash))) refuse("explicit target, raw hash and previous pin hash are required");
  const root = resolve(input.root);
  safePath(root);
  const ia = readIa(root, input.agent);
  const position = ia && slotPositions(input.agent, ia).get(input.slot);
  if (!position || [position.l1, position.l2].some(part => part === "." || part === "..")) refuse("slot is not safely placed in IA");
  const dir = slotDir(root, input.agent, position, input.slot);
  const rel = relative(root, dir);
  if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(root, rel) !== dir) refuse("slot escapes consumer root");
  const doc = readSlot(root, input.agent, input.slot);
  if (validateSlotDoc(doc).length || doc.id !== input.slot || doc.agent !== input.agent
    || doc.ia.l0 !== position.l0 || doc.ia.l1 !== position.l1 || doc.ia.l2 !== position.l2 || doc.ia.order !== position.order) refuse("slot identity or position differs from IA");
  const name = `${input.id}-v${input.version}.${KIND_EXT[doc.kind]}`;
  const refs = { ia: iaPath(root, input.agent), slot: slotFile(dir), candidate: join(candidatesDir(dir), name), pin: pinFile(dir), approval: join(root, "approvals.json") };
  const lock = `${refs.pin}.lock`, temp = `${refs.pin}.${randomUUID()}.tmp`;
  const candidate = (candidateName: string): string => {
    const match = CANDIDATE_NAME.exec(candidateName);
    if (!match || !Number.isSafeInteger(Number(match[2])) || match[1]!.includes("..")) refuse("invalid candidate identity");
    const read = readCandidate(root, input.agent, input.slot, candidateName);
    const raw = fileBytes(join(candidatesDir(dir), candidateName));
    if (!raw.equals(Buffer.from(read.bytes)) || sha256Hex(raw) !== read.sha256
      || validateCandidate(doc.kind, input.slot, candidateName, read.bytes).length) refuse("invalid or changed candidate bytes");
    if (doc.kind === "element") {
      const item = JSON.parse(read.bytes);
      if (item.name !== match[1] || (item.meta?.element?.id !== undefined && item.meta.element.id !== match[1])
        || (item.meta?.element?.slot !== undefined && item.meta.element.slot !== input.slot)) refuse("candidate identity differs from filename or slot");
    }
    return read.sha256;
  };
  const inspect = () => {
    for (const path of [...Object.values(refs), lock, temp]) safePath(path);
    if (JSON.stringify(readIa(root, input.agent)) !== JSON.stringify(ia)) refuse("IA changed during selection");
    if (JSON.stringify(readSlot(root, input.agent, input.slot)) !== JSON.stringify(doc)) refuse("slot changed during selection");
    if (candidate(name) !== input.contentHash) refuse("target content hash mismatch");
    const previous = existsSync(refs.pin) ? fileBytes(refs.pin) : null;
    if ((previous && sha256Hex(previous)) !== input.expectedPinHash) refuse("previous pin conflict");
    if (previous) {
      const pin = JSON.parse(previous.toString("utf8"));
      if (validatePin(pin).length || candidate(pin.candidate) !== pin.sha256) refuse("invalid previous pin or candidate drift");
    }
    const evidence = fileBytes(refs.approval);
    if (!evidence.equals(Buffer.from(evidence.toString("utf8")))) refuse("approval evidence is not valid UTF-8");
    return ownerApproval(root, input.approval, { action: "pin", slot: input.slot, element: input.id, version: input.version, hash: input.contentHash }, input.agent);
  };
  inspect();
  const guard = openSync(lock, "wx", 0o600);
  let staged = false;
  try {
    const approval = inspect();
    const pin: PinDoc = { candidate: name, sha256: input.contentHash, pinnedBy: `owner:${approval.reference}`, at: approval.at };
    if (validatePin(pin).length) refuse("owner decision cannot form a valid pin");
    const stage = openSync(temp, "wx", 0o600);
    staged = true;
    try { writeFileSync(stage, jsonBytes(pin)); } finally { closeSync(stage); }
    if (JSON.stringify(inspect()) !== JSON.stringify(approval)) refuse("approval changed during selection");
    renameSync(temp, refs.pin);
    staged = false;
    const readback = readPin(root, input.agent, input.slot);
    if (JSON.stringify(readback) !== JSON.stringify(pin)) refuse("pin readback differs from decision");
    return { root, agent: input.agent, slot: input.slot, id: `${input.slot}/${input.id}`, version: input.version, contentHash: input.contentHash,
      selected: true, approved: true, approval, pin: readback!, pinHash: sha256Hex(fileBytes(refs.pin)), refs };
  } finally {
    if (staged) unlinkSync(temp);
    closeSync(guard);
    unlinkSync(lock);
  }
}
