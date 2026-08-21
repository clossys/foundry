import type { CopyRef, CopyResolution, CopyResolver } from "@vespeneventures/writer";
import { isSurfaceRepeatingSlotBinding, validateSurfaceDocument } from "./validate.js";
import type { ComposeDocument, SlotBinding, SurfaceChannelMeta, SurfaceDocument, SurfaceRepeatingSlotBinding, SurfaceSlotBindingItem } from "./types.js";

export type SurfaceResolutionReason = "invalid-surface" | "unresolved-copy" | "unsupported-node";

/** A canonical surface could not be safely lowered into a renderer input. */
export class SurfaceResolutionError extends Error {
  constructor(
    readonly reason: SurfaceResolutionReason,
    message: string,
  ) {
    super(message);
    this.name = "SurfaceResolutionError";
  }
}

/**
 * One item inside a resolved repeating-group slot — see `types.ts`'s
 * `SurfaceRepeatingSlotBinding`. Exactly one of `value`/`node`/`assetId`
 * is set, mirroring whichever source the authored item carried (`copy`
 * resolves to `value`, the same substitution `SurfaceSlotBinding.copy`
 * gets in `document.bindings`). `index` is the item's ordinal position
 * within the group, in authored order — the addressing key a renderer
 * keys off, so "item 3 of 6" is always answerable without re-deriving a
 * position from array order alone.
 */
export interface ResolvedSurfaceGroupItem {
  index: number;
  value?: string;
  node?: object;
  assetId?: string;
}

/**
 * A resolved repeating-group slot: the group's `slot` key, paired with
 * every one of its items resolved in order. See
 * `ResolvedSurfaceDocument.groups`.
 */
export interface ResolvedSurfaceGroup {
  slot: string;
  items: ResolvedSurfaceGroupItem[];
}

/**
 * One resolved single-binding `node` slot — the non-repeating counterpart
 * to a repeating group's per-item `node`. See `ResolvedSurfaceDocument.nodes`
 * and `resolveSurfaceDocument`'s own `nodeSlots` option for how a binding
 * ends up here instead of throwing `unsupported-node`.
 */
export interface ResolvedSurfaceNode {
  slot: string;
  node: object;
}

/**
 * Slot keys a caller has declared safe to carry a caller-owned `node`
 * value on a SINGLE (non-repeating) binding — the opt-in that turns
 * `resolveSurfaceDocument`'s formerly-unconditional `unsupported-node`
 * refusal into a per-slot check. `core` has no concept of a "template" or
 * a "slot kind" of its own — those are `@vespeneventures/publisher/web`
 * concepts (`WebTemplate.slotKinds`, `defineWebTemplate`). This option is
 * deliberately the narrowest possible seam between the two: a plain set of
 * slot keys, supplied by whatever caller already knows which of its own
 * template's slots accept a rich node — `web`'s `createWebRenderer`-built
 * renderers derive this set from a template's own `slotKinds` declaration
 * (see `web/internal/webTemplates.ts`'s `nodeSlotKeys`) and hand it to this
 * function before ever calling a `web` renderer. A caller who never
 * supplies `nodeSlots` (or supplies an empty one) gets EXACTLY today's
 * behavior: every single-binding `node` refuses, unconditionally — this
 * option is additive, never a relaxation by default.
 */
export interface ResolveSurfaceDocumentOptions {
  nodeSlots?: Iterable<string>;
}

export interface ResolvedSurfaceDocument {
  /**
   * Compatibility input for the existing deterministic channel renderers.
   * A `SurfaceRepeatingSlotBinding` is never lowered into this shape —
   * `ComposeDocument`'s `SlotBinding` has no way to carry more than one
   * source per slot — and neither is a single binding's `node` source,
   * for the identical reason: `SlotBinding` has no field that could carry
   * it at all. Forcing an approximation in here (stringifying it, dropping
   * it silently) would misrepresent real structure as text or discard it.
   * See `groups`/`nodes` below for where that resolved content actually
   * lives instead.
   */
  document: ComposeDocument;
  /**
   * Every CopyRegistry resolution used to create `document` AND `groups`,
   * for provenance — see `output-manifest.ts`'s `collectCopyProvenance`,
   * which reads this field per resolved copy entry regardless of whether
   * it came from a single binding or one item of a repeating group. This
   * is what lets provenance collection extend to repeating groups for
   * free: it was already structural over every `CopyResolution` produced,
   * never keyed by which binding shape produced it. `nodes` (below)
   * contributes nothing here — a `node` binding is never resolved through
   * `CopyRef`/`CopyResolver` at all, so there is no `CopyResolution` to
   * collect for it; see `nodes`'s own doc comment.
   */
  resolutions: CopyResolution[];
  /**
   * Resolved repeating-group slots, in the order their bindings were
   * authored. Omitted entirely — not an empty array — when `surface.bindings`
   * contains no `SurfaceRepeatingSlotBinding`, so an existing
   * single-binding-only `SurfaceDocument` produces a byte-identical
   * `ResolvedSurfaceDocument` before and after this field existed.
   */
  groups?: ResolvedSurfaceGroup[];
  /**
   * Resolved single-binding `node` slots — every `SurfaceSlotBinding` whose
   * source was `node` AND whose `slot` appeared in `options.nodeSlots` (see
   * `resolveSurfaceDocument`'s own doc comment). Omitted entirely — not an
   * empty array, the identical convention `groups` already uses — when no
   * such binding was authored, so a document with no `node` binding (or
   * one authored before `nodeSlots` existed) resolves byte-identically to
   * before this field existed. A `node` binding never contributes a
   * `CopyResolution` to `resolutions` — it carries a caller-owned rich
   * value, never audience-facing copy resolved through a registry — so a
   * manifest reviewer reading `resolutions`/`collectCopyProvenance` should
   * expect no entry for a slot listed here; that absence is the intended
   * behavior, not a gap in provenance collection.
   */
  nodes?: ResolvedSurfaceNode[];
}

/**
 * Resolves a canonical `SurfaceDocument` through a real `CopyResolver`.
 * It fails closed: invalid references, missing/draft/unapproved registry
 * entries, and an unauthorized caller-owned `node` binding (on a single
 * binding — see `groups` for the repeating case, which has no such
 * restriction) all refuse rather than being replaced with literals or
 * silently omitted.
 *
 * A single binding's `node` is refused with `SurfaceResolutionError
 * ("unsupported-node", ...)` UNLESS its `slot` appears in
 * `options.nodeSlots` — see that option's own doc comment for why this is
 * a caller-supplied allowlist rather than this function inferring
 * anything about templates on its own. When allowed, the resolved `{ slot,
 * node }` pair is collected into `nodes` (see `ResolvedSurfaceDocument.
 * nodes`) instead of being lowered into `document.bindings` — `SlotBinding`
 * has no field that could carry a `node` value at all, the same reason a
 * repeating group's items never lower into `document.bindings` either.
 *
 * PARTIAL-ITEM-FAILURE, DELIBERATELY FAIL-THE-WHOLE-DOCUMENT: a bad item
 * inside a `SurfaceRepeatingSlotBinding` — an unresolved `CopyRef`, same
 * as any single binding's — aborts this entire call by throwing
 * `SurfaceResolutionError`, exactly like a bad single binding already
 * does. This function has never returned a partial `ResolvedSurfaceDocument`
 * for any other failure mode (see `unresolved-copy` and `unsupported-node`
 * above), so a repeating group's items are made to fail the same way
 * rather than inventing a second, more lenient failure mode that only
 * applies to array-shaped content — one caller-visible contract, not two.
 * The thrown message names the specific item (`bindings.N.items.M`, not
 * just `bindings.N`), so a caller can tell which of six capability-grid
 * entries broke without re-deriving it from a stack trace.
 */
export function resolveSurfaceDocument(surface: SurfaceDocument, resolver: CopyResolver, options: ResolveSurfaceDocumentOptions = {}): ResolvedSurfaceDocument {
  const findings = validateSurfaceDocument(surface);
  if (findings.some((finding) => finding.severity === "error")) {
    throw new SurfaceResolutionError("invalid-surface", `resolveSurfaceDocument refused invalid surface "${surface.id}": ${findings.map((finding) => finding.message).join("; ")}`);
  }
  if (typeof resolver !== "function") {
    throw new SurfaceResolutionError("unresolved-copy", `resolveSurfaceDocument needs a CopyResolver for surface "${surface.id}".`);
  }

  const nodeSlots = new Set(options.nodeSlots ?? []);

  const resolutions: CopyResolution[] = [];
  const text = (ref: CopyRef, path: string): string => {
    const resolution = resolver(ref);
    if (resolution === undefined || typeof resolution.text !== "string" || resolution.text.trim().length === 0) {
      throw new SurfaceResolutionError("unresolved-copy", `resolveSurfaceDocument could not resolve CopyRef "${ref.id}" at ${path} for surface "${surface.id}".`);
    }
    resolutions.push(resolution);
    return resolution.text;
  };

  const groups: ResolvedSurfaceGroup[] = [];
  const nodes: ResolvedSurfaceNode[] = [];

  const bindings = surface.bindings.flatMap((binding, index): SlotBinding[] => {
    if (isSurfaceRepeatingSlotBinding(binding)) {
      groups.push(resolveRepeatingBinding(binding, index, text));
      return [];
    }
    if (binding.copy !== undefined) return [{ slot: binding.slot, value: text(binding.copy, `bindings.${index}.copy`) }];
    if (binding.assetId !== undefined) return [{ slot: binding.slot, assetId: binding.assetId }];
    // binding.node !== undefined here — validateSurfaceDocument's
    // surface-binding-source-exclusive rule already guarantees exactly one
    // of copy/node/assetId reached this point.
    if (!nodeSlots.has(binding.slot)) {
      throw new SurfaceResolutionError(
        "unsupported-node",
        `resolveSurfaceDocument cannot lower caller-owned node binding at bindings.${index} (slot "${binding.slot}"); pass { nodeSlots: [...] } naming this slot (see a template's own node-kind slots, e.g. @vespeneventures/publisher/web's defineWebTemplate/WebTemplate.slotKinds), or render that web node through a direct surface-web composition.`,
      );
    }
    nodes.push({ slot: binding.slot, node: binding.node as object });
    return [];
  });

  const meta = resolveMeta(surface.meta, text);
  return {
    document: { id: surface.id, channel: surface.channel, meta, template: surface.template, bindings, ...(surface.layout === undefined ? {} : { layout: surface.layout }) },
    resolutions,
    ...(groups.length > 0 ? { groups } : {}),
    ...(nodes.length > 0 ? { nodes } : {}),
  };
}

/** Resolves every item in one `SurfaceRepeatingSlotBinding`, in authored order. See this file's own doc comment, "partial-item-failure", for why one bad item aborts the whole call rather than returning a partial group. */
function resolveRepeatingBinding(binding: SurfaceRepeatingSlotBinding, bindingIndex: number, text: (ref: CopyRef, path: string) => string): ResolvedSurfaceGroup {
  const items = binding.items.map((item, itemIndex) => resolveRepeatingBindingItem(item, bindingIndex, itemIndex, text));
  return { slot: binding.slot, items };
}

function resolveRepeatingBindingItem(item: SurfaceSlotBindingItem, bindingIndex: number, itemIndex: number, text: (ref: CopyRef, path: string) => string): ResolvedSurfaceGroupItem {
  const path = `bindings.${bindingIndex}.items.${itemIndex}`;
  if (item.copy !== undefined) return { index: itemIndex, value: text(item.copy, `${path}.copy`) };
  if (item.node !== undefined) return { index: itemIndex, node: item.node };
  if (item.assetId !== undefined) return { index: itemIndex, assetId: item.assetId };
  // Unreachable once validateSurfaceDocument has passed: every item that
  // reaches here already satisfies surface-binding-group-item-source-exclusive.
  // Kept as an explicit, attributed throw rather than a silent fallthrough —
  // this repo's own rule that a guard must state where control goes when it
  // declines applies here too.
  throw new SurfaceResolutionError("invalid-surface", `resolveSurfaceDocument found an item with no source at ${path}, which validateSurfaceDocument should already have rejected.`);
}

function resolveMeta(meta: SurfaceChannelMeta, text: (ref: CopyRef, path: string) => string): ComposeDocument["meta"] {
  switch (meta.channel) {
    case "web":
      return {
        channel: "web",
        title: text(meta.title, "meta.title"),
        description: text(meta.description, "meta.description"),
        ...(meta.canonical === undefined ? {} : { canonical: meta.canonical }),
        ...(meta.robots === undefined ? {} : { robots: meta.robots }),
        ...(meta.keywords === undefined ? {} : { keywords: meta.keywords.map((ref, index) => text(ref, `meta.keywords.${index}`)) }),
        ...(meta.og === undefined
          ? {}
          : {
              og: {
                ...(meta.og.title === undefined ? {} : { title: text(meta.og.title, "meta.og.title") }),
                ...(meta.og.description === undefined ? {} : { description: text(meta.og.description, "meta.og.description") }),
                ...(meta.og.image === undefined ? {} : { image: meta.og.image }),
                ...(meta.og.type === undefined ? {} : { type: meta.og.type }),
              },
            }),
        ...(meta.twitter === undefined ? {} : { twitter: { ...meta.twitter } }),
        ...(meta.jsonLd === undefined ? {} : { jsonLd: meta.jsonLd }),
      };
    case "email":
      return { channel: "email", subject: text(meta.subject, "meta.subject"), preheader: text(meta.preheader, "meta.preheader"), ...(meta.replyTo === undefined ? {} : { replyTo: meta.replyTo }), ...(meta.listUnsubscribe === undefined ? {} : { listUnsubscribe: meta.listUnsubscribe }) };
    case "image":
      return { channel: "image", width: meta.width, height: meta.height, format: meta.format, ...(meta.scale === undefined ? {} : { scale: meta.scale }), alt: text(meta.alt, "meta.alt") };
    case "slides":
      return { channel: "slides", aspect: meta.aspect, ...(meta.notes === undefined ? {} : { notes: Object.fromEntries(Object.entries(meta.notes).map(([key, ref]) => [key, text(ref, `meta.notes.${key}`)])) }) };
    case "print":
      return meta;
  }
}
