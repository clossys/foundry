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
  | "REF-PART-CLOSURE"
  | "REF-SELF-CITE"
  | "REF-COMP-PART"
  | "REF-COMP-IMPORT"
  | "REF-COMP-UNUSED"
  | "REF-COMP-MARKUP"
  | "REF-COMP-USES"
  | "REF-NPM-VERSION"
  | "REF-NPM-CODE"
  | "REF-NPM-ASSET"
  | "REF-NPM-DEP"
  | "REF-NPM-CLASS"
  | "REF-INTERACTIVE";

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
  readonly mapping?: "recorded" | "inferred" | "composition" | "npm" | "npm-asset" | "npm-contract";
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
  /** components.json of the consumer; default the `components.json` in `<root>`, then the one in its parent folder. */
  readonly components?: string;
  readonly manifest?: unknown;
  readonly referencesDir?: string;
  readonly rule?: unknown;
  readonly baselinePath?: string;
  readonly ceiling?: readonly string[];
  readonly linkComponents?: readonly string[];
  readonly strict?: boolean;
  /**
   * The component layer package (@clossys/designer-ui) a composition's imports resolve through; default the components.json folder,
   * then the package's ui/. `false` is no layer, as in a packed consumer: an `@/` import resolves to a declared part's pinned file by install path.
   */
  readonly ui?: string | false;
  /** The slot document whose `uses` a composition is checked against; default the slot's own slot.json. */
  readonly slotDoc?: { readonly uses?: readonly string[] };
  /** Canonical element dependencies (`<slot>/<element>/v<N>`) whose strict proof is already in progress; a repeat is a cycle. */
  readonly exactAncestors?: readonly string[];
  /** The declared value an H-TOKEN read's fallback must equal, per custom-property name. */
  readonly fallback?: (name: string) => string;
  /**
   * A consumer adoption's declared-fallback reader. A candidate whose `meta.refVerbatim.reader` names this reader's
   * source is compared with its reference normalized through it; one naming a reader not given here fails.
   */
  readonly reader?: DeclaredFallbackReader;
  /** The adoption reader of each stock part a composition places (its own `meta.refVerbatim.reader`), for that part's strict re-check. */
  readonly readerOf?: (item: unknown) => DeclaredFallbackReader | undefined;
};

/** A declared-source fallback reader (`src/importers/declared-fallback-reader.ts`): `fallback` refuses an undeclared name. */
export type DeclaredFallbackReader = { readonly source: string; fallback(name: string): string };
/** A consumer's pinned `themes.*` values (by custom-property name) as a declared-fallback reader. */
export declare function pinnedThemeFallbackReader(values: Readonly<Record<string, string>>, source?: string): DeclaredFallbackReader;
/** Whether `error` is the reader's refusal of a name with no declared value (`UndeclaredTokenFallbackError`). */
export declare function isUndeclaredTokenFallback(error: unknown): boolean;

/** One ds-only scan event of a source file, in source order. */
export type DsOnlyEvent =
  | { readonly type: "import"; readonly specifier: string; readonly typeOnly: boolean; readonly names: readonly string[] }
  | { readonly type: "dynamic"; readonly specifier: string }
  | { readonly type: "markup"; readonly tag: string; readonly attr: string };

export declare const DS_COMPONENT_LAYER: "@clossys/designer-ui";
export declare const DS_FRAME_LANDMARKS: ReadonlySet<string>;
/** Every code extension a registry payload may ship (`.tsx`, `.ts`, `.jsx`, `.js`, `.mjs`, `.cjs`, `.mts`, `.cts`). */
export declare const CODE_FILE: RegExp;
/** The TypeScript parse mode for a payload file: JSX is enabled for `.tsx`, `.jsx` and every plain JavaScript extension. */
export declare function scriptKind(ts: typeof import("typescript"), fileName: string): import("typescript").ScriptKind;
/** The ds-only scan shared by the Studio ds-only test and the composition rule. */
export declare function dsOnlyEvents(text: string, fileName: string, options?: { readonly kind?: "section" | "frame"; readonly blockMarkup?: ReadonlySet<string> }): readonly DsOnlyEvent[];
/** True when a lineage reference points into Foundry's own package folders or the `foundry` registry. */
export declare function selfCitation(ref: string): boolean;

export type BaselineRow = { readonly slot: string; readonly element: string; readonly version: number; readonly hash: string; readonly codes?: readonly string[] };

export declare const CODES: readonly RefVerbatimCode[];
/** Every row the baseline file may hold. Shrink only. */
export declare const BASELINE_CEILING: readonly string[];
export declare function baselineKey(row: BaselineRow): string;
export declare function engineFamily(style: unknown): string | undefined;
/**
 * Check one Designer candidate: `<slot>/<element>/v<N>` names candidate `<element>-v<N>.json` of
 * slot `<slot>`, read through the slot-model reader. A missing or unreadable candidate is REF-NO-SOURCE.
 */
export declare function checkElement(root: string, target: RefVerbatimTarget, options?: RefVerbatimOptions): RefVerbatimElement;
/** The pin gate: strict findings for one Designer candidate (`<slot>/<element>/v<N>`); empty means it may be pinned. */
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

/**
 * The vendored seed file `path` of manifest item `ref` normalized for the consumer at `root` (the reference this gate
 * compares with); with `options.reader`, its bare reads carry that reader's values. Throws when it cannot be read, or
 * when the reader does not declare a name the file reads.
 */
export declare function normalizedSeedFile(root: string, ref: string, path: string, options?: RefVerbatimOptions): string;

export type AdaptationKind = "import-paths" | "token-mapping" | "data-binding" | "data-fit" | "slot-bound-copy" | "slot-bound-identity";
export declare const ADAPTATION_KINDS: readonly AdaptationKind[];
export declare function adaptationHash(hunk: RefVerbatimHunk, reference: string, candidate: string): string;

/** The reference manifest's npm `packages` row an npm source's one ref names, if any (a class-contract reference). */
export declare function npmPackageRow(manifest: unknown, refs: unknown): { readonly id: string; readonly package: string; readonly version: string; readonly integrity: string; readonly license: string; readonly source: string; readonly classes: { readonly base: string; readonly modifiers: readonly string[] }; readonly slots: readonly string[] } | undefined;
/** Elements an npm class-contract wrapper may render (no page landmark: frames own those). */
export declare const NPM_CONTRACT_ELEMENTS: readonly string[];
/** The registry types an npm class-contract wrapper may be, each with the folder its files install to. */
export declare const NPM_CONTRACT_FILE_DIRS: Readonly<Record<"registry:ui" | "registry:component", string>>;
/** The registry-item fields an npm class-contract candidate may carry. */
export declare const NPM_CONTRACT_ITEM_KEYS: readonly string[];
/** Variants an npm contract class may carry. */
export declare const NPM_CONTRACT_VARIANTS: readonly string[];

export declare function checkRegistryItem(root: string, slot: string, candidate: any, options?: RefVerbatimOptions): RefVerbatimElement;
/** Why a consumer candidate is a byte-exact adoption (registry lineage, or the components layer), or undefined. */
export declare function byteExactAdoption(slot: string, candidate: any): string | undefined;

export type DataFitOperation = "sidebar15-frame-split" | "sidebar15-right-offcanvas" | "sidebar07-single-option" | "sidebar-mirrored-edge" | "sidebar-resizable-panels";
export type RecordedDataFit = {
  readonly kind: "data-fit"; readonly file: string; readonly reason: string;
  readonly operation: DataFitOperation; readonly sourceHash: string;
  readonly bindings: Readonly<Record<string, unknown>>;
};

export { DESIGNER_SHADCN_FLAVOR, shadcnComponentsJson, shadcnComponentsJsonText, type ShadcnComponentsJson } from "./ref-verbatim/flavor.mjs";
