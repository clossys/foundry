import type { CopyRef, CopyResolution, CopyResolver } from "@vespeneventures/copy";
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

export interface ResolvedSurfaceDocument {
  /**
   * Compatibility input for the existing deterministic channel renderers.
   * A `SurfaceRepeatingSlotBinding` is never lowered into this shape —
   * `ComposeDocument`'s `SlotBinding` has no way to carry more than one
   * source per slot, and forcing an approximation in here (first item
   * only, items joined into one string, ...) would silently discard real
   * structure. See `groups` below for where a repeating slot's resolved
   * content actually lives.
   */
  document: ComposeDocument;
  /**
   * Every CopyRegistry resolution used to create `document` AND `groups`,
   * for provenance — see `output-manifest.ts`'s `collectCopyProvenance`,
   * which reads this field per resolved copy entry regardless of whether
   * it came from a single binding or one item of a repeating group. This
   * is what lets provenance collection extend to repeating groups for
   * free: it was already structural over every `CopyResolution` produced,
   * never keyed by which binding shape produced it.
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
}

/**
 * Resolves a canonical `SurfaceDocument` through a real `CopyResolver`.
 * It fails closed: invalid references, missing/draft/unapproved registry
 * entries, and caller-owned `node` bindings (on a single binding — see
 * `groups` for the repeating case) all refuse rather than being replaced
 * with literals or silently omitted. `node` remains on the authored
 * contract for a future direct web composition path; a single binding's
 * `node` cannot be truthfully represented by the legacy string renderer
 * input, so it is refused here exactly as before.
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
export function resolveSurfaceDocument(surface: SurfaceDocument, resolver: CopyResolver): ResolvedSurfaceDocument {
  const findings = validateSurfaceDocument(surface);
  if (findings.some((finding) => finding.severity === "error")) {
    throw new SurfaceResolutionError("invalid-surface", `resolveSurfaceDocument refused invalid surface "${surface.id}": ${findings.map((finding) => finding.message).join("; ")}`);
  }
  if (typeof resolver !== "function") {
    throw new SurfaceResolutionError("unresolved-copy", `resolveSurfaceDocument needs a CopyResolver for surface "${surface.id}".`);
  }

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

  const bindings = surface.bindings.flatMap((binding, index): SlotBinding[] => {
    if (isSurfaceRepeatingSlotBinding(binding)) {
      groups.push(resolveRepeatingBinding(binding, index, text));
      return [];
    }
    if (binding.copy !== undefined) return [{ slot: binding.slot, value: text(binding.copy, `bindings.${index}.copy`) }];
    if (binding.assetId !== undefined) return [{ slot: binding.slot, assetId: binding.assetId }];
    throw new SurfaceResolutionError("unsupported-node", `resolveSurfaceDocument cannot lower caller-owned node binding at bindings.${index}; render that web node through a direct surface-web composition.`);
  });

  const meta = resolveMeta(surface.meta, text);
  return {
    document: { id: surface.id, channel: surface.channel, meta, template: surface.template, bindings, ...(surface.layout === undefined ? {} : { layout: surface.layout }) },
    resolutions,
    ...(groups.length > 0 ? { groups } : {}),
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
