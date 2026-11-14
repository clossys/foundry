/**
 * `clossys compile [--root <dir>] [--out <dir>] [--json]`: render Studio from decision files only.
 *
 * Reads the files packages/producer/decision-inputs.json lists (IA, slot.json, pins, pinned
 * candidates) from the consumer root plus package code, and writes the Studio page projection,
 * the Publisher-installed route files and compile.lock.json (sha256 of every input and output,
 * plus `pinSetHash`, the pin-set hash of the live pins it was built from; R12.1 compares it).
 * Deterministic and offline: no model, no agent binary, no network (R-COMPILE-PURE).
 */
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildContext } from "../constitution/context.js";
import { pinSet, pinSetHash } from "../constitution/rules/r12.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const COMPILE_USAGE = "Usage: clossys compile [--root <dir>] [--out <dir>] [--json]\n"
  + "  Render Studio from the decision files in decision-inputs.json only (deterministic, offline).\n"
  + "  --root  consumer root holding clossys/ (default: discovered from the working directory)\n"
  + "  --out   write generated/, app/ and compile.lock.json here instead of the package's Studio";

export async function runCompileCli(argv: readonly string[], cwd: string): Promise<CliResult> {
  let root: string | undefined, out: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") return { exitCode: 0, message: COMPILE_USAGE };
    if (arg === "--json") continue;
    if (arg === "--root" || arg === "--out") {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new CliUsageError(`${arg} needs a directory\n${COMPILE_USAGE}`);
      if (arg === "--root") root = value; else out = value;
      continue;
    }
    throw new CliUsageError(`Unknown compile argument: ${arg}\n${COMPILE_USAGE}`);
  }
  // Loaded on use: the generators import the built package and are not needed by other verbs.
  const { compileStudio } = await import("../../scripts/compile-studio.mjs");
  const workspace = discoverRoot(resolve(cwd, root ?? "."));
  const result = await compileStudio({ root: workspace, ...(out ? { out: resolve(cwd, out) } : {}) });
  // The reader refuses any symlinked ancestor (a temp root under macOS /var), so read the real path.
  const real = await realpath(workspace);
  await recordPinSetHash(result.lock, pinSetHash(pinSet(buildContext(real, join(real, "clossys")))));
  return {
    exitCode: 0,
    message: `compile: ${result.inputs} decision inputs -> ${result.outputs} outputs (${result.lock})`,
    root: workspace,
    compilation: result,
  };
}

/** Writes `pinSetHash` into the lock compileStudio wrote, as its last field. */
async function recordPinSetHash(lockPath: string, hash: string): Promise<void> {
  const { schema, ...rest } = JSON.parse(await readFile(lockPath, "utf8")) as Record<string, unknown>;
  await writeFile(lockPath, `${JSON.stringify({ schema, ...rest, pinSetHash: hash }, null, 2)}\n`);
}
