import type { FlowBody, CanvasBody, FrameStageContract, BodySubstrate, SectionSubstrateRenderTest } from "@clossys/designer/catalog";
import type { LayoutLeaf, LayoutRead, LayoutSpan, SectionLeafId } from "../layouts/contract.js";
import type { LayoutId } from "../layouts/ids.js";
import type { FormatId, FormatLeaf } from "../formats/contract.js";
import { runtimeHash } from "@clossys/designer/catalog";
import type { RuntimeContent } from "@clossys/designer/catalog";

/** References address consumer-owned content; values never contain audience copy. */
export interface ContentRef {
  readonly kind: "copy" | "media" | "records" | "action" | "region";
  readonly ref: string;
  /** Consumer chunk data is requested by the page session, never by a renderer. */
  readonly lazy?: { readonly loader: "chunk"; readonly args: { readonly l0: string; readonly l1?: string } };
}
export interface SectionFill {
  readonly section: SectionLeafId;
  readonly config?: string;
  readonly span?: LayoutSpan;
  readonly content: Readonly<Record<string, ContentRef>>;
  /** Each records row supplies its stable key and optional content-ref overrides.
   * There is no expression/template language and no host-authored JSX. */
  readonly repeat?: { readonly over: ContentRef & { readonly kind: "records" }; readonly key: string };
  /** Authored nesting only. Consumer repeat rows can supply typed references,
   * never replacement Section implementations or child compositions. */
  readonly children?: readonly SectionFill[];
}
/** Page assembly only. Frame and section implementations belong to the consumer library. */
export interface InstanceSectionRef { readonly slot: string; readonly index: number }
export interface SectionPlacement extends InstanceSectionRef { readonly children?: readonly number[] }
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

/** One selected frame and arrangement, shared by this publication's region pages. */
export interface PublicationBinding {
  readonly id: string;
  readonly frame: InstanceBindingBase["frame"];
  readonly layout: FlowInstanceBinding["layout"];
  /** Explicit selected Layout slot used independently by each L0 assembly. */
  readonly mainSlot: string;
  readonly format: FormatId;
  readonly surface: InstanceBindingBase["surface"];
  readonly context: InstanceBindingBase["context"];
  readonly packIds: readonly string[];
  /** Shared chat Section, mounted by the persistent frame, never by a page. */
  readonly inspector?: SectionFill;
}
/** A page owns regions, not a second frame or a second arrangement. */
export interface RegionPageBinding {
  readonly instanceId: string;
  readonly label: string;
  readonly path: string;
  readonly publicationId: string;
  readonly regions: {
    readonly main: readonly SectionFill[];
    readonly "page-module"?: readonly SectionFill[];
    readonly inspector?: ContentRef;
  };
}

const contentText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.trim() === value;
const contentRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const contentOnly = (value: object, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
export function contentReferenceKey(reference: Pick<ContentRef, "kind" | "ref">): string { return JSON.stringify([reference.kind, reference.ref]); }
export function isRegisteredContentRef(value: unknown): value is ContentRef {
  if (!contentRecord(value) || !contentOnly(value, ["kind", "ref", "lazy"]) || !["copy", "media", "records", "action", "region"].includes(value.kind as string) || !contentText(value.ref)) return false;
  if (value.lazy === undefined) return true;
  const lazy = value.lazy;
  return contentRecord(lazy) && contentOnly(lazy, ["loader", "args"]) && lazy.loader === "chunk" && contentRecord(lazy.args)
    && contentOnly(lazy.args, ["l0", "l1"]) && contentText(lazy.args.l0) && (lazy.args.l1 === undefined || contentText(lazy.args.l1));
}
export function staticContentReference(reference: ContentRef): ContentRef {
  if (!isRegisteredContentRef(reference)) throw new TypeError("Invalid consumer content reference");
  return { kind: reference.kind, ref: reference.ref };
}
/** Schema view only: retain each declared placement once and remove additive
 * data instructions before the unchanged static body/Section validator. */
export function registeredBindingTemplate(binding: InstanceBinding): InstanceBinding {
  if (binding.body?.kind === "canvas" && Object.values(binding.frame.content ?? {}).some(reference => reference.lazy)) throw new TypeError("Scroll page data is flow-only");
  const refs = (values: Readonly<Record<string, ContentRef>>) => Object.fromEntries(Object.entries(values).map(([slot, reference]) => [slot, staticContentReference(reference)]));
  const seen = new Set<SectionFill>();
  const section = (fill: SectionFill): SectionFill => {
    if (seen.has(fill)) throw new TypeError("Cyclic Section nesting"); seen.add(fill);
    if (!contentOnly(fill, ["section", "config", "span", "content", "repeat", "children"])) throw new TypeError("Unknown Section fill field");
    if (fill.repeat && (!contentOnly(fill.repeat, ["over", "key"]) || !contentText(fill.repeat.key) || !isRegisteredContentRef(fill.repeat.over) || fill.repeat.over.kind !== "records")) throw new TypeError("Invalid Section repeat declaration");
    if (binding.body?.kind === "canvas" && (fill.repeat || fill.children || Object.values(fill.content).some(ref => ref.lazy))) throw new TypeError("Scroll page data is flow-only");
    if (fill.children !== undefined && (!Array.isArray(fill.children) || !fill.children.length)) throw new TypeError("Section children must be a non-empty authored list");
    const { repeat: _repeat, ...plain } = fill, result = { ...plain, content: refs(fill.content), ...(fill.children ? { children: fill.children.map(section) } : {}) }; seen.delete(fill); return result;
  };
  return { ...binding, fills: Object.fromEntries(Object.entries(binding.fills).map(([slot, fills]) => [slot, fills.map(section)])), frame: { ...binding.frame,
    ...(binding.frame.content ? { content: refs(binding.frame.content) } : {}), ...(binding.frame.slotFills ? { slotFills: Object.fromEntries(Object.entries(binding.frame.slotFills).map(([slot, fill]) => [slot, section(fill)])) } : {}) } } as InstanceBinding;
}
export interface RepeatedSectionScope { readonly key?: string; readonly keys: readonly string[]; readonly l0?: string; readonly l1?: string; readonly placement: SectionPlacement }
export type RepeatedSectionsResult = { readonly status: "ready"; readonly binding: InstanceBinding; readonly keys: Readonly<Record<string, string>>;
  readonly scopes: Readonly<Record<string, RepeatedSectionScope>>; readonly lazy: Readonly<Record<string, ContentRef>> }
  | { readonly status: "pending" | "refused"; readonly findings: readonly string[] };
/** Lower additive page data to the unchanged Designer assembly contract. A lazy
 * repeat contributes no rows before it is requested; it never invokes a loader. */
export function normalizeRepeatedSections(binding: InstanceBinding, resolveContent: (reference: ContentRef) => RuntimeContent | undefined): RepeatedSectionsResult {
  try {
    registeredBindingTemplate(binding);
    const keys: Record<string, string> = {}, scopes: Record<string, RepeatedSectionScope> = {}, lazy: Record<string, ContentRef> = {};
    const scoped = (reference: ContentRef, aliases: ReadonlyMap<string, ContentRef>): ContentRef => {
      const ref = aliases.get(reference.ref) ?? reference;
      if (!isRegisteredContentRef(ref) || ref.kind !== reference.kind) throw new TypeError("Scoped reference must retain its declared content kind");
      return ref;
    };
    const refs = (content: Readonly<Record<string, ContentRef>>, aliases: ReadonlyMap<string, ContentRef>) => Object.fromEntries(Object.entries(content).map(([name, raw]) => {
      const ref = scoped(raw, aliases);
      if (!isRegisteredContentRef(ref)) throw new TypeError("Invalid repeated content reference");
      if (ref.lazy) {
        const key = contentReferenceKey(ref), prior = lazy[key];
        if (prior && runtimeHash(prior) !== runtimeHash(ref)) throw new TypeError("Conflicting lazy content reference");
        lazy[key] = ref;
      }
      return [name, staticContentReference(ref)];
    }));
    const fills: Record<string, SectionFill[]> = {}, remap = new Map<string, readonly InstanceSectionRef[]>();
    const expand = (fill: SectionFill, placement: SectionPlacement, prefix: string, offset: number, aliases: ReadonlyMap<string, ContentRef>, inheritedKeys: readonly string[], inheritedScope: { readonly l0?: string; readonly l1?: string }): SectionFill[] => {
      const repeat = fill.repeat;
      let rows: readonly Record<string, unknown>[] = [{}], over: ContentRef | undefined;
      if (repeat) {
        over = scoped(repeat.over, aliases);
        const current = resolveContent(over);
        if (!current) {
          if (!over.lazy) throw new PendingRepeat(over.ref);
          rows = [];
        } else {
          if (current.hash !== runtimeHash(current.value) || contentReferenceKey(current.reference) !== contentReferenceKey(over) || !Array.isArray(current.value)) throw new TypeError("Repeat data must be current records");
          rows = current.value as unknown as readonly Record<string, unknown>[];
        }
      }
      const result: SectionFill[] = [], seen = new Set<string>();
      for (const row of rows) {
        if (!contentRecord(row)) throw new TypeError("Repeat row must be a record");
        const rawKey = repeat ? row[repeat.key] : undefined;
        const key = rawKey === undefined ? undefined : typeof rawKey === "number" && Number.isFinite(rawKey) ? String(rawKey) : contentText(rawKey) ? rawKey : undefined;
        if (repeat && (key === undefined || seen.has(key))) throw new TypeError("Repeat keys must be present and unique");
        if (key !== undefined) seen.add(key);
        const scopedAliases = new Map(aliases);
        if (row.references !== undefined) {
          if (!contentRecord(row.references)) throw new TypeError("Scoped references must be a data record");
          for (const [name, reference] of Object.entries(row.references)) { if (!contentText(name) || !isRegisteredContentRef(reference)) throw new TypeError("Scoped references must be typed consumer references"); scopedAliases.set(name, reference); }
        }
        if (row.content !== undefined && !contentRecord(row.content)) throw new TypeError("Repeat content must contain consumer references");
        const content = { ...fill.content, ...(row.content as Record<string, ContentRef> | undefined) }, path = `${prefix}.${offset + result.length}`;
        const scopedContent = Object.fromEntries(Object.entries(content).map(([name, reference]) => [name, scoped(reference, scopedAliases)]));
        const source = Object.values(scopedContent).find(ref => ref.lazy)?.lazy?.args ?? over?.lazy?.args ?? inheritedScope;
        const ancestry = key === undefined ? inheritedKeys : [...inheritedKeys, key];
        scopes[path] = { placement, keys: ancestry, ...(ancestry.length ? { key: ancestry.at(-1)! } : {}), ...source };
        if (ancestry.length) keys[path] = ancestry.length === 1 ? ancestry[0]! : JSON.stringify(ancestry);
        const children: SectionFill[] = [];
        for (const [index, child] of (fill.children ?? []).entries()) children.push(...expand(child, { ...placement, children: [...(placement.children ?? []), index] }, `${path}.children`, children.length, scopedAliases, ancestry, source));
        const { repeat: _repeat, children: _children, ...plain } = fill;
        result.push({ ...plain, content: refs(scopedContent, new Map()), ...(children.length ? { children } : {}) });
      }
      return result;
    };
    for (const [slot, values] of Object.entries(binding.fills)) {
      fills[slot] = [];
      for (const [index, fill] of values.entries()) {
        const offset = fills[slot]!.length, expandedFills = expand(fill, { slot, index }, `sections.${slot}`, offset, new Map(), [], {});
        const expanded = expandedFills.map((_, index) => ({ slot, index: offset + index })); fills[slot]!.push(...expandedFills);
        remap.set(JSON.stringify([slot, index]), expanded);
      }
    }
    const body = binding.body;
    const mappedBody = body?.kind === "flow" ? { ...body, sections: body.sections.flatMap(ref => remap.get(JSON.stringify([ref.slot, ref.index])) ?? [ref]) } : body;
    const slotFills = binding.frame.slotFills && Object.fromEntries(Object.entries(binding.frame.slotFills).map(([slot, fill]) => {
      if (fill.repeat) throw new TypeError("Ancillary frame regions do not repeat");
      return [slot, expand(fill, { slot, index: 0 }, `frameSlots.${slot}`, 0, new Map(), [], {})[0]!];
    }));
    return { status: "ready", binding: { ...binding, fills, ...(mappedBody ? { body: mappedBody } : {}), frame: { ...binding.frame, ...(binding.frame.content ? { content: refs(binding.frame.content, new Map()) } : {}), ...(slotFills ? { slotFills } : {}) } } as InstanceBinding, keys, scopes, lazy };
  } catch (error) { return { status: error instanceof PendingRepeat ? "pending" : "refused", findings: [(error as Error).message] }; }
}
class PendingRepeat extends Error { constructor(reference: string) { super(`Repeat data pending: ${reference}`); } }
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
