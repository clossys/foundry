/** TypeScript views of the record schemas in ./schemas.ts. Validate before trusting a cast. */

export type Hash = `sha256:${string}`;

export type LineageMode = "verbatim" | "customized" | "original";

export type ReferenceRef = {
  readonly registry: string;
  readonly item: string;
  readonly version: string;
  readonly hash?: Hash;
  readonly url?: string;
  /** Payload file -> file path inside the vendored reference item it was copied from. */
  readonly files?: Readonly<Record<string, string>>;
};

/** Byte offsets are UTF-8 bytes, endExclusive excluded. Reference 0 is source; n>0 is parts[n-1]. */
export type ExactPartSource = {
  readonly reference: number; readonly path: string; readonly upstream: string;
  readonly fileSha256: string; readonly start: number; readonly endExclusive: number; readonly sha256: string;
  readonly license: { readonly path: string; readonly sha256: string; readonly payloadPath: string };
};
export type ExactPartEdit = {
  readonly kind: "import" | "token" | "data";
  readonly start: number; readonly endExclusive: number; readonly from: string; readonly to: string;
};
export type ExactPartProof = {
  readonly schema: "ref-exact-parts/1";
  readonly payload: Readonly<Record<string, string>>;
  readonly files: Readonly<Record<string, {
    readonly sha256: string;
    readonly segments: readonly { readonly start: number; readonly endExclusive: number; readonly source: ExactPartSource; readonly edits: readonly ExactPartEdit[] }[];
  }>>;
  readonly closure: {
    readonly roots: readonly string[];
    readonly imports: readonly { readonly file: string; readonly specifier: string; readonly target:
      | { readonly kind: "payload"; readonly path: string }
      | { readonly kind: "npm"; readonly package: string; readonly version: string; readonly entry: string; readonly hash: Hash }
      | { readonly kind: "element"; readonly slot: string; readonly element: string; readonly version: number; readonly hash: Hash; readonly entry: string }
    }[];
  };
};

export type CheckResult = {
  readonly id: string;
  readonly suite?: string;
  readonly type: "fixed" | "measured" | "judged";
  readonly status: "pass" | "fail" | "warn" | "skip";
  readonly detail?: string;
  readonly value?: number | string | boolean;
  readonly at?: string;
};

export type ElementDependency = {
  readonly slot: string;
  readonly element: string;
  readonly version: number;
  readonly hash: Hash;
};

/** The five source-bound replays currently implemented by the reference guard. */
export type FiniteDataFitReplay = {
  readonly kind: "data-fit";
  readonly sourceHash: Hash;
} & (
  | { readonly operation: "sidebar15-frame-split"; readonly bindings: { readonly region: "app" | "page" } }
  | { readonly operation: "sidebar15-right-offcanvas"; readonly bindings: { readonly side: "right"; readonly collapsible: "offcanvas" } }
  | { readonly operation: "sidebar07-single-option"; readonly bindings: { readonly input: "teams" | "user"; readonly values: readonly Readonly<Record<string, unknown>>[] } }
  | { readonly operation: "sidebar-mirrored-edge"; readonly bindings: { readonly side: "left" | "right" } }
  | { readonly operation: "sidebar-resizable-panels"; readonly bindings: { readonly orientation: "horizontal" } }
);

export type ElementAdaptation = {
  readonly kind: "import-paths" | "token-mapping" | "data-binding" | "data-fit" | "slot-bound-copy" | "slot-bound-identity";
  readonly file: string;
  readonly reason: string;
  readonly hash?: Hash;
  readonly optionCount?: 1;
  readonly menu?: string;
} & ({ readonly operation?: "single-option-static-row" } | FiniteDataFitReplay);

export type ElementRecord = {
  readonly schema: "clossys.element/1";
  readonly id: string;
  readonly package: string;
  readonly layer: string;
  readonly slot: string;
  readonly kind: string;
  readonly version: number;
  readonly hash: Hash;
  readonly lineage: {
    readonly mode: LineageMode;
    readonly path?: "pick" | "adopt" | "create";
    readonly ownerRequest?: string;
    readonly adaptations?: readonly ElementAdaptation[];
    readonly exactParts?: ExactPartProof;
    readonly source?: ReferenceRef;
    /** Further trusted references the payload takes verbatim parts from, beside the source block. */
    readonly parts?: readonly ReferenceRef[];
    readonly parent?: { readonly version: number; readonly hash: Hash };
  };
  readonly license: { readonly spdx: string; readonly attribution?: string; readonly file?: string };
  readonly creator: { readonly agent: string; readonly model: string; readonly by?: string };
  readonly reason: string;
  readonly createdAt: string;
  readonly checks: readonly CheckResult[];
  readonly deps: { readonly npm: Readonly<Record<string, string>>; readonly elements: readonly ElementDependency[] };
  readonly reads: { readonly copyKeys: readonly ElementCopyKey[]; readonly themeVars: readonly string[] };
  readonly payload?: readonly string[];
};

/**
 * What an element reads from Writer: a copy slot `{ slot, prop, previewKey }` (a page binds `slot`,
 * the text renders at `prop`, the specimen previews it with `previewKey`), or a bare Writer key it
 * reads through host data.
 */
export type ElementCopyKey = string | { readonly slot: string; readonly prop: string; readonly previewKey: string };

export type PreviewRecord = {
  readonly schema: "clossys.preview/1";
  readonly fixtures: Readonly<Record<string, unknown>>;
  readonly copy: Readonly<Record<string, string>>;
  readonly container: "canvas" | "section-in-frame" | "page";
  readonly theme: "light" | "dark";
  readonly width: number;
};

export type PinState = {
  readonly element: string;
  readonly version: number;
  readonly hash: Hash;
  /** Id of the history event that produced this pin. */
  readonly event: string;
};

export type PinEvent = {
  readonly id: string;
  readonly at: string;
  readonly by: string;
  readonly action: "pin" | "restore" | "unpin";
  readonly slot: string;
  readonly element?: string;
  readonly version?: number;
  readonly hash?: Hash;
  readonly from?: "option" | "saved" | "version" | "reference";
  readonly restores?: string;
  readonly approval?: string;
  readonly reason?: string;
};

export type SpecimenKind = "visual" | "text" | "data" | "media" | "flow";

/** Region input names are bound once by the frame that owns the region. */
export type FrameOwnership =
  | { readonly kind: "app"; readonly regions: { readonly navigation: readonly string[] } }
  | { readonly kind: "page"; readonly regions: { readonly header: readonly string[]; readonly chat: readonly string[]; readonly body: readonly string[] } };

export type SlotContract = {
  readonly schema: "clossys.slot-contract/1";
  readonly slot: string;
  readonly package: string;
  readonly layer: string;
  readonly purpose: string;
  readonly ownership?: FrameOwnership;
  readonly inputs: readonly {
    readonly name: string;
    readonly kind: "copy" | "prop" | "asset" | "theme" | "data" | "cell";
    readonly required: boolean;
    readonly description?: string;
    /** Owning identity, Writer or composed slot; never a literal frame value. */
    readonly slot?: string;
  }[];
  readonly limits: Readonly<Record<string, number | string | boolean>>;
  readonly references: readonly ReferenceRef[];
  readonly checkSuite: string;
  readonly specimenKind: SpecimenKind;
};

export type ReferenceFile = { readonly path: string; readonly sha256: string; readonly bytes: number; readonly origin: string };

export type ReferenceItem = {
  readonly registry: string;
  readonly name: string;
  readonly version: string;
  readonly dir: string;
  readonly type: string;
  readonly sourceUrl: string;
  readonly license: string;
  readonly direct: boolean;
  readonly slots: readonly string[];
  readonly requiredBy?: readonly string[];
  readonly registryDependencies?: readonly string[];
  readonly dependencies?: readonly string[];
  readonly hash: Hash;
  readonly files: readonly ReferenceFile[];
  /** Owner-approved source sanitization, retaining the complete upstream digest record. */
  readonly adaptations?: readonly {
    readonly kind: "identity";
    readonly reason: string;
    readonly approvedBy: "owner";
    readonly approvedAt: string;
    readonly upstream: { readonly hash: Hash; readonly files: readonly ReferenceFile[] };
  }[];
};

export type ReferencesManifest = {
  readonly schema: "clossys.references-manifest/1";
  readonly package: string;
  readonly fetchedAt: string;
  readonly fetchedWith?: string;
  readonly hashAlgorithm: "sha256-tree/1";
  readonly registries: Readonly<
    Record<
      string,
      {
        readonly namespace: string;
        readonly source: string;
        readonly version: string;
        readonly versionBasis?: string;
        readonly upstream?: string;
        readonly style?: string;
        readonly fetchedAt?: string;
        readonly license: string;
        readonly licenseFiles: readonly string[];
      }
    >
  >;
  readonly licenses: readonly { readonly path: string; readonly sha256: string; readonly bytes: number; readonly sourceUrl: string }[];
  readonly items: readonly ReferenceItem[];
  readonly skipped: readonly { readonly ref: string; readonly slots?: readonly string[]; readonly reason: string }[];
};
