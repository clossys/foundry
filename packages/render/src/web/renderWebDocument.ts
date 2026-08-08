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
 *      web/email document needs supplied from outside `compose` — see
 *      `compose`'s `resolve.ts` doc comment.
 *   2. THE HEAD METADATA (`head`) — `doc.meta` (a `WebMeta`), reshaped into
 *      this package's own framework-agnostic `WebHeadMetadata` by
 *      `headMetadata.ts`.
 *
 * ONLY PLAIN TEXT EVER FILLS A SLOT
 * -----------------------------------
 * `SlotBinding` carries exactly two possible sources — `copyId` (a string
 * id, resolved via the caller's own `resolveCopyId`) or `value` (a literal
 * string) — never a React node, a component, or markup (see `compose`'s
 * own `types.ts`). So every slot this function fills — including
 * `AuthView`'s `form`, which in a hand-built page holds a real interactive
 * sign-in form — receives plain resolved text, never richer content. This
 * is not a shortcut this package took; it's what the frozen
 * `ComposeDocument` contract itself supports. A consumer who wants a real
 * form (or any other rich node) in that slot composes
 * `@vespeneventures/ui`'s `AuthView` directly, outside this document
 * pipeline — the same "this package's job ends where a richer composition
 * begins" boundary `compose`'s own README draws for `template` and
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
 * have resolved to non-empty text, and throws `RenderError("empty-output",
 * ...)` if even one didn't. This is a deliberate strengthening beyond what
 * `resolveDocument` itself checks, flagged here the same way `compose`'s
 * own README flags its `frame-out-of-bounds` strengthening — not a change
 * to any contract shape, a stricter reading of what "resolved" has to mean
 * for a render to actually be safe to ship.
 */

import { resolveDocument } from "@vespeneventures/compose";
import type { ComposeDocument, WebMeta } from "@vespeneventures/compose";
import type { ReactNode } from "react";
import { RenderError } from "../internal/errors.js";
import { buildWebHeadMetadata } from "./headMetadata.js";
import { getWebTemplate, listWebTemplateNames } from "./internal/webTemplates.js";
import type { RenderWebOptions, RenderWebResult } from "./types.js";

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

  const result = resolveDocument(doc, template.layout);
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

  const content: Record<string, ReactNode> = {};
  for (const { key, binding } of result.resolved) {
    const text = resolveBindingText(binding, options.resolveCopyId);
    if (text !== undefined && text.length > 0) {
      content[key] = text;
    }
  }

  const unresolvedRequired = template.layout.slots
    .filter((slot) => slot.required === true)
    .map((slot) => slot.key)
    .filter((key) => !(key in content));

  if (unresolvedRequired.length > 0) {
    throw new RenderError(
      "empty-output",
      `renderWebDocument resolved document "${doc.id}" against template "${doc.template}", but required slot(s) [${unresolvedRequired.join(", ")}] produced no text — every copyId binding must resolve via options.resolveCopyId, and every value binding must be non-empty. Rendering would silently ship an incomplete page, which this function refuses to do.`,
    );
  }

  return {
    element: template.build(content),
    head: buildWebHeadMetadata(doc.meta as WebMeta),
  };
}
