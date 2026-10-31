/** Library roots for `clossys publish --install`. */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

/** Library roots to serve: the ones given, else the consumer's own `clossys/library` when present. */
export function specimenRoots(root: string, given?: readonly string[]): string[] {
  if (given?.length) return given.map(dir => resolve(root, dir));
  const own = join(root, "clossys", "library");
  return existsSync(own) ? [own] : [];
}

