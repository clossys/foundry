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
 * - A retired `publication.<id>` slot is skipped, as `pins.resolve` skips it.
 *
 * `<out>/publications.json` lists every publication and its state; `<out>/compile.lock.json` (clossys.compile-lock/1)
 * holds the sha256 of every file read and written (outputs relative to `<out>`, as the Studio lock records them).
 * Deterministic and offline: no model, no agent, no network.
 *
 * `--out` may be any folder the caller names, so compile deletes only what a previous compile recorded: a file under
 * `<out>/publications/` is removed only when the prior `<out>/compile.lock.json` lists it with its current sha256.
 * Anything else there (a user file, an edited projection, a symlink, no prior lock) is `compile.out-unowned`
 * (exit 1) and nothing is deleted or written. Deletes never leave `<real out>/publications/`.
 */
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import { join, relative, sep } from "node:path";
import { readSlotJson } from "../records/resolve.js";
import { listSlots, readAgentFile, readCandidate } from "../records/slots.js";
import { writerCopyPins } from "../records/writer-copy-slots.js";
import { readPinnedPublication, resolvePublicationTitles } from "./pinned-publication.js";

export const PUBLICATION_SLOT = /^publication\.([a-z][a-z0-9-]*)$/;
export const COMPILE_LOCK_SCHEMA = "clossys.compile-lock/1";
export const COMPILED_PUBLICATIONS_SCHEMA = "clossys.compiled-publications/1";
/** Where the release loop's compile step writes, relative to the workspace root (loop.release step `compile`). */
export const GENERATED_DIR = join(".clossys", "generated");
export const LOCK_FILE = "compile.lock.json";

/**
 * The pinned Writer copy candidates a titled publication resolves through, as compile-lock inputs: every pinned record
 * of every Writer copy slot (records/writer-copy-slots.ts: Writer's tree data, never a `strings.` prefix), the ones
 * `writerCopy` reads.
 */
export function writerCopyInputs(consumer: string): { path: string; bytes: string }[] {
  return writerCopyPins(consumer).map(({ entry, pin }) => {
    const candidate = readCandidate(consumer, "writer", entry.id, pin.candidate);
    return { path: `agents/writer/${entry.id}/candidates/${candidate.name}`, bytes: candidate.raw }; // the lock hashes the file
  });
}
export const PUBLICATIONS_FILE = "publications.json";
/** A projection path this compile writes, relative to `<out>`. */
const PROJECTION = /^publications\/[a-z][a-z0-9-]*\.json$/;
export const SEAT_PUBLICATION = "clossys ia publisher/publication.<id> --under <l1>/<l2> --kind publication --contract <file>";

export interface CompileFinding { readonly check: "compile.no-publication" | "compile.publication" | "compile.out-unowned"; readonly subject: string; readonly detail: string }
export interface CompiledPublication {
  readonly id: string;
  readonly slot: string;
  readonly state: "compiled" | "unresolved";
  /** The projection written, relative to `<out>` (compiled only). */
  readonly file?: string;
  /** Why it was not compiled (unresolved only). */
  readonly reason?: string;
}
export interface PublicationsCompile {
  /** The real path of `<out>`. */
  readonly out: string;
  /** False when compile refused `<out>` (compile.out-unowned): nothing was deleted or written, and there is no new lock. */
  readonly written: boolean;
  readonly lock: string;
  readonly inputs: number;
  readonly outputs: number;
  readonly publications: readonly CompiledPublication[];
  readonly findings: readonly CompileFinding[];
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const posix = (path: string): string => path.split(sep).join("/");
const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const lstat = (path: string): Stats | undefined => { try { return lstatSync(path); } catch { return undefined; } };

/** The outputs the prior `<target>/compile.lock.json` records (path relative to target -> sha256); undefined without a readable lock. */
function priorOutputs(target: string): Map<string, string> | undefined {
  const file = join(target, LOCK_FILE);
  if (!lstat(file)?.isFile()) return undefined;
  try {
    const lock = JSON.parse(readFileSync(file, "utf8")) as { schema?: unknown; outputs?: unknown };
    if (lock.schema !== COMPILE_LOCK_SCHEMA || !Array.isArray(lock.outputs)) return undefined;
    const rows = (lock.outputs as { path?: unknown; sha256?: unknown }[]).filter(row => typeof row?.path === "string" && typeof row.sha256 === "string");
    return new Map(rows.map(row => [row.path as string, row.sha256 as string]));
  } catch { return undefined; }
}

/**
 * What clearing the prior compile under `target` (a real path) would touch: the projections to delete, and every entry
 * compile would delete or overwrite that no prior lock records with its current bytes (any one refuses the compile).
 */
function planClear(target: string): { readonly remove: readonly string[]; readonly unowned: readonly string[] } {
  const prior = priorOutputs(target);
  const owned = (rel: string): boolean => {
    const recorded = prior?.get(rel);
    return recorded !== undefined && lstat(join(target, rel))?.isFile() === true && createHash("sha256").update(readFileSync(join(target, rel))).digest("hex") === recorded;
  };
  const remove: string[] = [], unowned: string[] = [];
  if (lstat(join(target, LOCK_FILE)) && !prior) unowned.push(LOCK_FILE);
  if (lstat(join(target, PUBLICATIONS_FILE)) && !owned(PUBLICATIONS_FILE)) unowned.push(PUBLICATIONS_FILE);
  const dir = lstat(join(target, "publications"));
  if (dir && !dir.isDirectory()) unowned.push("publications");
  else if (dir) {
    for (const name of readdirSync(join(target, "publications")).sort()) {
      const rel = `publications/${name}`;
      (PROJECTION.test(rel) && owned(rel) ? remove : unowned).push(rel);
    }
  }
  return { remove, unowned };
}

/** Compiles the publications of the workspace at `root` (the folder holding `clossys/`) into `out`. */
export async function compilePublications(root: string, out: string): Promise<PublicationsCompile> {
  const consumer = join(root, "clossys");
  mkdirSync(out, { recursive: true });
  // Every delete and write below is under the real out, so a symlinked --out cannot move them elsewhere midway.
  const target = realpathSync(out);
  const lock = join(target, LOCK_FILE);
  const inputs = new Map<string, string>();
  const read = (path: string, text: string) => { inputs.set(`clossys/${path}`, sha256(text)); };
  const outputs = new Map<string, string>();
  const write = (file: string, text: string) => { writeFileSync(file, text); outputs.set(posix(relative(target, file)), sha256(text)); };

  const ia = readAgentFile(consumer, "publisher", "ia.json");
  if (ia !== undefined) read("agents/publisher/ia.json", ia);
  const placed = listSlots(consumer, "publisher")
    .filter(entry => PUBLICATION_SLOT.test(entry.id) && readSlotJson(root, "publisher", entry.id)?.status !== "retired");
  const findings: CompileFinding[] = [];
  const publications: CompiledPublication[] = [];
  if (placed.length === 0) {
    findings.push({
      check: "compile.no-publication", subject: "publisher/ia.json",
      detail: `the Publisher IA places no publication.<id> slot, so there is nothing to compile; seating one is an owner IA decision (${SEAT_PUBLICATION})`,
    });
  }

  // Only this compile's own recorded projections are removed, so a publication that left the IA leaves no stale
  // projection and nothing compile did not write is ever deleted.
  const clear = planClear(target);
  if (clear.unowned.length) {
    const shown = clear.unowned.slice(0, 5).join(", ") + (clear.unowned.length > 5 ? `, and ${clear.unowned.length - 5} more` : "");
    findings.push({
      check: "compile.out-unowned", subject: target,
      detail: `${shown}: not recorded with these bytes in ${LOCK_FILE} by a previous compile here, so compile deletes and writes nothing; move them or choose another --out`,
    });
    return { out: target, written: false, lock, inputs: inputs.size, outputs: 0, publications, findings };
  }
  const dir = join(target, "publications");
  for (const rel of clear.remove) unlinkSync(join(target, rel));
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
      publications.push({ id, slot: `publisher/${entry.id}`, state: "compiled", file: posix(relative(target, file)) });
    } catch (error) {
      findings.push({ check: "compile.publication", subject: `publisher/${entry.id}`, detail: (error as Error).message });
    }
  }
  if (titled) {
    // Titles resolve through the pinned Writer copy (`writerCopy`), so every candidate it reads is an input too.
    for (const input of writerCopyInputs(consumer)) read(input.path, input.bytes);
  }

  write(join(target, PUBLICATIONS_FILE), json({ schema: COMPILED_PUBLICATIONS_SCHEMA, publications }));
  const entries = (map: Map<string, string>) => [...map].sort(([a], [b]) => a.localeCompare(b)).map(([path, hash]) => ({ path, sha256: hash }));
  writeFileSync(lock, json({ schema: COMPILE_LOCK_SCHEMA, decisionInputs: [...inputs.keys()].sort(), inputs: entries(inputs), outputs: entries(outputs) }));
  return { out: target, written: true, lock, inputs: inputs.size, outputs: outputs.size, publications, findings };
}
