/** Node-only file reader for the pure brand CSS declaration parser. */
import { readFileSync } from "node:fs";
import { parseBrandDeclarations, type BrandCssUnchecked } from "./parse-brand-declarations.js";
export { parseBrandDeclarations } from "./parse-brand-declarations.js";
export type { BrandCssUnchecked, ParsedBrandCss } from "./parse-brand-declarations.js";

/** Why `path` did not become a readable brand CSS file — see `readBrandCss`. */
export type BrandCssReadIssueReason = "unreadable";

export interface BrandCssReadIssue {
  reason: BrandCssReadIssueReason;
  detail: string;
}

export interface BrandCssReadResult {
  /** The path this result was read from, exactly as given. */
  path: string;
  declarations: Record<string, string>;
  unchecked: BrandCssUnchecked[];
  /** Empty means `path` was read successfully. Non-empty means `declarations`/`unchecked` are both `{}`/`[]` — see `BrandCssReadIssueReason`. */
  issues: BrandCssReadIssue[];
  /**
   * `true` exactly when `path` was read successfully — mirrors
   * `@example/copy`'s `CopyRegistryReadResult.complete` and
   * `@example/strategy`'s `StrategyBundle.complete`. Unlike those
   * two, `complete` here says nothing about whether every declaration in
   * the file was successfully classified — this reader never fails to
   * produce SOME result for readable text, it only ever accumulates
   * `unchecked` entries for the parts it could not resolve (the same
   * reason `@example/copy`'s `ScanResult` keeps `unchecked` as its
   * own field rather than folding it into a boolean). A caller deciding
   * whether a read can be trusted as fully accounted for should check
   * BOTH `complete` and `unchecked.length === 0`, not `complete` alone —
   * `cli.ts` does exactly that.
   */
  complete: boolean;
}

/**
 * Reads and parses the brand CSS file at `path`. Never throws: an
 * unreadable file (missing, a directory, permission denied) is recorded
 * into `issues` and reflected in `.complete`, the same discipline
 * `@example/copy`'s `readCopyRecord` and
 * `@example/strategy`'s `readStrategy` hold to for their own I/O.
 */
export function readBrandCss(path: string): BrandCssReadResult {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return {
      path,
      declarations: {},
      unchecked: [],
      issues: [{ reason: "unreadable", detail: error instanceof Error ? error.message : String(error) }],
      complete: false,
    };
  }

  const { declarations, unchecked } = parseBrandDeclarations(raw);
  return { path, declarations, unchecked, issues: [], complete: true };
}
