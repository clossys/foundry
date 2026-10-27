import type { FlowBody, CanvasBody, FrameStageContract, BodySubstrate, SectionSubstrateRenderTest } from "@clossys/designer/catalog";
import type { LayoutLeaf, LayoutRead, LayoutSpan, SectionLeafId } from "../layouts/contract.js";
import type { LayoutId } from "../layouts/ids.js";
import type { FormatId, FormatLeaf } from "../formats/contract.js";

/** References address consumer-owned content; values never contain audience copy. */
export interface ContentRef {
  readonly kind: "copy" | "media" | "records" | "action" | "region";
  readonly ref: string;
}
export interface SectionFill {
  readonly section: SectionLeafId;
  readonly config?: string;
  readonly span?: LayoutSpan;
  readonly content: Readonly<Record<string, ContentRef>>;
}
/** Page assembly only. Frame and section implementations belong to the consumer library. */
export interface InstanceSectionRef { readonly slot: string; readonly index: number }
export interface InstanceBindingBase {
  readonly instanceId: string;
  readonly label: string;
  readonly path?: string;
  readonly surface: "site" | "app";
  readonly packIds: readonly string[];
  readonly format: FormatId;
  readonly context: { readonly consumer?: string; readonly brand?: string; readonly medium: "web" };
  readonly frame: { readonly leaf: `frames.${string}`; readonly config?: string;
    /** Consumer references for declared host-content slots; values stay in the original runtime. */
    readonly content?: Readonly<Record<string, ContentRef>>;
    readonly slotFills?: { readonly consent?: SectionFill; readonly context?: SectionFill };
    /** One chosen member per axis (`{ layout: "standard" }` selects `layout.standard`). It narrows the
     * verified frame descriptor's members and never adds one; absent, every descriptor member projects. */
    readonly members?: Readonly<Record<string, string>> };
  /** Required even though the early draft illustrated an optional config. */

  readonly fills: Readonly<Record<string, readonly SectionFill[]>>;
  readonly states?: readonly string[];
}
/** Existing flow instances remain valid; registered routes additionally require body. */
export interface FlowInstanceBinding extends InstanceBindingBase {
  readonly layout: { readonly leaf: LayoutId; readonly config: string; readonly members?: Readonly<Record<string, string>> };
  readonly body?: FlowBody<InstanceSectionRef>;
}
/** A canvas has an arrangement, never a dummy page Layout configuration. */
export interface CanvasInstanceBinding extends InstanceBindingBase {
  readonly body: CanvasBody<InstanceSectionRef>;
  readonly layout?: never;
}
export type InstanceBinding = FlowInstanceBinding | CanvasInstanceBinding;
export type InstanceCheckCode = "LK1" | "LK2" | "LK3" | "LK4" | "LK5" | "LK6" | "LK7" | "LK8" | "LK9" | "LK10" | "LK11" | "LK13" | "LK14" | "LK15" | "LK16";
export interface InstanceFinding { readonly code: InstanceCheckCode; readonly path: string; readonly message: string }
export interface InstanceCheckResult {
  readonly staticStatus: "valid" | "refused";
  readonly findings: readonly InstanceFinding[];
  /** Static validation cannot clear responsive rendering or full pack closure. */
  readonly pendingChecks: readonly ["LK12"];
}
export type BindingLeafStatus = "draft" | "stable" | "held" | "deprecated";
/** Narrow registry projections keep lookup independent of any catalog implementation. */
export interface BindingFrameLeaf {
  readonly id: `frames.${string}`;
  readonly status: BindingLeafStatus;
  readonly contract: { readonly surface: "site" | "app" | "both"; readonly configs: readonly string[]; readonly stage?: FrameStageContract;
    /** Closed `axis.member` names a binding may select from; absent, no member selection validates. */
    readonly members?: readonly string[] };
}
export interface BindingSectionLeaf {
  readonly id: SectionLeafId;
  readonly status: BindingLeafStatus;
  readonly contract: {
    readonly surface: "site" | "app" | "both";
    readonly configs: readonly string[];
    readonly slots: readonly { readonly name: string; readonly type: ContentRef["kind"]; readonly required: boolean }[];
    readonly states?: readonly string[];
    readonly container?: "adaptive";
    readonly substrates?: readonly BodySubstrate[];
    readonly substrateTests?: readonly SectionSubstrateRenderTest[];
  };
}
export interface BindingToken {
  readonly id: `${LayoutRead}.${string}`;
  readonly property: string;
}
export interface InstanceRegistries {
  readonly formats: readonly FormatLeaf[];
  readonly frames: readonly BindingFrameLeaf[];
  readonly layouts: readonly LayoutLeaf[];
  readonly sections: readonly BindingSectionLeaf[];
  /** Actual consumer token addresses, not a catalog fallback. */
  readonly tokens: readonly BindingToken[];
}
/** Full local source closure. Missing imports and unsupported dynamic syntax fail closed. */
export interface LayoutRendererSource { readonly entry: string; readonly files: Readonly<Record<string, string>> }
export interface ConsumerInstanceFill {
  readonly library: string;
  readonly leaf: string;
  readonly config?: string;
  /** Declared header output after choosing this fill/config. Empty means no header. */
  readonly headings: readonly (1 | 2)[];
  readonly states: readonly string[];
  readonly bandGround?: string;
  readonly headerGround?: "opaque" | "glass" | "transparent";
  /** Only the layout exposes the lead; only this named frame input may consume it. */
  readonly leadGround?: string;
  readonly groundRead?: "leadGround";
  readonly renderer?: LayoutRendererSource;
}
export interface ConsumerInstanceLibrary {
  readonly id: string;
  readonly role: "consumer";
  /** No fallback argument exists. An adopted fill still identifies this consumer library. */
  resolveFill(leaf: string, config?: string): ConsumerInstanceFill | undefined;
  resolveContent(ref: ContentRef): ContentRef | undefined;
}
