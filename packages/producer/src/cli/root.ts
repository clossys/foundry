import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export class RootDiscoveryError extends Error {
  readonly exitCode = 2;

  constructor() {
    super("Root not found: expected clossys/clossys.config.ts in this directory or an ancestor");
    this.name = "RootDiscoveryError";
  }
}

export function discoverRoot(startDir: string): string {
  let current = resolve(startDir);
  if (!statSync(current, { throwIfNoEntry: false })?.isDirectory()) throw new RootDiscoveryError();
  while (true) {
    if (statSync(join(current, "clossys", "clossys.config.ts"), { throwIfNoEntry: false })?.isFile()) return current;
    const parent = dirname(current);
    if (parent === current) throw new RootDiscoveryError();
    current = parent;
  }
}
