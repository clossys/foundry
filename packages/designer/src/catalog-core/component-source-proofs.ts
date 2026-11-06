/**
 * Byte-authenticated stock source proofs. The table is written by
 * `scripts/generate-component-source-proofs.mjs` from the real TypeScript AST of
 * every stock component source; it is never edited by hand. A proof applies only
 * to the exact bytes and script kind it was read from (sha256), so any mutation
 * has no proof and falls back to the bounded grammar, which refuses what it
 * cannot read. The runtime and the browser never load the compiler.
 */
import table from "./component-source-proofs.json" with { type: "json" };
import { sha256 } from "./digest.js";

export type ComponentSourceKind = "ts" | "tsx";
export interface ComponentSourceNamespaceRead { module: string; member: string; erased: boolean; typeQuery: boolean }
export interface ComponentSourceProof {
  /** Top-level function declarations with a body. */
  functions: readonly string[];
  /** Same-name local value exports (no alias, no re-export, no default). */
  exports: readonly string[];
  /** Namespace imports by local name. */
  namespaces: Readonly<Record<string, { module: string; erased: boolean }>>;
  /** Every runtime namespace member read and every `typeof` namespace query. */
  reads: readonly ComponentSourceNamespaceRead[];
}
export interface ComponentSourceProofs { $generated: string; proofs: Readonly<Record<string, ComponentSourceProof>> }

/** The script kind a module path is parsed as; only .ts and .tsx sources carry proofs. */
export function componentSourceKind(path: string): ComponentSourceKind | undefined {
  return /\.tsx$/.test(path) ? "tsx" : /\.ts$/.test(path) ? "ts" : undefined;
}
/** The table key: script kind plus the sha256 of the exact source bytes. */
export function componentSourceProofKey(kind: ComponentSourceKind, content: string): string {
  return `${kind}:${sha256(content)}`;
}

const proofs = (table as ComponentSourceProofs).proofs;
/** The AST proof for these exact bytes parsed as this path's kind, or undefined when they were never read. */
export function componentSourceProof(path: string, content: string): ComponentSourceProof | undefined {
  const kind = componentSourceKind(path);
  if (!kind) return undefined;
  const key = componentSourceProofKey(kind, content);
  return Object.hasOwn(proofs, key) ? proofs[key] : undefined;
}
