/**
 * `clossys compile` for a consumer that does not place the Studio publication: it compiles the consumer's own
 * publications, the `publication.<id>` slots its Publisher IA places, and never the Studio.
 *
 * - A pinned publication is projected by Publisher's pure projector (frame + sections pages only, through
 *   `readPinnedPublication`) with its titles resolved through the Writer, and written to
 *   `<out>/publications/<id>.json`. A projection the pins cannot satisfy is a finding (exit 1).
 * - A placed publication with no pin yet is recorded as `unresolved`, not a finding: whether a release may ship with
 *   it is the `pins.resolve` release gate's call, so the release loop's compile step does not stop on it.
 * - No placed publication at all is a finding naming the owner IA decision that seats one.
 *
 * `<out>/publications.json` lists every publication and its state; `<out>/compile.lock.json` (clossys.compile-lock/1)
 * holds the sha256 of every file read and written. Deterministic and offline: no model, no agent, no network.
 */
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { listSlots, readAgentFile, readCandidate } from "../records/slots.js";
import { readPinnedPublication, resolvePublicationTitles } from "./pinned-publication.js";

export const PUBLICATION_SLOT = /^publication\.([a-z][a-z0-9-]*)$/;
export const COMPILE_LOCK_SCHEMA = "clossys.compile-lock/1";
export const COMPILED_PUBLICATIONS_SCHEMA = "clossys.compiled-publications/1";
/** Where the release loop's compile step writes, relative to the workspace root (loop.release step `compile`). */
export const GENERATED_DIR = join(".clossys", "generated");
export const SEAT_PUBLICATION = "clossys ia publisher/publication.<id> --under <l1>/<l2> --kind publication --contract <file>";

export interface CompileFinding { readonly check: "compile.no-publication" | "compile.publication"; readonly subject: string; readonly detail: string }
export interface CompiledPublication {
  readonly id: string;
  readonly slot: string;
  readonly state: "compiled" | "unresolved";
  /** The projection written, relative to the workspace root (compiled only). */
  readonly file?: string;
  /** Why it was not compiled (unresolved only). */
  readonly reason?: string;
}
export interface PublicationsCompile {
  readonly out: string;
  readonly lock: string;
  readonly inputs: number;
  readonly outputs: number;
  readonly publications: readonly CompiledPublication[];
  readonly findings: readonly CompileFinding[];
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const posix = (path: string): string => path.split(sep).join("/");
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Compiles the publications of the workspace at `root` (the folder holding `clossys/`) into `out`. */
export async function compilePublications(root: string, out: string): Promise<PublicationsCompile> {
  const consumer = join(root, "clossys");
  const inputs = new Map<string, string>();
  const read = (path: string, text: string) => { inputs.set(`clossys/${path}`, sha256(text)); };
  const outputs = new Map<string, string>();
  const write = (file: string, text: string) => { writeFileSync(file, text); outputs.set(posix(relative(root, file)), sha256(text)); };

  const ia = readAgentFile(consumer, "publisher", "ia.json");
  if (ia !== undefined) read("agents/publisher/ia.json", ia);
  const placed = listSlots(consumer, "publisher").filter(entry => PUBLICATION_SLOT.test(entry.id));
  const findings: CompileFinding[] = [];
  const publications: CompiledPublication[] = [];
  if (placed.length === 0) {
    findings.push({
      check: "compile.no-publication", subject: "publisher/ia.json",
      detail: `the Publisher IA places no publication.<id> slot, so there is nothing to compile; seating one is an owner IA decision (${SEAT_PUBLICATION})`,
    });
  }

  // Only this compile's own folder is replaced, so a publication that left the IA leaves no stale projection.
  const dir = join(out, "publications");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let titled = false;
  for (const entry of placed) {
    const id = PUBLICATION_SLOT.exec(entry.id)![1]!;
    if (!entry.pin) {
      publications.push({ id, slot: `publisher/${entry.id}`, state: "unresolved", reason: `publisher/${entry.id} has no pin yet; pins.resolve judges it at release` });
      continue;
    }
    try {
      const pinned = resolvePublicationTitles(consumer, await readPinnedPublication(consumer, id, read));
      titled = true;
      const file = join(dir, `${id}.json`);
      write(file, json({ publicationId: id, map: pinned.map, ...(pinned.routePack ? { routePack: pinned.routePack } : {}) }));
      publications.push({ id, slot: `publisher/${entry.id}`, state: "compiled", file: posix(relative(root, file)) });
    } catch (error) {
      findings.push({ check: "compile.publication", subject: `publisher/${entry.id}`, detail: (error as Error).message });
    }
  }
  if (titled) {
    // Titles resolve through the pinned Writer strings, so those candidates are inputs too.
    for (const entry of listSlots(consumer, "writer")) {
      if (!entry.pin || !entry.id.startsWith("strings.")) continue;
      const candidate = readCandidate(consumer, "writer", entry.id, entry.pin.candidate);
      read(`agents/writer/${entry.id}/candidates/${candidate.name}`, candidate.bytes);
    }
  }

  write(join(out, "publications.json"), json({ schema: COMPILED_PUBLICATIONS_SCHEMA, publications }));
  const entries = (map: Map<string, string>) => [...map].sort(([a], [b]) => a.localeCompare(b)).map(([path, hash]) => ({ path, sha256: hash }));
  const lock = join(out, "compile.lock.json");
  writeFileSync(lock, json({ schema: COMPILE_LOCK_SCHEMA, decisionInputs: [...inputs.keys()].sort(), inputs: entries(inputs), outputs: entries(outputs) }));
  return { out, lock, inputs: inputs.size, outputs: outputs.size, publications, findings };
}
