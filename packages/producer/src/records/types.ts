/** TypeScript views of the record schemas in ./schemas.ts. Validate before trusting a cast. */

export type Hash = `sha256:${string}`;

export type LineageMode = "verbatim" | "customized" | "original";

export type ReferenceRef = {
  readonly registry: string;
  readonly item: string;
  readonly version: string;
  readonly hash?: Hash;
  readonly url?: string;
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
    readonly source?: ReferenceRef;
    readonly parent?: { readonly version: number; readonly hash: Hash };
  };
  readonly license: { readonly spdx: string; readonly attribution?: string; readonly file?: string };
  readonly creator: { readonly agent: string; readonly model: string; readonly by?: string };
  readonly reason: string;
  readonly createdAt: string;
  readonly checks: readonly CheckResult[];
  readonly deps: { readonly npm: Readonly<Record<string, string>>; readonly elements: readonly ElementDependency[] };
  readonly reads: { readonly copyKeys: readonly string[]; readonly themeVars: readonly string[] };
  readonly payload?: readonly string[];
};

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
  readonly reason?: string;
};

export type Pins = Readonly<Record<string, PinState>>;

export type Selection = {
  readonly schema: "clossys.selection/1";
  readonly pins: Pins;
  readonly history: readonly PinEvent[];
};

export type Release = {
  readonly schema: "clossys.release/1";
  readonly number: number;
  readonly at: string;
  readonly by: string;
  readonly pins: Pins;
  readonly selectionEvent: string | null;
  readonly notes?: string;
};

export type SpecimenKind = "visual" | "text" | "data" | "media" | "flow";

export type SlotContract = {
  readonly schema: "clossys.slot-contract/1";
  readonly slot: string;
  readonly package: string;
  readonly layer: string;
  readonly purpose: string;
  readonly inputs: readonly {
    readonly name: string;
    readonly kind: "copy" | "prop" | "asset" | "theme" | "data" | "cell";
    readonly required: boolean;
    readonly description?: string;
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
        readonly license: string;
        readonly licenseFiles: readonly string[];
      }
    >
  >;
  readonly licenses: readonly { readonly path: string; readonly sha256: string; readonly bytes: number; readonly sourceUrl: string }[];
  readonly items: readonly ReferenceItem[];
  readonly skipped: readonly { readonly ref: string; readonly slots?: readonly string[]; readonly reason: string }[];
};
