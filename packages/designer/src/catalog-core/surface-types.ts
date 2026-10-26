/** Consumer-owned source records. No executable callbacks are stored in a library. */
import type { DtcgValue, FillMeta, FrameSlot, CompositeCatalogData, CompositeLibraryData, CompositeResolved, CompositeEngineInput } from "./types.js";
import type { SectionSlot } from "./sections-contract.js";
import type { RuntimeSourceClosure, RuntimeRendererDescriptor } from "./runtime-ports.js";
export type SurfaceSlot = `sections.${string}` | `frames.${string}`;
export interface SurfaceFile {
    path: string;
    content: string;
}
export interface SurfaceFileHash {
    path: string;
    sha256: string;
}
export type SurfacePin = {
    kind: "git";
    url: string;
    commit: string;
    files: readonly SurfaceFileHash[];
} | {
    kind: "local-tree";
    tree: string;
    files: readonly SurfaceFileHash[];
};
export interface SurfaceApi {
    version: 1;
    exports: readonly {
        name: string;
        export: string;
    }[];
}
export interface SurfacePropBinding {
    export: string;
    path: readonly string[];
}
export interface SurfaceLiteralBinding extends SurfacePropBinding {
    value: DtcgValue;
}
export interface SurfaceConfig {
    members: readonly string[];
    props: readonly SurfaceLiteralBinding[];
}
export interface SurfaceComponentBinding {
    file: string;
    module: string;
    name: string;
    local: string;
    slot: `components.${string}`;
}
export interface SurfaceDependency {
    module: string;
    version: string;
    license: string;
}
export interface SurfaceBase {
    source: string;
    fill: string;
    license: string;
    pin: SurfacePin;
    descriptorHash: string;
    upstreamSha256: readonly SurfaceFileHash[];
    notices: readonly SurfaceFileHash[];
}
export type SurfaceInputRef = {
    kind: "component";
    id: `components.${string}`;
} | {
    kind: "value";
    id: `tokens.${string}` | `assets.${string}`;
} | {
    kind: "surface";
    id: SurfaceSlot;
} | {
    kind: "dependency";
    id: string;
};
export interface SurfaceInputIdentity {
    input: SurfaceInputRef;
    hash: string;
}
export interface SurfaceRuleIdentity {
    id: string;
    version: string;
    sha256: string;
}
export type SurfaceOrigin = {
    kind: "adopted";
    base: SurfaceBase;
    transform: SurfaceRuleIdentity;
    descriptorHash: string;
    adoptedAt: string;
} | {
    kind: "derived";
    base: SurfaceBase;
    transform: SurfaceRuleIdentity;
    rule: SurfaceRuleIdentity;
    inputs: readonly SurfaceInputIdentity[];
    inputsHash: string;
    descriptorHash: string;
} | {
    kind: "authored";
    license: string;
    descriptorHash: string;
    lineage?: SurfaceBase;
    note?: string;
};
export interface SurfaceEntryBase {
    slot: SurfaceSlot;
    source: string;
    impl: {
        kind: "source";
        entry: string;
        export: string;
    };
    rendering: "client" | "server";
    members: readonly string[];
    states: readonly string[];
    reads: {
        tokens: readonly string[];
        assets: readonly string[];
    };
    composes: readonly string[];
    parts: readonly string[];
    api: SurfaceApi;
    bindings: readonly SurfaceComponentBinding[];
    dependencies: readonly SurfaceDependency[];
    license: string;
    pin: SurfacePin;
    notice: string;
    outputSha256: readonly SurfaceFileHash[];
    blockers: readonly {
        code: string;
        message: string;
    }[];
}
export interface SurfaceSectionEntry extends SurfaceEntryBase {
    kind: "section";
    slot: `sections.${string}`;
    slotMap: Readonly<Record<string, SurfacePropBinding>>;
    propMap: Readonly<Record<string, SurfacePropBinding>>;
    configs: Readonly<Record<string, SurfaceConfig>>;
}
export interface SurfaceFrameEntry extends SurfaceEntryBase {
    kind: "frame";
    slot: `frames.${string}`;
    slots: Readonly<Record<string, SurfacePropBinding>>;
    propMap: Readonly<Record<string, SurfacePropBinding>>;
    statePorts: Readonly<Record<string, {
        value: SurfacePropBinding;
        change: SurfacePropBinding;
    }>>;
}
export type SurfaceCandidate = SurfaceSectionEntry | SurfaceFrameEntry;
export type SurfaceCandidateDocument = {
    $extensions: {
        "com.clossys.fill": FillMeta;
    };
    sections: Readonly<Record<string, SurfaceSectionEntry>>;
    frames?: never;
} | {
    $extensions: {
        "com.clossys.fill": FillMeta;
    };
    frames: Readonly<Record<string, SurfaceFrameEntry>>;
    sections?: never;
};
export type SurfaceDocument = {
    $extensions: {
        "com.clossys.fill": FillMeta;
    };
    sections: Readonly<Record<string, SurfaceSectionEntry & {
        origin: SurfaceOrigin;
    }>>;
    frames?: never;
} | {
    $extensions: {
        "com.clossys.fill": FillMeta;
    };
    frames: Readonly<Record<string, SurfaceFrameEntry & {
        origin: SurfaceOrigin;
    }>>;
    sections?: never;
};
/** Exact package pointer, the component K8 shape: `export` is `./<subpath>#<Export>`. */
export interface SurfacePackagePin {
    package: string;
    version: string;
    export: string;
}
/** A package-pointer descriptor exactly as the Foundry importers emit it; it carries no source bytes. */
export interface SurfacePackageSectionEntry {
    slot: `sections.${string}`;
    source: string;
    slotMap: Readonly<Record<string, string>>;
    propMap: Readonly<Record<string, string>>;
    configs: Readonly<Record<string, string>>;
    parts: readonly string[];
    impl: { kind: "package"; module: string; export: string };
    license: string;
    pin: SurfacePackagePin;
    notes: readonly string[];
}
export interface SurfacePackageFrameEntry {
    slot: `frames.${string}`;
    members: readonly string[];
    propMap: Readonly<Record<string, string>>;
    slots: Readonly<Record<string, string>>;
    statePorts: Readonly<Record<string, string>>;
    impl: { kind: "package"; module: string; export: string };
}
export type SurfacePackageEntry = SurfacePackageSectionEntry | SurfacePackageFrameEntry;
/** Joined to the catalog candidate (descriptorHash, pin) at adopt and at every check; never minted by the library. */
export interface SurfacePackageOrigin {
    kind: "package";
    source: string;
    fill: string;
    pin: SurfacePackagePin;
    license: string;
    descriptorHash: string;
    adoptedAt: string;
}
export type SurfacePackageDocument = {
    $extensions: {
        "com.clossys.fill": FillMeta;
    };
    sections?: Readonly<Record<string, SurfacePackageEntry & { origin?: SurfacePackageOrigin }>>;
    frames?: Readonly<Record<string, SurfacePackageEntry & { origin?: SurfacePackageOrigin }>>;
};
export type SurfaceAnyDocument = SurfaceCandidateDocument | SurfaceDocument | SurfacePackageDocument;
export type SurfaceEntry = (SurfaceCandidate & { origin?: SurfaceOrigin }) | (SurfacePackageEntry & { origin?: SurfacePackageOrigin });
export interface SurfaceLibraryPortion {
    version: 1;
    /** Package-pointer leaves are stored here too (validated by surfaceEntryOf at every read). */
    fills: readonly SurfaceDocument[];
    files: readonly SurfaceFile[];
}
export interface SurfacePackageEvidence {
    module: string;
    version: string;
    artifactSha256: string;
    values: readonly string[];
    types: readonly string[];
}
export interface SurfaceCommandReceipt {
    argv: readonly string[];
    exitCode: number;
    stdoutSha256: string;
    stderrSha256: string;
}
export interface SurfaceMeasurement {
    version: 1;
    slot: SurfaceSlot;
    scope: "synthetic" | "real";
    identity: SurfaceRuntimeIdentity;
    source: RuntimeSourceClosure;
    compiled: RuntimeSourceClosure;
    compiler: RuntimeRendererDescriptor;
    command: SurfaceCommandReceipt;
    checks: {
        types: "pass" | "fail";
        closure: "pass" | "fail";
    };
    runtime: null | {
        renderer: RuntimeRendererDescriptor;
        command: SurfaceCommandReceipt;
        checks: {
            module: "pass" | "fail";
        };
    };
}
export interface SurfaceResolutionOptions {
    packages: readonly SurfacePackageEvidence[];
    measurements: readonly SurfaceMeasurement[];
}
export interface SurfaceApplyOptions {
    componentOptions?: CompositeEngineInput["componentOptions"];
    surfaceOptions: SurfaceResolutionOptions;
}
export interface SurfaceFinding {
    code: "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8";
    rule: "surfaces";
    severity: "error" | "notice" | "warning";
    subject: string;
    message: string;
}
export interface SurfaceCheckResult {
    ok: boolean;
    findings: readonly SurfaceFinding[];
}
export interface SurfaceResolvedFill {
    document: SurfaceDocument;
    descriptorHash: string;
    outputHash: string;
    apiHash: string;
    inputsHash: string;
}
export interface SurfaceResolved {
    version: 1;
    consumer: string;
    selectionHash: string;
    fills: Readonly<Record<SurfaceSlot, SurfaceResolvedFill>>;
    files: readonly SurfaceFile[];
    check: SurfaceCheckResult;
}
export type SurfaceOperation = {
    op: "adopt";
    slot: SurfaceSlot;
    source: string;
} | {
    op: "derive";
    slot: SurfaceSlot;
    rule: string;
    inputs: readonly SurfaceInputRef[];
} | {
    op: "author";
    slot: SurfaceSlot;
    fill: SurfaceCandidate;
    files: readonly SurfaceFile[];
    note?: string;
} | {
    op: "remove";
    slot: SurfaceSlot;
};
export interface SurfaceTransformResult {
    fill: SurfaceCandidate;
    files: readonly SurfaceFile[];
    blockers: readonly {
        code: string;
        message: string;
    }[];
}
export interface SurfaceTransform {
    identity: SurfaceRuleIdentity;
    source: readonly SurfaceFile[];
    run(input: {
        candidate: SurfaceCandidate;
        upstream: readonly SurfaceFile[];
    }): SurfaceTransformResult;
}
export interface SurfaceRule {
    identity: SurfaceRuleIdentity;
    source: readonly SurfaceFile[];
    slot: SurfaceSlot;
    base: SurfaceBase;
    inputs: readonly SurfaceInputRef[];
    run(input: {
        base: SurfaceCandidate;
        upstream: readonly SurfaceFile[];
        library: CompositeLibraryData;
        resolved: CompositeResolved;
    }): SurfaceTransformResult;
}
export interface SurfaceCatalog {
    slots: readonly (SectionSlot | FrameSlot)[];
    /** Package-pointer candidates (importFoundrySections/Frames) are listed here too; surfaceEntryOf tells them apart. */
    fills: readonly SurfaceCandidateDocument[];
    transforms: readonly SurfaceTransform[];
    rules: readonly SurfaceRule[];
    materializations: readonly SurfaceMaterializationReceipt[];
}
export type SurfaceFetchPort = (request: {
    pin: SurfacePin;
    path: string;
    sha256: string;
}) => Promise<string>;
export interface SurfaceMaterializationInput {
    catalog: CompositeCatalogData;
    library: CompositeLibraryData;
    slot: SurfaceSlot;
    source: string;
    rule: string | null;
    transform: string;
    fetch: SurfaceFetchPort;
    componentOptions?: CompositeEngineInput["componentOptions"];
    surfaceOptions: SurfaceResolutionOptions;
}
export interface SurfaceSourceBundle {
    version: 1;
    operation: "adopt" | "derive";
    slot: SurfaceSlot;
    document: SurfaceDocument;
    base: SurfaceBase;
    upstream: readonly SurfaceFile[];
    files: readonly SurfaceFile[];
    transform: SurfaceRuleIdentity;
    rule: SurfaceRuleIdentity | null;
    inputs: readonly SurfaceInputIdentity[];
    inputsHash: string;
}
export interface SurfaceSelection {
    version: 1;
    consumer: string;
    slots: readonly {
        slot: SurfaceSlot;
        fill: string;
        originKind: SurfaceOrigin["kind"] | "package";
        source: string;
    }[];
}
export type SurfaceEmitTarget = "surface-index" | "surfaces-consumption";
export interface SurfaceRuntimeIdentity {
    version: 1;
    descriptorHash: string;
    outputHash: string;
    apiHash: string;
    inputsHash: string;
}
export interface SurfaceMaterializationReceipt {
    operation: "adopt" | "derive";
    slot: SurfaceSlot;
    baseDescriptorHash: string;
    transform: SurfaceRuleIdentity;
    rule: SurfaceRuleIdentity | null;
    inputsHash: string;
    descriptorHash: string;
    outputSha256: readonly SurfaceFileHash[];
}
