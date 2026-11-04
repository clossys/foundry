import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The nearest directory (from `startDir` up) holding `clossys/clossys.config.ts` or `clossys/agents/`. */
export function discoverWorkspace(startDir: string): string {
  let current = resolve(startDir);
  for (;;) {
    const config = statSync(join(current, "clossys", "clossys.config.ts"), { throwIfNoEntry: false })?.isFile();
    const agents = statSync(join(current, "clossys", "agents"), { throwIfNoEntry: false })?.isDirectory();
    if (config || agents) return current;
    const parent = dirname(current);
    if (parent === current) throw Object.assign(new Error("Root not found: expected clossys/clossys.config.ts or clossys/agents/ in this directory or an ancestor"), { exitCode: 2 });
    current = parent;
  }
}
