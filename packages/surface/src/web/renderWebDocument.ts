/**
 * `renderWebDocument` — this package's whole job for the `web` channel.
 * Takes a `ComposeDocument` with `channel: "web"` and emits the two things
 * a web page built from it needs:
 *
 *   1. THE RENDERED VIEW (`element`) — `doc.template` names a
 *      `@vespeneventures/ui` view (`AuthView`, `ErrorView`); `doc.bindings`
 *      are resolved into that view's own slots via `@vespeneventures/
 *      compose`'s `resolveDocument`, using this package's own
 *      `internal/webTemplates.ts` registry as the "real slot list" every
 *      web/email document needs supplied from outside `surface/core` — see
 *      `surface/core`'s `resolve.ts` doc comment.
 *   2. THE HEAD METADATA (`head`) — `doc.meta` (a `WebMeta`), reshaped into
 *      this package's own framework-agnostic `WebHeadMetadata` by
 *      `headMetadata.ts`.
 *
 * ONLY PLAIN TEXT EVER FILLS A SLOT
 * -----------------------------------
 * `SlotBinding` carries exactly two possible sources — `copyId` (a string
 * id, resolved via the caller's own `resolveCopyId`) or `value` (a literal
 * string) — never a React node, a component, or markup (see `surface/core`'s
 * own `types.ts`). So every slot this function fills — including
 * `AuthView`'s `form`, which in a hand-built page holds a real interactive
 * sign-in form — receives plain resolved text, never richer content. This
 * is not a shortcut this package took; it's what the frozen
 * `ComposeDocument` contract itself supports. A consumer who wants a real
 * form (or any other rich node) in that slot composes
 * `@vespeneventures/ui`'s `AuthView` directly, outside this document
 * pipeline — the same "this package's job ends where a richer composition
 * begins" boundary `surface/core`'s own README draws for `template` and
 * `copyId`.
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
 * IMAGES: A SLOT CAN NOW RESOLVE TO A REAL `<img>`, NOT JUST STYLED TEXT
 * -------------------------------------------------------------------------
 * `SlotBinding.assetId` (`@vespeneventures/surface/core` 0.3.0) is this
 * package's second content source, alongside `copyId`/`value` — see
 * `../internal/assets.ts` for the shared resolution/validation machinery
 * every channel uses. A slot bound via `assetId` never falls through to
 * `resolveBindingText` (which only ever reads `copyId`/`value` — an
 * `assetId`-only binding has neither); instead its resolved,
 * shape-validated `RenderAsset` becomes a real `<img src alt width
 * height>` element, filling `content[key]` exactly like a resolved string
 * does — `WebTemplate.build`'s `Record<string, ReactNode>` parameter
 * already accepts either, no template registry change required.
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
 */

import { resolveDocument } from "../core/index.js";
import type { ComposeDocument, WebMeta } from "../core/index.js";
import type { ReactNode } from "react";
import { createElement, version as reactVersion } from "react";
import { RenderError } from "../internal/errors.js";
import { describeAssetProblems, hasAssetProblems, resolveDocumentAssets } from "../internal/assets.js";
import { assertPeerVersion } from "../internal/peer-version.js";
import { buildWebHeadMetadata } from "./headMetadata.js";
import { getWebTemplate, listWebTemplateNames } from "./internal/webTemplates.js";
import type { RenderWebOptions, RenderWebResult } from "./types.js";

/**
 * `react` is this subpath's optional peer (see package.json's
 * `peerDependenciesMeta`) — optional so a consumer can install
 * `@vespeneventures/surface` and use `./core`, `./media`, `./email`,
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

export function renderWebDocument(doc: ComposeDocument, options: RenderWebOptions = {}): RenderWebResult {
  if (doc.channel !== "web" || doc.meta.channel !== "web") {
    throw new RenderError(
      "wrong-channel",
      `renderWebDocument only renders channel "web" documents, got document.channel="${doc.channel}" / document.meta.channel="${doc.meta.channel}".`,
    );
  }

  const template = getWebTemplate(doc.template);
  if (template === undefined) {
    throw new RenderError(
      "unknown-template",
      `renderWebDocument does not know template "${doc.template}". Known templates: ${listWebTemplateNames().join(", ") || "(none)"}.`,
    );
  }

  const result = resolveDocument(doc, template.flow);
  if (!result.ok) {
    const parts: string[] = [];
    if (result.missingRequired.length > 0) parts.push(`missing required slot(s): ${result.missingRequired.join(", ")}`);
    if (result.unknownBindings.length > 0) parts.push(`binding(s) targeting unknown slot(s): ${result.unknownBindings.map((b) => b.slot).join(", ")}`);
    if (result.resolved.length === 0) parts.push("no binding matched any slot in the template — nothing to render");
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
    if (binding.assetId !== undefined && binding.assetId.length > 0) {
      const asset = assetsResolution.byKey.get(key);
      if (asset !== undefined) {
        content[key] = createElement("img", {
          src: asset.src,
          alt: asset.alt,
          width: asset.width,
          height: asset.height,
        });
      }
      continue;
    }
    const text = resolveBindingText(binding, options.resolveCopyId);
    if (text !== undefined && text.length > 0) {
      content[key] = text;
    }
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

  return {
    element: template.build(content),
    head: buildWebHeadMetadata(doc.meta as WebMeta),
  };
}
