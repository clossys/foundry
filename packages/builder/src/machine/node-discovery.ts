import { readdirSync, readFileSync, statSync } from "node:fs";
import type { DiscoveryPort } from "./types.js";

/**
 * The default `DiscoveryPort`, backed by the real filesystem. Separate from
 * `../node-fs.ts` for the same reason `types.ts` keeps `DiscoveryPort`
 * separate from `FileSystemPort` — see that module's header.
 */
export function createNodeDiscoveryPort(): DiscoveryPort {
  return {
    readdir(path: string): readonly string[] | undefined {
      try {
        if (!statSync(path).isDirectory()) return undefined;
        return readdirSync(path);
      } catch {
        return undefined;
      }
    },
    readTextFile(path: string): string | undefined {
      try {
        if (!statSync(path).isFile()) return undefined;
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },
  };
}
