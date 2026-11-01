/** Types for check-ref-verbatim.mjs (`@clossys/designer/ref-verbatim`). */

export type RefVerbatimCode =
  | "REF-NO-SOURCE"
  | "REF-NOT-VENDORED"
  | "REF-FLAVOR"
  | "REF-PRIMITIVE-AS-REF"
  | "REF-FILE-UNMAPPED"
  | "REF-HUNK-CLASS"
  | "REF-HUNK-STRUCTURE"
  | "REF-HUNK-LOGIC"
  | "REF-HUNK-TEXT"
  | "REF-NORMALIZE"
  | "REF-ADAPTATION"
  | "REF-PART-PROOF"
  | "REF-PART-CLOSURE";

export type RefVerbatimPosition = { readonly line: number; readonly column: number };
export type RefVerbatimRange = { readonly start: RefVerbatimPosition; readonly end: RefVerbatimPosition };

export type RefVerbatimFinding = {
  readonly element: string;
  readonly code: RefVerbatimCode | "REF-BASELINE";
  readonly detail: string;
  readonly file?: string;
  readonly reference?: string;
  readonly range?: RefVerbatimRange;
  readonly referenceRange?: RefVerbatimRange;
};

export type RefVerbatimHunk = {
  readonly rule: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly ref?: RefVerbatimRange;
  readonly file?: RefVerbatimRange;
};

export type RefVerbatimFile = {
  readonly file: string;
  readonly status: "pass" | "fail" | "skipped";
  readonly reference?: string;
  readonly mapping?: "recorded" | "inferred";
  readonly hunks?: readonly RefVerbatimHunk[];
  readonly codes?: readonly string[];
};

export type RefVerbatimElement = {
  readonly key: string;
  readonly slot: string;
  readonly element: string;
  readonly version: number;
  readonly hash?: string;
  readonly ref?: string;
  readonly status: "pass" | "fail" | "baselined" | "exempt" | "n/a";
  readonly note?: string;
  readonly files: readonly RefVerbatimFile[];
  readonly findings: readonly RefVerbatimFinding[];
};

export type RefVerbatimTarget = string | { readonly slot: string; readonly element: string; readonly version: number };

export type RefVerbatimOptions = {
  /** components.json of the consumer; default `<root>/components.json`, then `<root>/../components.json`. */
  readonly components?: string;
  readonly manifest?: unknown;
  readonly referencesDir?: string;
  readonly rule?: unknown;
  readonly baselinePath?: string;
  readonly ceiling?: readonly string[];
  readonly linkComponents?: readonly string[];
  readonly strict?: boolean;
};

export type BaselineRow = { readonly slot: string; readonly element: string; readonly version: number; readonly hash: string; readonly codes?: readonly string[] };

export declare const CODES: readonly RefVerbatimCode[];
/** Every row the baseline file may hold. Shrink only. */
export declare const BASELINE_CEILING: readonly string[];
export declare function baselineKey(row: BaselineRow): string;
export declare function engineFamily(style: unknown): string | undefined;
export declare function checkElement(root: string, target: RefVerbatimTarget, options?: RefVerbatimOptions): RefVerbatimElement;
/** The pin gate: strict findings for one element version; empty means it may be pinned. */
export declare function refVerbatimFindings(root: string, target: RefVerbatimTarget, options?: RefVerbatimOptions): readonly RefVerbatimFinding[];
export declare function loadBaseline(options?: RefVerbatimOptions): { rows: readonly BaselineRow[]; findings: readonly RefVerbatimFinding[] };
export declare function refVerbatimReport(
  root: string,
  options?: RefVerbatimOptions & { readonly all?: boolean },
): {
  readonly mode: "all" | "pinned";
  readonly root: string;
  readonly elements: readonly RefVerbatimElement[];
  readonly findings: readonly RefVerbatimFinding[];
  readonly baselined: readonly string[];
  readonly stale: readonly string[];
};

export type AdaptationKind = "import-paths" | "token-mapping" | "data-binding" | "data-fit" | "slot-bound-copy" | "slot-bound-identity";
export declare const ADAPTATION_KINDS: readonly AdaptationKind[];
export declare function adaptationHash(hunk: RefVerbatimHunk, reference: string, candidate: string): string;

export declare function checkRegistryItem(root: string, slot: string, candidate: any, options?: RefVerbatimOptions): RefVerbatimElement;

export type DataFitOperation = "sidebar15-frame-split" | "sidebar15-right-offcanvas" | "sidebar07-single-option" | "sidebar-mirrored-edge" | "sidebar-resizable-panels";
export type RecordedDataFit = {
  readonly kind: "data-fit"; readonly file: string; readonly reason: string;
  readonly operation: DataFitOperation; readonly sourceHash: string;
  readonly bindings: Readonly<Record<string, unknown>>;
};
