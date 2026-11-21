/**
 * The one base a consumer slot resolves from, for the strict checks that compare a slot with its base
 * (`records.computed-match`, `brief.tighten-only`; foundry-build-0048 CHECK-FIX P2).
 *
 * A content agent's loop slot (`kind: loop`, written by `clossys loop`, loop/agent-loop-adopt.ts) declares its base:
 * `base.package` and `base.path`, the agent package's loop candidate. Its base is read from exactly that declared
 * file and nowhere else; a declared base that is missing or unreadable is a finding, never a lookup elsewhere. The
 * base document is the slot.json the adopt verb computes from those bytes (adoptedLoopSlot). Every other package
 * slot resolves from the package catalog (records/slot.ts readBaseSlot), as before.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { packagePath } from "../package-path.js";
import { readCandidateFile } from "../records/candidate.js";
import { readBaseSlot, type BaseSlot } from "../records/slot.js";
import { iaPath } from "../records/slot-model/layout.js";
import { slotPositions } from "../records/slot-model/foundry-ia.js";
import type { IaDoc } from "../records/slot-model/types.js";
import type { Slot } from "../records/types.js";
import { adoptedLoopSlot } from "../loop/agent-loop-adopt.js";
import { isAgentLoop, isLoopAgent, withAgentLoopsIa, type AgentLoopName, type LoopAgent } from "../loop/agent-loops-ia.js";

/** A content agent's loop slot: its base is the file its `base` declares. */
export const declaresLoopBase = (slot: Pick<Slot, "agent" | "id" | "kind">): boolean =>
  slot.kind === "loop" && isLoopAgent(slot.agent) && isAgentLoop(slot.id);

/** A package-relative path with no absolute, `.` or `..` segment. */
const SAFE_PATH = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const PACKAGE_NAME = /^@clossys\/([a-z][a-z0-9-]*)$/;

/**
 * The base of loop slot `slot`, read from its declared `base.package`/`base.path` only. Throws, naming the declared
 * base, when it is missing (no such package, version or file) or unreadable (not a regular readable file, not a
 * valid package loop candidate of this slot).
 */
export function readDeclaredLoopBase(root: string, slot: Slot): BaseSlot {
  const declared = slot.base;
  if (declared === null) throw new Error(`${slot.agent}/${slot.id} declares no base`);
  const ref = `${declared.package}/${declared.path}`;
  const name = PACKAGE_NAME.exec(declared.package)?.[1];
  if (!name || !SAFE_PATH.test(declared.path)) throw new Error(`declared base ${ref} is unreadable: not a @clossys/<name> package path`);
  const file = packagePath(root, `packages/${name}/${declared.path}`);
  const manifest = packagePath(root, `packages/${name}/package.json`);
  if (!existsSync(file) || !existsSync(manifest)) throw new Error(`declared base ${ref} is missing`);
  let bytes: Buffer, version: unknown;
  try {
    bytes = readFileSync(file);
    version = (JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown }).version;
  } catch (error) { throw new Error(`declared base ${ref} is unreadable: ${(error as Error).message}`); }
  if (typeof version !== "string" || !version) throw new Error(`declared base ${ref} is unreadable: ${declared.package} names no version`);
  const agent = slot.agent as LoopAgent, loop = slot.id as AgentLoopName;
  const read = readCandidateFile(file, { agent, slotId: loop, packageDefault: true });
  if (read.issues.length) throw new Error(`declared base ${ref} is unreadable: ${read.issues.slice(0, 3).join("; ")}`);
  const consumer = join(root, "clossys");
  let ia: IaDoc;
  try { ia = JSON.parse(readFileSync(iaPath(consumer, agent), "utf8")) as IaDoc; } catch (error) { throw new Error(`clossys/agents/${agent}/ia.json is unreadable: ${(error as Error).message}`); }
  const position = slotPositions(agent, withAgentLoopsIa(agent, ia)).get(loop);
  const doc = adoptedLoopSlot(agent, loop, { version, packageBytes: bytes, position, at: slot.createdAt });
  return { doc, version, meta: { ...doc.base! } };
}

/**
 * The one base `slot` resolves from: its declared base for a loop slot (readDeclaredLoopBase, throwing when that is
 * missing or unreadable), else the package catalog base (undefined when the package ships none).
 */
export function resolveSlotBase(root: string, slot: Slot): BaseSlot | undefined {
  return declaresLoopBase(slot) ? readDeclaredLoopBase(root, slot) : readBaseSlot(root, slot.agent, slot.id);
}
