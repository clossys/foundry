import { dirname, normalize, resolve } from "node:path";
import type { DiscoveryPort } from "./types.js";

/**
 * An in-memory `DiscoveryPort` for tests, in the same spirit as
 * `../memory-fs.test-helper.ts`: discovery must be exercised against
 * arbitrary directory shapes (a marker present, a marker absent, a marker
 * that names a skills path that itself does not exist) without ever
 * touching a real home directory. Not shipped; excluded from the published
 * files and from the build (see `tsconfig.json`'s `**\/*.test-helper.ts`
 * exclusion).
 */

type Node = { kind: "dir" } | { kind: "file"; contents: string };

export interface MemoryDiscoveryFileSystem extends DiscoveryPort {
  setDirectory(path: string): void;
  setFile(path: string, contents: string): void;
}

export function createMemoryDiscoveryFileSystem(): MemoryDiscoveryFileSystem {
  const nodes = new Map<string, Node>();

  const key = (path: string): string => normalize(resolve(path));

  function ensureParents(path: string): void {
    let current = dirname(key(path));
    const seen: string[] = [];
    while (current !== dirname(current) && !nodes.has(current)) {
      seen.push(current);
      current = dirname(current);
    }
    for (const directory of seen.reverse()) nodes.set(directory, { kind: "dir" });
  }

  return {
    setDirectory(path) {
      ensureParents(path);
      nodes.set(key(path), { kind: "dir" });
    },
    setFile(path, contents) {
      ensureParents(path);
      nodes.set(key(path), { kind: "file", contents });
    },
    readdir(path) {
      const target = key(path);
      const node = nodes.get(target);
      if (node?.kind !== "dir") return undefined;
      const prefix = `${target}/`;
      const names = new Set<string>();
      for (const candidate of nodes.keys()) {
        if (!candidate.startsWith(prefix)) continue;
        const rest = candidate.slice(prefix.length);
        const name = rest.split("/")[0];
        if (name) names.add(name);
      }
      return [...names].sort();
    },
    readTextFile(path) {
      const node = nodes.get(key(path));
      return node?.kind === "file" ? node.contents : undefined;
    },
  };
}
