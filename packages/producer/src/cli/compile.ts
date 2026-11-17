/**
 * `clossys compile [--root <dir>] [--out <dir>] [--json]`: compile from decision files only.
 *
 * A consumer that places the Studio publication (`publication.studio`) compiles the Studio as before: the files
 * packages/producer/decision-inputs.json lists (IA, slot.json, pins, pinned candidates), the Studio page projection,
 * the Publisher-installed route files and compile.lock.json. Every other consumer compiles its own publications
 * (publish/compile-publications.ts) into `.clossys/generated/`, and the Studio is skipped. Both locks carry the sha256
 * of every input and output, plus `pinSetHash`, the pin-set hash of the live pins it was built from (R12.1 compares it).
 * Exit 1 is a compile finding (no publication placed, or a pinned publication that does not project).
 * Deterministic and offline: no model, no agent binary, no network (R-COMPILE-PURE).
 */
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildContext } from "../constitution/context.js";
import { pinSet, pinSetHash } from "../constitution/rules/r12.js";
import { GENERATED_DIR, compilePublications } from "../publish/compile-publications.js";
import { placesStudioPublication } from "../publish/studio-defaults.js";
import { CliUsageError } from "./args.js";
import type { CliResult } from "./main.js";
import { discoverRoot } from "./root.js";

export const COMPILE_USAGE = "Usage: clossys compile [--root <dir>] [--out <dir>] [--json]\n"
  + "  Compile from decision files only (deterministic, offline): the consumer's own publication.<id> slots into\n"
  + "  .clossys/generated/ (publications/<id>.json, publications.json, compile.lock.json); the Studio only when the\n"
  + "  consumer places publication.studio. Exit 1 on a compile finding.\n"
  + "  --root  consumer root holding clossys/ (default: discovered from the working directory)\n"
  + "  --out   write the compile output here instead (Studio: generated/, app/ and compile.lock.json)";

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
  const workspace = discoverRoot(resolve(cwd, root ?? "."));
  // The reader refuses any symlinked ancestor (a temp root under macOS /var), so read the real path.
  const real = await realpath(workspace);
  const hash = () => pinSetHash(pinSet(buildContext(real, join(real, "clossys"))));
  if (!placesStudioPublication(join(real, "clossys"))) {
    const result = await compilePublications(real, out ? resolve(cwd, out) : join(real, GENERATED_DIR));
    if (result.written) await recordPinSetHash(result.lock, hash());
    const lines = [
      `compile: ${result.publications.length} publication(s), ${result.inputs} decision inputs -> ${result.outputs} outputs (${result.lock}); the Studio is not placed, so it is skipped`,
      ...result.publications.map(row => row.state === "compiled" ? `compiled ${row.slot} -> ${row.file}` : `unresolved ${row.slot}: ${row.reason}`),
      ...result.findings.map(row => `${row.check}: ${row.subject}: ${row.detail}`),
    ];
    return { exitCode: result.findings.length ? 1 : 0, message: lines.join("\n"), root: workspace, compilation: result };
  }
  // Loaded on use: the generators import the built package and are not needed by other verbs.
  const { compileStudio } = await import("../../scripts/compile-studio.mjs");
  const result = await compileStudio({ root: workspace, ...(out ? { out: resolve(cwd, out) } : {}) });
  await recordPinSetHash(result.lock, hash());
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
