/**
 * R12 Deterministic build (slot-constitution.md R12; unit W2-D).
 *
 * The resolved pin set is (slot id, pinned sha256) for every live slot with a pin, sorted; its
 * sha256 is the pin-set hash. `clossys compile` (cli/compile.ts) writes it into
 * studio/compile.lock.json as `pinSetHash`.
 * R12.1 The lock records a pin-set hash and it equals the current one (seconds).
 * R12.2 The compile reads no clock, randomness, network or environment: check-compile-pure on the
 * built CLI (a root without a build is a row: build first).
 * R12.3 Building twice from clean is byte-identical (check-artifact-reproducible). Heavy and
 * landing-only, so it is not part of the seconds run and stays a pending row until the runner
 * has a landing mode.
 *
 * A root without packages/producer/package.json has no build to judge and gives no R12.1/R12.2 row.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isObject, liveSlotRecords, pending } from "../checks/shared.js";
import type { ConstitutionContext, Row, RuleModule } from "../types.js";
import { brokenScript, codeRow, hasCode, judgesCode, runScript } from "./r11.js";

export const COMPILE_LOCK = "packages/producer/studio/compile.lock.json";

/** One entry of the resolved pin set. */
export interface PinSetEntry { readonly slot: string; readonly sha256: string }

/** The resolved pin set: (slot id, pinned sha256) for every live slot whose pin.json names a sha256, sorted by slot id. */
export function pinSet(ctx: ConstitutionContext): PinSetEntry[] {
  const entries: PinSetEntry[] = [];
  for (const slot of liveSlotRecords(ctx)) {
    const pin = slot.pin?.value;
    if (isObject(pin) && typeof pin.sha256 === "string") entries.push({ slot: slot.id, sha256: pin.sha256 });
  }
  return entries.sort((a, b) => (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0));
}

/** The pin-set hash: hex sha256 of one `<slot id> <sha256>\n` line per entry, in pin-set order. */
export function pinSetHash(entries: readonly PinSetEntry[]): string {
  const hash = createHash("sha256");
  for (const entry of entries) hash.update(`${entry.slot} ${entry.sha256}\n`);
  return hash.digest("hex");
}

/** R12.1 over a read lock: missing, unreadable, without a hash, or built from another pin set. */
export function lockRows(lock: { present: boolean; doc?: unknown; error?: string }, current: string): Row[] {
  if (!lock.present) return [codeRow("R12", "R12.1", "studio/compile.lock.json is missing: run clossys compile", COMPILE_LOCK)];
  if (lock.error !== undefined) return [codeRow("R12", "R12.1", `studio/compile.lock.json is unreadable: ${lock.error}`, COMPILE_LOCK)];
  const recorded = isObject(lock.doc) ? lock.doc.pinSetHash : undefined;
  if (typeof recorded !== "string") return [codeRow("R12", "R12.1", "studio/compile.lock.json records no pinSetHash: run clossys compile", COMPILE_LOCK)];
  if (recorded !== current) return [codeRow("R12", "R12.1", `studio/compile.lock.json was built from pin set ${recorded.slice(0, 12)}, the current pin set is ${current.slice(0, 12)}: run clossys compile`, COMPILE_LOCK)];
  return [];
}

function readLock(root: string): { present: boolean; doc?: unknown; error?: string } {
  const path = join(root, COMPILE_LOCK);
  if (!existsSync(path)) return { present: false };
  try { return { present: true, doc: JSON.parse(readFileSync(path, "utf8")) as unknown }; }
  catch (error) { return { present: true, error: error instanceof Error ? error.message : String(error) }; }
}

const COMPILE_PURE = "packages/producer/scripts/check-compile-pure.mjs";

/** R12.2 rows from a check-compile-pure run: its `  <part>: <message>` finding lines on exit 1. */
export function compilePureRows(run: { status: number | null; stdout: string; stderr: string; error?: string }): Row[] {
  if (run.status === 0) return [];
  const lines = run.status === 1 ? run.stderr.split("\n").map(line => /^ {2}([a-z-]+): (.+)$/.exec(line)).filter(match => match !== null) : [];
  if (!lines.length) return [brokenScript("R12", "R12.2", COMPILE_PURE, run)];
  return lines.map(match => codeRow("R12", "R12.2", `compile is not pure (${match[1]}): ${match[2]!.slice(0, 200)}`, COMPILE_PURE));
}

export const R12: RuleModule = {
  rule: "R12",
  checks: {
    "R12.1": ctx => (hasCode(ctx.root) ? lockRows(readLock(ctx.root), pinSetHash(pinSet(ctx))) : []),
    "R12.2": ctx => {
      if (!judgesCode(ctx)) return [];
      if (!existsSync(join(ctx.root, "packages/producer/dist/cli/index.js"))) return [codeRow("R12", "R12.2", "the Producer CLI is not built (npm run build), so the compile cannot be proved pure", "packages/producer/dist")];
      return compilePureRows(runScript(COMPILE_PURE, ["--root", ctx.root]));
    },
    "R12.3": pending("R12", "R12.3", "W2-D", "build twice byte-identical: heavy, landing-only, needs a runner landing mode"),
  },
};
