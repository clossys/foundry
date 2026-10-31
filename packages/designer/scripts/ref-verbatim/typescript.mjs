/**
 * Lazy TypeScript compiler API loader for the ref-verbatim check. The check
 * parses TSX with the consumer's (or this workspace's) `typescript`; when it is
 * not installed the check fails closed with REF-NORMALIZE instead of passing.
 */
import { createRequire } from "node:module";
import { join } from "node:path";

let cached;

export function loadTypeScript() {
  if (cached) return cached;
  const bases = [import.meta.url, join(process.cwd(), "package.json")];
  for (const base of bases) {
    try {
      cached = createRequire(base)("typescript");
      return cached;
    } catch {
      // try the next base
    }
  }
  const error = new Error("the typescript package is not installed; the ref-verbatim check cannot parse TSX (install typescript)");
  error.code = "REF-NORMALIZE";
  throw error;
}
