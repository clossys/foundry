import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { hasModelRoot } from "../records/slots.js";

/** The nearest directory (from `startDir` up) holding `clossys/clossys.config.ts` or `clossys/agents/`; undefined when none does. */
export function findWorkspace(startDir: string): string | undefined {
  let current = resolve(startDir);
  for (;;) {
    const config = statSync(join(current, "clossys", "clossys.config.ts"), { throwIfNoEntry: false })?.isFile();
    const agents = hasModelRoot(join(current, "clossys"));
    if (config || agents) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** The nearest workspace directory; exit 2 when there is none. */
export function discoverWorkspace(startDir: string): string {
  const found = findWorkspace(startDir);
  if (found === undefined) throw Object.assign(new Error("Root not found: expected clossys/clossys.config.ts or clossys/agents/ in this directory or an ancestor"), { exitCode: 2 });
  return found;
}
