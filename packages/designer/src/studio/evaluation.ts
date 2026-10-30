import type { CatalogData, ChangeSet, LibraryData, Resolved } from "../catalog-core/index.js";
import { studioEngine, type StudioEngine } from "./engine.js";

type Changes = ChangeSet["changes"];
export interface StudioEvaluationResult {
  readonly resolved: Resolved;
  readonly checked: ReturnType<StudioEngine["check"]>;
  /** An adoption failure belongs to the operation; its finding subject belongs to the displayed row. */
  readonly failure?: string;
}
export interface StudioEvaluation {
  readonly catalog: CatalogData;
  readonly working: LibraryData;
  readonly engine: StudioEngine;
  evaluate(changes?: Changes): StudioEvaluationResult;
}
export interface StudioEvaluationInput {
  catalog: CatalogData; working: LibraryData; engine?: StudioEngine; evaluation?: StudioEvaluation;
}

/** One instance owns one immutable engine input. Neither row identity nor display state changes an evaluation. */
export function createStudioEvaluation({ catalog, working, engine = studioEngine }: Omit<StudioEvaluationInput, "evaluation">): StudioEvaluation {
  const results = new Map<string, StudioEvaluationResult>();
  let baseHash: string | undefined;
  const evaluate = (changes: Changes = []): StudioEvaluationResult => {
    // Operation order is significant: member adoption can depend on an earlier leaf operation.
    const key = JSON.stringify(changes);
    const cached = results.get(key);
    if (cached) return cached;
    let profile = working;
    if (changes.length) {
      try {
        baseHash ??= engine.libraryHash(working);
        profile = engine.applyLibraryChange(catalog, working, { baseHash, changes });
      } catch (error) {
        const failed = { ...evaluate(), failure: error instanceof Error ? error.message : String(error) };
        results.set(key, failed);
        return failed;
      }
    }
    const resolved = engine.resolve({ catalog, library: profile });
    // The engine deliberately resolves afresh inside check to compare C5 evidence. Keep that check intact.
    const result = { resolved, checked: engine.check({ catalog, library: profile, resolved }) };
    results.set(key, result);
    return result;
  };
  return { catalog, working, engine, evaluate };
}

/** A context from another input must never return stale safety findings or provenance. */
export function evaluationFor(input: StudioEvaluationInput): StudioEvaluation {
  const engine = input.engine ?? studioEngine;
  const cached = input.evaluation;
  return cached?.catalog === input.catalog && cached.working === input.working && cached.engine === engine
    ? cached : createStudioEvaluation({ ...input, engine });
}
