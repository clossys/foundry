/**
 * `readStrategyDirectory` — the facts-only counterpart to `readStrategy`
 * (`reader.ts`), for the consumer whose facts outgrew one flat
 * `facts.json`: a directory of per-fact JSON files, one JSON array of
 * `Fact` per leaf, combined into a single validated `Fact[]`.
 *
 * PURE, DELIBERATELY. `readStrategy` is this package's one sanctioned I/O
 * surface; this function adds no second one. It takes the directory's
 * contents as a caller-supplied map — relative path -> raw file text —
 * and does no filesystem work itself, the same split `facts-gate.ts`
 * (pure) and `scan.ts` (I/O) draw: the CLI builds the map with ordinary
 * file reads (`strategist-check --facts-dir <dir>`), a programmatic
 * caller can source it from anywhere, and a test can pass a literal.
 *
 * EVERY LEAF IS ACCOUNTED FOR. A facts directory is a registry, not a
 * grab bag, so the reader refuses rather than skips. Every `*.json` leaf
 * must parse and validate as a `Fact[]` under the same `validateFacts`
 * rules the flat file follows (duplicate keys included). A leaf that is
 * unparseable or schema-invalid is recorded as an issue naming the
 * offending file. A NON-JSON leaf is refused too — never silently
 * ignored — because an unaccounted-for file in a facts directory is
 * evidence of the wrong directory or a misplaced export, and a reader
 * that stepped over it would validate a registry the author did not
 * write. A directory with no JSON leaves at all is also an issue: an
 * empty registry reads as "the directory is wrong", not "there are no
 * facts".
 *
 * REFUSAL IS RECORDED, NOT THROWN — the same discipline `readStrategy`
 * holds to: facts from leaves that did validate are still returned
 * (gather, don't judge), `issues` names every leaf that did not make it,
 * and `complete` is `true` only when every leaf did. Judgement — fail a
 * build, block a release — belongs to the caller, exactly as it does for
 * `StrategyBundle.complete`. A `checkFactsTraceability` caller should
 * treat `complete: false` as fail-closed input (the CLI maps it to exit
 * code 2), the same way it treats a missing or invalid `facts.json`.
 *
 * PROVENANCE: each returned fact records its source leaf in the optional
 * `Fact.sourceFile` (`schema.ts`) — the one piece of provenance a
 * directory of facts has that a single flat file cannot express. The
 * field is set by this reader only: `readStrategy` leaves it unset, and
 * no validator accepts or rejects it (an authored `sourceFile` in a
 * facts file is ignored, like any field outside the declared shape).
 */

import { validateFacts, type Fact } from "./schema.js";
import { isPlainObject, summarizeIssues } from "./validation.js";

export interface FactsDirectoryInput {
  /**
   * The directory's contents, relative path -> raw file text. Paths are
   * the map's keys verbatim (a caller walking a real directory should
   * join segments with `/`, matching `scan.ts`'s path convention) and
   * are used as-is in issue messages and `Fact.sourceFile`.
   */
  files: Readonly<Record<string, string>>;
}

/**
 * Why a leaf (or the whole directory) did not become usable facts.
 * `"unparseable"` and `"invalid-schema"` mean exactly what they mean in
 * `reader.ts`'s `StrategyReadIssueReason` — the same two reasons a flat
 * `facts.json` can fail with. `"non-json"` is a leaf that is not a
 * `*.json` file at all: unaccounted-for, and refused rather than
 * silently skipped. `"empty"` is the directory holding no `*.json` leaf
 * to read — an empty registry is "the directory is wrong", never "there
 * are no facts".
 */
export type FactsDirectoryIssueReason = "unparseable" | "invalid-schema" | "non-json" | "empty";

export interface FactsDirectoryIssue {
  /** Which leaf this issue is about, as given in the input map — or `"(directory)"` for the empty-directory case. */
  file: string;
  reason: FactsDirectoryIssueReason;
  /** Human-readable detail: the JSON parse error, the validator's issue summary, or the refusal's own explanation. */
  detail: string;
}

export interface FactsDirectoryResult {
  /** Every fact from leaves that validated, or `[]` — see `issues` and `complete` to tell a genuine empty leaf set from a refusal. */
  facts: Fact[];
  /** Every leaf that did not become usable facts, and why. Empty means every leaf validated cleanly. */
  issues: FactsDirectoryIssue[];
  /** `true` exactly when every leaf in the input map was accounted for and validated. */
  complete: boolean;
}

function isJsonLeaf(path: string): boolean {
  return path.toLowerCase().endsWith(".json");
}

/**
 * Combines the `*.json` leaves of a facts directory (see this file's top
 * doc comment for the contract). Never throws: every refusal — bad JSON,
 * schema violation, non-JSON leaf, nothing to read — is recorded into
 * `FactsDirectoryResult.issues` and reflected in `complete`.
 */
export function readStrategyDirectory(input: FactsDirectoryInput): FactsDirectoryResult {
  const issues: FactsDirectoryIssue[] = [];
  const facts: Fact[] = [];

  // Deterministic combination order: leaves are processed sorted by their
  // relative path (code-unit order), so the same directory map always
  // produces the same fact order regardless of key insertion order.
  const entries = Object.entries(input.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  let jsonLeaves = 0;
  for (const [path, raw] of entries) {
    if (!isJsonLeaf(path)) {
      issues.push({
        file: path,
        reason: "non-json",
        detail:
          'not a "*.json" leaf — a facts directory is read in full, so every file in it must be a JSON array of Fact; move or remove this file',
      });
      continue;
    }
    jsonLeaves += 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      issues.push({ file: path, reason: "unparseable", detail: error instanceof Error ? error.message : String(error) });
      continue;
    }
    if (!Array.isArray(parsed)) {
      if (isPlainObject(parsed)) {
        issues.push({
          file: path,
          reason: "invalid-schema",
          detail:
            'document root must be a JSON array of Fact — nested group-object facts files are not ingested by the engine; project each domain file to Fact[] leaves or use flat facts.json',
        });
        continue;
      }
    }
    const result = validateFacts(parsed);
    if (!result.ok) {
      issues.push({ file: path, reason: "invalid-schema", detail: summarizeIssues(result.issues) });
      continue;
    }
    for (const fact of result.value) {
      facts.push({ ...fact, sourceFile: path });
    }
  }

  if (jsonLeaves === 0) {
    issues.push({
      file: "(directory)",
      reason: "empty",
      detail: 'no "*.json" leaf to read — a facts directory must contain at least one JSON array of Fact',
    });
  }

  return { facts, issues, complete: issues.length === 0 };
}
