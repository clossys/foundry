import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { CliArgs } from "./args.js";

/**
 * Write one agent verb's deterministic projection to `--out <file>` (resolved against the
 * root). Without `--out` nothing is written. The consumer's `clossys/` folder is the slot
 * model's source of record, so a projection is never written into it.
 */
export async function emitProjection(args: Pick<CliArgs, "out">, root: string, agent: string, value: unknown): Promise<string | undefined> {
  if (args.out === undefined) return undefined;
  const target = resolve(root, args.out);
  const inside = relative(join(root, "clossys"), target);
  if (inside === "" || (!inside.startsWith("..") && !inside.startsWith(sep) && !/^[A-Za-z]:/.test(inside))) {
    throw new Error(`--out may not write into the consumer's clossys/ folder (${agent} projection)`);
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
  return relative(root, target).split(sep).join("/") || target;
}
