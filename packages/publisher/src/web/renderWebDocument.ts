/**
 * `renderWebDocument` — this package's whole job for the `web` channel.
 * Takes a `ComposeDocument` with `channel: "web"` and emits the two things
 * a web page built from it needs:
 *
 *   1. THE RENDERED VIEW (`element`) — `doc.template` names a
 *      `@clossys/designer` view (`AuthView`, `ErrorView`); `doc.bindings`
 *      are resolved into that view's own slots via `@clossys/
 *      compose`'s `resolveDocument`, using this package's own
 *      `internal/webTemplates.ts` registry as the "real slot list" every
 *      web/email document needs supplied from outside `surface/core` — see
 *      `surface/core`'s `resolve.ts` doc comment.
 *   2. THE HEAD METADATA (`head`) — `doc.meta` (a `WebMeta`), reshaped into
 *      this package's own framework-agnostic `WebHeadMetadata` by
 *      `headMetadata.ts`.
 *
 * ONLY PLAIN TEXT OR A RESOLVED ASSET EVER FILLS A SLOT THROUGH `doc.bindings`
 * -------------------------------------------------------------------------------
 * `SlotBinding` (`doc.bindings`, the legacy `ComposeDocument` shape this
 * function actually reads) carries exactly two possible sources — `copyId`/
 * `value` (resolved to plain text) or `assetId` (resolved to a real
 * `<img>`) — never a React node, a component, or markup (see `surface/core`'s
 * own `types.ts`). This is not a shortcut this package took; it's what the
 * frozen `ComposeDocument` contract itself supports, and it is why a
 * caller-owned `node` binding could never be lowered into `doc.bindings`
 * by `resolveSurfaceDocument` in the first place (see `core/resolve-
 * surface.ts`). A rich node reaches a slot through exactly one sanctioned
 * path instead: `options.nodes`, gated per slot by the target template's
 * own declared `WebTemplate.slotKinds` — see "RICH-NODE SLOTS" below. A
 * slot no template declares `"node"`-kind still only ever fills from
 * `doc.bindings`'s plain text/asset, the same as before this option
 * existed; a consumer with a genuinely bespoke composition need — one
 * that isn't a named, registered `WebTemplate` slot at all — still
 * composes `@clossys/designer`'s views directly, outside this document
 * pipeline entirely, the same "this package's job ends where a richer
 * composition begins" boundary `surface/core`'s own README draws for
 * `template` and `copyId`.
 *
 * WHAT COUNTS AS "RESOLVED NOTHING" — AND WHY THAT'S A THROW, NOT AN EMPTY PAGE
 * --------------------------------------------------------------------------
 * `resolveDocument`'s own `ok` flag already refuses to report a clean pass
 * on an empty `bindings` list, an unknown-template's empty layout, or a
 * document whose bindings matched zero real slots — see its doc comment,
 * "THE BAR THIS FILE IS BUILT AGAINST". This function goes one step
 * further, because `resolveDocument`'s `ok: true` only proves a
 * *binding* matched a *slot key* — it says nothing about whether that
 * binding's `copyId` actually resolved to real text. A document whose
 * every required slot is bound via a `copyId` the caller's
 * `resolveCopyId` cannot resolve is `ok: true` by `resolveDocument`'s own
 * rule and would otherwise render a page missing its own heading, its own
 * status code, or (for `AuthView`) its whole form — a silent empty page
 * wearing a "successfully resolved" badge. So after `resolveDocument`
 * succeeds, this function additionally requires every REQUIRED slot to
 * have resolved to non-empty content, and throws `RenderError("empty-output",
 * ...)` if even one didn't. This is a deliberate strengthening beyond what
 * `resolveDocument` itself checks, flagged here the same way `surface/core`'s
 * own README flags its `frame-out-of-bounds` strengthening — not a change
 * to any contract shape, a stricter reading of what "resolved" has to mean
 * for a render to actually be safe to ship.
 *
 * IMAGES: A SLOT CAN NOW RESOLVE TO A REAL `<img>` (OR `<picture>`), NOT
 * JUST STYLED TEXT
 * -------------------------------------------------------------------------
 * `SlotBinding.assetId` (`@clossys/publisher/core` 0.3.0) is this
 * package's second content source, alongside `copyId`/`value` — see
 * `../internal/assets.ts` for the shared resolution/validation machinery
 * every channel uses. A slot bound via `assetId` never falls through to
 * `resolveBindingText` (which only ever reads `copyId`/`value` — an
 * `assetId`-only binding has neither); instead its resolved,
 * shape-validated `RenderAsset` becomes a real element, filling
 * `content[key]` exactly like a resolved string does —
 * `WebTemplate.build`'s `Record<string, ReactNode>` parameter already
 * accepts either, no template registry change required.
 *
 * RESPONSIVE IMAGES (issue #177) — `ImageAssetEntry.sources` -> `<picture>`
 * -------------------------------------------------------------------------
 * A resolved `RenderImageAsset` with no `sources` (or an empty one) renders
 * the identical single `<img src alt width height>` this function has
 * always produced — a purely additive change with zero behavior difference
 * for every existing caller. A `RenderImageAsset` WITH `sources` renders a
 * `<picture>` instead: `sources` is grouped by `format` (entries sharing no
 * `format`, or the same `format`, become one `<source srcset="src1 w1w,
 * src2 w2w, ..." type="...">` — the standard resolution-descriptor `srcset`
 * shape), in first-occurrence order, followed by a trailing fallback
 * `<img>` built from the asset's own primary `src`/`width`/`height`/`alt`
 * — the same element a browser that supports none of the declared
 * `<source>` types falls back to. See {@link buildResponsiveImageElement}.
 *
 * VIDEO (issue #177) — `VideoAssetEntry` -> `<video>`, ONLY ON `./web`
 * -------------------------------------------------------------------------
 * A resolved `RenderVideoAsset` renders a real `<video controls>` with one
 * `<source src type>` per `sources` entry and one `<track kind="captions">`
 * per `captions` entry — see {@link buildVideoElement}. `./web` is the ONLY
 * channel in this package with real video playback support; the other
 * four (`./email`, `./print`, `./image`, `./slides`) each reduce a video
 * entry to its `poster` image instead — see `../internal/assets.ts`'s
 * `toStaticRenderAsset` and each channel's own doc comment for why, and the
 * package README, "Video — an explicit non-goal for four channels," for
 * the full per-channel table.
 *
 * REDUCED MOTION IS A RENDERING-TIME DECISION, NOT A BUILD-TIME ONE
 * -------------------------------------------------------------------------
 * `VideoAssetEntry.reducedMotion` (`@clossys/publisher/media`) is
 * required, not a styling suggestion — but THIS package has no `window`/DOM
 * access at the point `renderWebDocument` runs (it may run on a server, in
 * a build step, or in a browser — see this file's own React-peer-version
 * comment for the identical reasoning applied to `react.version`). So it
 * cannot itself call `window.matchMedia("(prefers-reduced-motion:
 * reduce)")` — the actual live check has to happen wherever a `window`
 * genuinely exists, which is the CALLER's responsibility, exactly the same
 * "opaque seam, explicit input" pattern `resolveCopyId`/`resolveAssetId`
 * already use for every other environment-dependent decision this function
 * cannot make on its own. `RenderWebOptions.prefersReducedMotion` IS that
 * seam: a caller passes `true` when it already knows reduced motion is
 * active (a `Sec-CH-Prefers-Reduced-Motion` client hint on the server, or a
 * direct `matchMedia` read on the client) and this function's own video
 * rendering applies the entry's declared `reducedMotion` behavior against
 * that ONE boolean, deterministically:
 *
 *   - Omitted (or `false`) — every video's own `autoplay` is honoured
 *     exactly as authored. This is the regression-safe default: a caller
 *     that has not wired up reduced-motion detection at all gets the same
 *     behavior it would have gotten before this option existed.
 *   - `true` and `reducedMotion` is `"pause"` or `"no-autoplay"` — the
 *     entry's own `autoplay` is force-suppressed; every other attribute
 *     (`loop`/`muted`/`poster`/sources/captions) renders unchanged, so a
 *     viewer can still press play themselves.
 *   - `true` and `reducedMotion` is `"static-poster"` — NO `<video>`
 *     element is emitted at all; a static `<img>` built from the entry's
 *     own (schema-required, for this value) `poster` renders instead —
 *     see `@clossys/publisher/media`'s
 *     `"video-static-poster-requires-poster"` schema rule.
 *
 * This is a real, testable contract — `renderWebDocument.test.ts` exercises
 * it with an actual `window.matchMedia("(prefers-reduced-motion: reduce)")`
 * read (via jsdom) feeding `prefersReducedMotion`, then asserts against the
 * real rendered HTML (`renderToStaticMarkup`) that an `autoplay: true`
 * entry never actually carries the `autoplay` attribute when reduced
 * motion is active — never a documentation-only promise.
 *
 * ASSETS GET A STRICTER BAR THAN OPTIONAL TEXT
 * -------------------------------------------------
 * An unresolved OPTIONAL `copyId`/`value` binding silently drops (see
 * above) — this channel's own long-standing, deliberate leniency. An
 * `assetId` binding that fails to resolve into a real, paintable asset
 * (unresolved, wrong-shaped, or a broken lookup) does NOT get that same
 * leniency, REQUIRED or not: this function throws `RenderError
 * ("empty-output", ...)` the moment `../internal/assets.ts`'s
 * `hasAssetProblems` is true for ANY bound asset slot. "An unresolved asset
 * id must never render a blank box or a placeholder" (this package's own
 * task brief) — silently omitting a broken image slot the way an optional
 * caption silently omits is exactly that: a page that LOOKS complete but
 * is quietly missing content nobody asked to have dropped.
 *
 * RICH-NODE SLOTS: `options.nodes`, GATED PER SLOT BY `WebTemplate.slotKinds`
 * -----------------------------------------------------------------------------
 * A slot a template declares `"node"`-kind (see `WebSlotContentKind`,
 * `../types.ts`) may additionally resolve from `options.nodes` — the
 * render-time counterpart to `ResolvedSurfaceDocument.nodes`, mirroring
 * how `options.groups` is the counterpart to `ResolvedSurfaceDocument.
 * groups`. This is NOT a general escape hatch: a `"node"`-kind slot
 * accepts a real `ReactNode` the CALLER'S OWN trusted code constructed —
 * never a raw HTML string, never `dangerouslySetInnerHTML`, and never
 * audience-supplied or copy-registry-resolved content. React's own
 * child-rendering already escapes text/attribute values by default; a
 * node slot's safety rests entirely on staying inside that path. Every
 * entry in `options.nodes` is checked against the target template's own
 * declared `slotKinds` before it ever reaches `content` — a node for an
 * unknown slot, a node for a slot not declared `"node"`-kind, or a node
 * colliding with a slot a copy/asset binding already filled, are each a
 * `RenderError("resolution-failed", ...)`, never silently coerced,
 * dropped, or overwritten. Symmetrically, a `copy`/`assetId` binding
 * (via `doc.bindings`) targeting a slot whose declared kinds do not
 * include `"copy"`/`"asset"` is refused the same way, before it can reach
 * `content` either.
 */

import { resolveDocument } from "../core/index.js";
import type { ComposeDocument, ResolvedSurfaceGroup, ResolvedSurfaceGroupField, ResolvedSurfaceGroupItem, WebMeta } from "../core/index.js";
import type { ReactNode } from "react";
import { createElement, version as reactVersion } from "react";
import { RenderError } from "../internal/errors.js";
import { describeAssetProblems, hasAssetProblems, isRenderAsset, resolveDocumentAssets } from "../internal/assets.js";
import type { RenderAsset, RenderImageAsset, RenderImageSource, RenderVideoAsset } from "../internal/assets.js";
import { assertPeerVersion } from "../internal/peer-version.js";
import { buildWebHeadMetadata } from "./headMetadata.js";
import { defaultWebTemplateMap, slotKindsFor } from "./internal/webTemplates.js";
import type { RepeatingWebSlotFieldSpec, RepeatingWebSlotSpec, ResolvedWebGroupField, ResolvedWebGroupItem, WebTemplate } from "./types.js";
import type { RenderWebOptions, RenderWebResult } from "./types.js";

/**
 * `react` is this subpath's optional peer (see package.json's
 * `peerDependenciesMeta`) — optional so a consumer can install
 * `@clossys/publisher` and use `./core`, `./media`, `./email`,
 * `./print`, `./image`, or `./slides` without ever installing React; only
 * `./web` (this file, and `./internal/webTemplates.js`, which it already
 * imports and which transitively covers that file's own `react` usage
 * too) needs it. An ABSENT or OUT-OF-RANGE `react` previously produced no
 * signal until `createElement` itself crashed somewhere below, with
 * nothing naming a version range as the cause. Read via `react`'s own
 * exported `version` — not this package's `resolveInstalledPeerVersion`
 * fs-based resolver — because this module is reachable from a browser
 * bundle as easily as from a server one; `React.version` is a plain value
 * export that works in every environment, while `resolveInstalledPeerVersion`
 * assumes `node:module`/`node:fs`, which a browser bundle either can't
 * resolve or shouldn't need to.
 *
 * (`react-dom` is this subpath's OTHER declared optional peer, but no file
 * in this package ever imports it directly — only the consumer's own
 * `react-dom/server` or client render call does, downstream of the
 * `ReactNode` this function returns — so there is no adapter import site
 * in this package to guard for it. `REACT_DECLARED_RANGE` must match
 * package.json's `peerDependencies.react` exactly — `renderWebDocument.
 * test.ts` asserts that directly.)
 */
export const REACT_DECLARED_RANGE = ">=18";
assertPeerVersion({ peer: "react", declaredRange: REACT_DECLARED_RANGE, foundVersion: reactVersion });

function resolveBindingText(
  binding: { copyId?: string; value?: string },
  resolveCopyId: RenderWebOptions["resolveCopyId"],
): string | undefined {
  if (binding.value !== undefined) return binding.value;
  if (binding.copyId !== undefined) return resolveCopyId?.(binding.copyId);
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// buildAssetElement — the one place a resolved RenderAsset becomes a real
// element, shared by the single-binding content loop and the repeating-
// group loop below. See this file's own top comment, "Responsive images"
// / "Video" / "Reduced motion is a rendering-time decision," for the full
// contract.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Groups `sources` by `format` (entries sharing no `format`, or the same
 * `format`, become one group), preserving first-occurrence order — the
 * shape one `<source srcset="..." type="...">` needs per distinct format.
 */
function groupImageSourcesByFormat(sources: readonly RenderImageSource[]): Array<{ format: string | undefined; entries: RenderImageSource[] }> {
  const groups: Array<{ format: string | undefined; entries: RenderImageSource[] }> = [];
  const indexByFormat = new Map<string | undefined, number>();
  for (const source of sources) {
    let index = indexByFormat.get(source.format);
    if (index === undefined) {
      index = groups.length;
      indexByFormat.set(source.format, index);
      groups.push({ format: source.format, entries: [] });
    }
    groups[index]!.entries.push(source);
  }
  return groups;
}

/**
 * A `RenderImageAsset` with no `sources` (or an empty one) renders the
 * identical single `<img>` this function has always produced — see this
 * file's own top comment, "Responsive images," for the full `<picture>`
 * contract when `sources` IS present.
 */
function buildResponsiveImageElement(asset: RenderImageAsset): ReactNode {
  const sources = asset.sources ?? [];
  const fallbackImg = createElement("img", { src: asset.src, alt: asset.alt, width: asset.width, height: asset.height });
  if (sources.length === 0) return fallbackImg;

  const sourceElements = groupImageSourcesByFormat(sources).map((group, i) =>
    createElement("source", {
      key: `source-${i}`,
      srcSet: group.entries.map((entry) => `${entry.src} ${entry.width}w`).join(", "),
      ...(group.format !== undefined ? { type: group.format } : {}),
    }),
  );
  return createElement("picture", {}, ...sourceElements, fallbackImg);
}

/**
 * See this file's own top comment, "Video" / "Reduced motion is a
 * rendering-time decision, not a build-time one," for the full contract —
 * this function is where that contract is actually applied.
 * `prefersReducedMotion` is `RenderWebOptions.prefersReducedMotion`,
 * threaded straight through from the caller; `undefined`/`false` means
 * "not reduced," the regression-safe default.
 */
function buildVideoElement(asset: RenderVideoAsset, prefersReducedMotion: boolean | undefined): ReactNode {
  const reducedMotionActive = prefersReducedMotion === true;

  if (reducedMotionActive && asset.reducedMotion === "static-poster") {
    // `isRenderVideoAsset` already refuses a "static-poster" entry with no
    // `poster` — see internal/assets.ts — so `asset.poster` is guaranteed
    // present here.
    return createElement("img", { src: asset.poster as string, alt: asset.alt, width: asset.width, height: asset.height });
  }

  const autoplaySuppressed = reducedMotionActive && (asset.reducedMotion === "pause" || asset.reducedMotion === "no-autoplay");
  const autoPlay = asset.autoplay === true && !autoplaySuppressed;

  const sourceElements = asset.sources.map((source, i) => createElement("source", { key: `source-${i}`, src: source.src, type: source.mimeType }));
  const trackElements = (asset.captions ?? []).map((caption, i) =>
    createElement("track", { key: `track-${i}`, kind: "captions", src: caption.src, srcLang: caption.srclang, label: caption.label }),
  );

  return createElement(
    "video",
    {
      width: asset.width,
      height: asset.height,
      ...(asset.poster !== undefined ? { poster: asset.poster } : {}),
      autoPlay,
      loop: asset.loop === true,
      muted: asset.muted === true,
      controls: true,
      "aria-label": asset.alt,
    },
    ...sourceElements,
    ...trackElements,
    asset.alt,
  );
}

/** Dispatches a resolved `RenderAsset` to {@link buildResponsiveImageElement} or {@link buildVideoElement} — the one place `renderWebDocument` decides what element a resolved asset binding becomes, shared by the single-binding `content` loop and `resolveGroupItemContent` below. */
function buildAssetElement(asset: RenderAsset, options: Pick<RenderWebOptions, "prefersReducedMotion">): ReactNode {
  return asset.type === "image" ? buildResponsiveImageElement(asset) : buildVideoElement(asset, options.prefersReducedMotion);
}

/**
 * Turns one already-resolved `ResolvedSurfaceGroupItem` into paintable
 * `ResolvedWebGroupItem` content — the repeating-group counterpart to this
 * file's own per-slot `content` loop, below. `value` (already resolved
 * text — a repeating item never carries a `copyId`, only `resolveSurface
 * Document`'s own already-resolved `value`; see `resolve-surface.ts`)
 * becomes `text`; `assetId` is resolved exactly the way a single binding's
 * `assetId` is (`../internal/assets.ts`'s `isRenderAsset`), with the
 * identical stricter-than-text bar — ANY problem is fatal, never a silent
 * omission (see this file's own top comment, "Assets get a stricter bar
 * than optional text") — and painted via the identical
 * {@link buildAssetElement} the single-binding loop uses, so a repeating
 * slot's image/video item gets the same `<picture>`/`<video>` treatment a
 * single-binding slot does; `node` is passed through untouched, the same
 * "rendered exactly as given" treatment `AuthView.form` gets.
 */
function resolveGroupItemContent(slotKey: string, item: ResolvedSurfaceGroupItem, options: RenderWebOptions): ResolvedWebGroupItem {
  if (item.fields !== undefined) {
    return {
      index: item.index,
      fields: Object.fromEntries(Object.entries(item.fields).map(([field, binding]) => [field, resolveGroupFieldContent(slotKey, item.index, field, binding, options)])),
    };
  }
  if (item.value !== undefined) {
    return { index: item.index, text: item.value };
  }
  if (item.assetId !== undefined) {
    let looked: unknown;
    try {
      looked = options.resolveAssetId?.(item.assetId);
    } catch {
      looked = undefined;
    }
    if (!isRenderAsset(looked)) {
      throw new RenderError(
        "empty-output",
        `renderWebDocument could not resolve repeating slot "${slotKey}" item ${item.index}'s assetId "${item.assetId}" into a real asset (missing options.resolveAssetId, an unresolved id, or a value that did not match the required RenderImageAsset or RenderVideoAsset shape). Rendering would silently ship a page with a broken or missing image, which this function refuses to do.`,
      );
    }
    return { index: item.index, element: buildAssetElement(looked, options) };
  }
  if (item.node !== undefined) {
    return { index: item.index, node: item.node };
  }
  // Unreachable once resolveSurfaceDocument has produced `item` —
  // resolveRepeatingBindingItem already guarantees exactly one of
  // value/node/assetId. Kept as an explicit, attributed throw rather than
  // a silent fallthrough, per this repo's own "a guard must state where
  // control goes when it declines" rule.
  throw new RenderError(
    "empty-output",
    `renderWebDocument found repeating slot "${slotKey}" item ${item.index} with no resolved content (none of value/assetId/node was set), which resolveSurfaceDocument should never produce.`,
  );
}

/** Resolves one named structured field through the same copy/asset rules as a single-value group item. */
function resolveGroupFieldContent(
  slotKey: string,
  itemIndex: number,
  field: string,
  binding: ResolvedSurfaceGroupField,
  options: RenderWebOptions,
): ResolvedWebGroupField {
  if (binding.value !== undefined) return { text: binding.value };
  if (binding.assetId !== undefined) {
    let looked: unknown;
    try {
      looked = options.resolveAssetId?.(binding.assetId);
    } catch {
      looked = undefined;
    }
    if (!isRenderAsset(looked)) {
      throw new RenderError(
        "empty-output",
        `renderWebDocument could not resolve repeating slot "${slotKey}" item ${itemIndex} field "${field}" assetId "${binding.assetId}" into a real asset (missing options.resolveAssetId, an unresolved id, or a value that did not match the required RenderImageAsset or RenderVideoAsset shape). Rendering would silently ship incomplete structured content, which this function refuses to do.`,
      );
    }
    return { element: buildAssetElement(looked, options) };
  }
  throw new RenderError(
    "empty-output",
    `renderWebDocument found repeating slot "${slotKey}" item ${itemIndex} field "${field}" with no resolved copy or asset content, which resolveSurfaceDocument should never produce.`,
  );
}

function isPlainClosedObject(value: unknown): value is Record<string, unknown> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch { return false; }
}

function isNonWhitespaceString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOnlyOwnKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  try {
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== "string" || !allowed.includes(key)) return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && descriptor.enumerable && "value" in descriptor;
    });
  } catch { return false; }
}

function hasOwn(value: Record<string, unknown>, key: string): boolean { return Object.hasOwn(value, key); }

function hasOnlyEnumerableStringDataKeys(value: Record<string, unknown>): boolean {
  try {
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && descriptor.enumerable && "value" in descriptor;
    });
  } catch { return false; }
}

function densePublicArray(value: unknown, path: string): value is unknown[] {
  if (!Array.isArray(value)) { invalidPublicGroups(`${path} must be an array.`); }
  for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) invalidPublicGroups(`${path}[${index}] must not be a sparse array hole.`);
  return true;
}

function invalidPublicGroups(message: string): never {
  throw new RenderError("resolution-failed", `renderWebDocument refused malformed RenderWebOptions.groups: ${message}`);
}

/**
 * `RenderWebOptions.groups` is public and may be supplied without first
 * calling `resolveSurfaceDocument`. Validate its whole closed wire shape
 * before template matching or resolution touches a nested property: malformed
 * direct input must throw a `RenderError`, never leak a raw TypeError or turn
 * an unrecognised object into editorial content.
 */
function validatePublicGroups(groups: unknown): ResolvedSurfaceGroup[] {
  if (groups === undefined) return [];
  if (!densePublicArray(groups, "groups")) return [];

  return groups.map((candidate, groupIndex) => {
    if (!isPlainClosedObject(candidate) || !hasOnlyOwnKeys(candidate, ["slot", "items"]) || !hasOwn(candidate, "slot") || !hasOwn(candidate, "items") || !isNonWhitespaceString(candidate.slot) || !densePublicArray(candidate.items, `groups[${groupIndex}].items`)) {
      invalidPublicGroups(`groups[${groupIndex}] must be a plain { slot, items } object with a non-whitespace slot and an items array.`);
    }

    const items = candidate.items.map((itemCandidate, itemIndex) => {
      if (!isPlainClosedObject(itemCandidate) || !hasOnlyOwnKeys(itemCandidate, ["index", "value", "node", "assetId", "fields"]) || !hasOwn(itemCandidate, "index")) {
        invalidPublicGroups(`groups[${groupIndex}].items[${itemIndex}] must be a plain item whose index is its sequential array position and has no unknown keys.`);
      }
      const resolvedIndex = itemCandidate.index;
      if (typeof resolvedIndex !== "number" || !Number.isInteger(resolvedIndex) || resolvedIndex !== itemIndex) invalidPublicGroups(`groups[${groupIndex}].items[${itemIndex}] must use its sequential array position as index.`);
      const sourceKeys = ["value", "node", "assetId", "fields"].filter((key) => itemCandidate[key] !== undefined);
      if (sourceKeys.length !== 1) {
        invalidPublicGroups(`groups[${groupIndex}].items[${itemIndex}] must set exactly one of value/node/assetId/fields.`);
      }
      if (itemCandidate.value !== undefined && !isNonWhitespaceString(itemCandidate.value)) {
        invalidPublicGroups(`groups[${groupIndex}].items[${itemIndex}].value must be a non-whitespace string when supplied.`);
      }
      if (itemCandidate.node !== undefined && (typeof itemCandidate.node !== "object" || itemCandidate.node === null)) {
        invalidPublicGroups(`groups[${groupIndex}].items[${itemIndex}].node must be a non-null object when supplied.`);
      }
      if (itemCandidate.assetId !== undefined && !isNonWhitespaceString(itemCandidate.assetId)) {
        invalidPublicGroups(`groups[${groupIndex}].items[${itemIndex}].assetId must be a non-whitespace string when supplied.`);
      }
      if (itemCandidate.fields !== undefined) {
        if (!isPlainClosedObject(itemCandidate.fields) || !hasOnlyEnumerableStringDataKeys(itemCandidate.fields) || Object.keys(itemCandidate.fields).length === 0) {
          invalidPublicGroups(`groups[${groupIndex}].items[${itemIndex}].fields must be a non-empty plain object.`);
        }
        for (const [field, binding] of Object.entries(itemCandidate.fields)) {
          if (!isNonWhitespaceString(field) || !isPlainClosedObject(binding) || !hasOnlyOwnKeys(binding, ["value", "assetId"])) {
            invalidPublicGroups(`groups[${groupIndex}].items[${itemIndex}].fields.${field || "(empty)"} must be a plain value/assetId binding with no unknown keys.`);
          }
          const fieldSources = [binding.value, binding.assetId].filter((source) => source !== undefined);
          if (fieldSources.length !== 1) {
            invalidPublicGroups(`groups[${groupIndex}].items[${itemIndex}].fields.${field} must set exactly one of value/assetId.`);
          }
          if (binding.value !== undefined && !isNonWhitespaceString(binding.value)) {
            invalidPublicGroups(`groups[${groupIndex}].items[${itemIndex}].fields.${field}.value must be a non-whitespace string when supplied.`);
          }
          if (binding.assetId !== undefined && !isNonWhitespaceString(binding.assetId)) {
            invalidPublicGroups(`groups[${groupIndex}].items[${itemIndex}].fields.${field}.assetId must be a non-whitespace string when supplied.`);
          }
        }
      }
      return itemCandidate as unknown as ResolvedSurfaceGroupItem;
    });
    return { slot: candidate.slot, items };
  });
}

function validateStructuredGroupItem(slotKey: string, item: ResolvedSurfaceGroupItem, fields: readonly RepeatingWebSlotFieldSpec[]): void {
  const sourceCount = [item.value, item.node, item.assetId, item.fields].filter((source) => source !== undefined).length;
  if (sourceCount !== 1 || item.fields === undefined || typeof item.fields !== "object" || Array.isArray(item.fields)) {
    throw new RenderError(
      "resolution-failed",
      `renderWebDocument could not use repeating slot "${slotKey}" item ${item.index}: this template requires exactly one named fields map, so a malformed or legacy copy/node/assetId item is not accepted.`,
    );
  }
  const itemFields = item.fields;
  const knownFields = new Set(fields.map((field) => field.key));
  const unknownFields = Object.keys(itemFields).filter((field) => !knownFields.has(field));
  if (unknownFields.length > 0) {
    throw new RenderError(
      "resolution-failed",
      `renderWebDocument could not use repeating slot "${slotKey}" item ${item.index}: unknown field(s) ${unknownFields.join(", ")}. Known field(s): ${fields.map((field) => field.key).join(", ")}.`,
    );
  }
  const missingRequired = fields.filter((field) => field.required === true && !Object.hasOwn(itemFields, field.key)).map((field) => field.key);
  if (missingRequired.length > 0) {
    throw new RenderError(
      "resolution-failed",
      `renderWebDocument could not use repeating slot "${slotKey}" item ${item.index}: missing required field(s) ${missingRequired.join(", ")}.`,
    );
  }
}

/**
 * Resolves every repeating slot `template` declares against
 * `options.groups`, fails closed on the two ways that can go wrong, and
 * returns the per-slot resolved item arrays `WebTemplate.build`'s second
 * parameter carries. See `internal/webTemplates.ts`'s own top comment,
 * "REPEATING SLOTS LIVE OUTSIDE `flow`", for why this is a wholly separate
 * pass from the single-binding `content` loop below rather than folded
 * into `resolveDocument`'s own resolution.
 *
 * Fails closed two ways, both `RenderError("resolution-failed", ...)` —
 * the same reason category `renderWebDocument` already uses for "a
 * required slot has no binding" / "a binding targets an unknown slot":
 *
 *   - a `options.groups` entry targets a slot `template.repeatingSlots`
 *     does not declare (the repeating-group analogue of an unknown
 *     `SlotBinding.slot`);
 *   - a `required: true` repeating slot has NO matching entry in
 *     `options.groups` at all (the analogue of a missing required slot).
 *
 * A required repeating slot whose group IS present but has zero items is
 * NOT a failure — see `types.ts`'s `SurfaceRepeatingSlotBinding` doc
 * comment ("empty is a deliberate, valid choice") and `WebTemplate`'s own
 * `repeatingSlots` doc comment for why this function only checks
 * presence, never length.
 */
function resolveTemplateGroups(doc: ComposeDocument, template: WebTemplate, options: RenderWebOptions): Record<string, ResolvedWebGroupItem[]> {
  const repeatingSlots: RepeatingWebSlotSpec[] = template.repeatingSlots ?? [];
  const repeatingKeys = new Set(repeatingSlots.map((spec) => spec.key));

  const groupsByKey = new Map<string, ResolvedSurfaceGroup>();
  for (const group of validatePublicGroups(options.groups)) {
    groupsByKey.set(group.slot, group); // last one for a given slot wins, matching this file's own documented bindings policy.
  }

  const unknownGroups = [...groupsByKey.keys()].filter((key) => !repeatingKeys.has(key));
  if (unknownGroups.length > 0) {
    throw new RenderError(
      "resolution-failed",
      `renderWebDocument received repeating group(s) for slot(s) [${unknownGroups.join(", ")}] against template "${doc.template}", which does not declare any of them as a repeating slot. Known repeating slot(s): ${repeatingSlots.map((spec) => spec.key).join(", ") || "(none)"}.`,
    );
  }

  const missingRequired = repeatingSlots.filter((spec) => spec.required === true && !groupsByKey.has(spec.key)).map((spec) => spec.key);
  if (missingRequired.length > 0) {
    throw new RenderError(
      "resolution-failed",
      `renderWebDocument could not resolve document "${doc.id}" against template "${doc.template}": missing required repeating slot(s): ${missingRequired.join(", ")}.`,
    );
  }

  const groupsContent: Record<string, ResolvedWebGroupItem[]> = {};
  for (const spec of repeatingSlots) {
    const group = groupsByKey.get(spec.key);
    if (group === undefined) continue; // optional and never authored for this document — the slot's own build function decides what "absent" means.
    groupsContent[spec.key] = group.items.map((item) => {
      if (spec.fields !== undefined) validateStructuredGroupItem(spec.key, item, spec.fields);
      else if (item.fields !== undefined) {
        throw new RenderError(
          "resolution-failed",
          `renderWebDocument received a structured fields item for repeating slot "${spec.key}", but template "${doc.template}" does not declare fields for that slot.`,
        );
      }
      return resolveGroupItemContent(spec.key, item, options);
    });
  }
  return groupsContent;
}

/**
 * The parameterized core `renderWebDocument` and every `WebRenderer`
 * returned by `createWebRenderer` both run — the only difference between
 * the module-level sugar `renderWebDocument` below and a
 * `createWebRenderer(...).renderWebDocument` is which `templates` map gets
 * passed here. See `internal/createWebRenderer.ts` for the instance-scoped
 * caller, and this file's own top comment for the full behavioral
 * contract, unchanged regardless of which registry is in play.
 */
export function renderWebDocumentAgainst(templates: ReadonlyMap<string, WebTemplate>, doc: ComposeDocument, options: RenderWebOptions = {}): RenderWebResult {
  if (doc.channel !== "web" || doc.meta.channel !== "web") {
    throw new RenderError(
      "wrong-channel",
      `renderWebDocument only renders channel "web" documents, got document.channel="${doc.channel}" / document.meta.channel="${doc.meta.channel}".`,
    );
  }

  const template = templates.get(doc.template);
  if (template === undefined) {
    throw new RenderError(
      "unknown-template",
      `renderWebDocument does not know template "${doc.template}". Known templates: ${[...templates.keys()].join(", ") || "(none)"}.`,
    );
  }

  // A node-kind slot's content NEVER arrives through doc.bindings (see
  // this file's own top comment) — it can only ever arrive through
  // options.nodes, entirely separate from what resolveDocument inspects.
  // So resolveDocument must never report a node-kind slot `missingRequired`
  // merely because doc.bindings has no entry for it — that would be true
  // of EVERY node-kind slot on EVERY render, regardless of whether this
  // particular call actually supplied one via options.nodes. Requiredness
  // for a node-kind slot is instead re-checked, against the TEMPLATE's own
  // real `required` flag, by this function's own `unresolvedRequired`
  // check below, once `content` (which the options.nodes pass, further
  // down, also writes into) is fully built. This mirrors exactly how a
  // repeating slot's key is kept OUT of `flow.slots` entirely for the
  // identical reason — see `internal/webTemplates.ts`'s own top comment —
  // except a node-kind flowed slot cannot be pulled out of `flow` the same
  // way a repeating slot is, because `slotKinds` may still allow copy/asset
  // on that same slot too, and `resolveDocument` still needs to see it to
  // resolve THOSE sources when a caller uses them instead.
  const nodeKindFlowKeys = new Set(template.flow.slots.filter((slot) => slotKindsFor(template, slot.key).includes("node")).map((slot) => slot.key));
  const flowForResolve = nodeKindFlowKeys.size === 0 ? template.flow : { slots: template.flow.slots.map((slot) => (nodeKindFlowKeys.has(slot.key) ? { ...slot, required: false } : slot)) };

  const result = resolveDocument(doc, flowForResolve);
  const hasBindingErrors = result.bindingFindings.some((finding) => finding.severity === "error");
  // "Nothing resolved" is only a real failure if options.nodes ALSO
  // resolved nothing — a document whose only content is a caller-owned
  // node (no copy/asset binding at all) is legitimate, not empty.
  const nothingResolvedAtAll = result.resolved.length === 0 && (options.nodes ?? []).length === 0;
  if (result.missingRequired.length > 0 || result.unknownBindings.length > 0 || hasBindingErrors || nothingResolvedAtAll) {
    const parts: string[] = [];
    if (result.missingRequired.length > 0) parts.push(`missing required slot(s): ${result.missingRequired.join(", ")}`);
    if (result.unknownBindings.length > 0) parts.push(`binding(s) targeting unknown slot(s): ${result.unknownBindings.map((b) => b.slot).join(", ")}`);
    if (nothingResolvedAtAll) parts.push("no binding matched any slot in the template — nothing to render");
    throw new RenderError(
      "resolution-failed",
      `renderWebDocument could not resolve document "${doc.id}" against template "${doc.template}": ${parts.join("; ")}.`,
    );
  }

  // Never hand-rolled — see ../internal/assets.ts's own top comment and
  // this file's own doc comment, "Assets get a stricter bar than optional
  // text": ANY problem here is fatal, regardless of which slot(s) it hit.
  const assetsResolution = resolveDocumentAssets(result, options.resolveAssetId);
  if (hasAssetProblems(assetsResolution)) {
    throw new RenderError(
      "empty-output",
      `renderWebDocument resolved document "${doc.id}" against template "${doc.template}", but at least one assetId binding did not produce a real asset: ${describeAssetProblems(assetsResolution).join("; ")}. Rendering would silently ship a page with a broken or missing image, which this function refuses to do.`,
    );
  }

  const content: Record<string, ReactNode> = {};
  for (const { key, binding } of result.resolved) {
    const kinds = slotKindsFor(template, key);
    if (binding.assetId !== undefined && binding.assetId.length > 0) {
      if (!kinds.includes("asset")) {
        throw new RenderError(
          "resolution-failed",
          `renderWebDocument received an assetId binding for slot "${key}" against template "${doc.template}", but that slot's declared content kind(s) (${kinds.join(", ")}) do not include "asset".`,
        );
      }
      const asset = assetsResolution.byKey.get(key);
      if (asset !== undefined) {
        content[key] = buildAssetElement(asset, options);
      }
      continue;
    }
    const text = resolveBindingText(binding, options.resolveCopyId);
    if (text !== undefined && text.length > 0) {
      if (!kinds.includes("copy")) {
        throw new RenderError(
          "resolution-failed",
          `renderWebDocument received a copy binding for slot "${key}" against template "${doc.template}", but that slot's declared content kind(s) (${kinds.join(", ")}) do not include "copy".`,
        );
      }
      content[key] = text;
    }
  }

  // See this file's own top comment, "RICH-NODE SLOTS" — a slot must be
  // declared "node"-kind to accept an entry here at all, targets a real
  // flowed slot on this template (never a repeating one — those go
  // through options.groups instead), and never collides with a slot a
  // copy/asset binding already filled above.
  for (const nodeBinding of options.nodes ?? []) {
    const slotSpec = template.flow.slots.find((slot) => slot.key === nodeBinding.slot);
    if (slotSpec === undefined) {
      const isRepeating = (template.repeatingSlots ?? []).some((spec) => spec.key === nodeBinding.slot);
      throw new RenderError(
        "resolution-failed",
        isRepeating
          ? `renderWebDocument received a single node binding for slot "${nodeBinding.slot}" against template "${doc.template}", but that slot is a REPEATING slot on this template — author it as a SurfaceRepeatingSlotBinding item and pass it through options.groups instead of options.nodes.`
          : `renderWebDocument received a node binding for slot "${nodeBinding.slot}" against template "${doc.template}", which does not declare that flowed slot at all. Known flowed slot(s): ${template.flow.slots.map((slot) => slot.key).join(", ") || "(none)"}.`,
      );
    }
    const kinds = slotKindsFor(template, nodeBinding.slot);
    if (!kinds.includes("node")) {
      throw new RenderError(
        "resolution-failed",
        `renderWebDocument received a node binding for slot "${nodeBinding.slot}" against template "${doc.template}", but that slot's declared content kind(s) (${kinds.join(", ")}) do not include "node". Declare it via slotKinds: { ${nodeBinding.slot}: [..., "node"] } when defining the template.`,
      );
    }
    if (nodeBinding.slot in content) {
      throw new RenderError(
        "resolution-failed",
        `renderWebDocument received both a node binding (options.nodes) and a copy/asset binding (doc.bindings) for slot "${nodeBinding.slot}" against template "${doc.template}" — a slot may resolve from exactly one source.`,
      );
    }
    content[nodeBinding.slot] = nodeBinding.node as ReactNode;
  }

  const unresolvedRequired = template.flow.slots
    .filter((slot) => slot.required === true)
    .map((slot) => slot.key)
    .filter((key) => !(key in content));

  if (unresolvedRequired.length > 0) {
    throw new RenderError(
      "empty-output",
      `renderWebDocument resolved document "${doc.id}" against template "${doc.template}", but required slot(s) [${unresolvedRequired.join(", ")}] produced no content — every copyId binding must resolve via options.resolveCopyId, every value binding must be non-empty, and every assetId binding must resolve via options.resolveAssetId. Rendering would silently ship an incomplete page, which this function refuses to do.`,
    );
  }

  // See this file's own `resolveTemplateGroups` doc comment for the full
  // fail-closed contract — a no-op for AuthView/ErrorView (neither
  // declares `repeatingSlots`, and no caller of either passes
  // `options.groups`), and the sole way MarketingView's `features`/`faq`
  // slots receive their resolved content, since neither ever appears in
  // `doc.bindings` (see `internal/webTemplates.ts`'s own top comment).
  const groups = resolveTemplateGroups(doc, template, options);

  return {
    element: template.build(content, groups),
    head: buildWebHeadMetadata(doc.meta as WebMeta),
  };
}

/**
 * The module-level sugar entry point — every caller of this package's
 * `web` subpath before `defineWebTemplate`/`createWebRenderer` existed
 * keeps working with a zero-line diff. Exactly
 * `renderWebDocumentAgainst(defaultWebTemplateMap(), doc, options)`: the
 * same built-in `AuthView`/`ErrorView`/`MarketingView` registry as always,
 * never a consumer's own templates — see `createWebRenderer` for a
 * renderer scoped to those instead.
 */
export function renderWebDocument(doc: ComposeDocument, options: RenderWebOptions = {}): RenderWebResult {
  return renderWebDocumentAgainst(defaultWebTemplateMap(), doc, options);
}
