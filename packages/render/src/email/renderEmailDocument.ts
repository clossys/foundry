/**
 * `renderEmailDocument` — this package's whole job for the `email`
 * channel. Takes a `ComposeDocument` with `channel: "email"` and emits an
 * `EmailRenderResult`: a complete, self-contained HTML document, its
 * plain-text alternative, `subject`/`preheader` (carried through from
 * `doc.meta` for convenience), and `warnings` — every real loss of
 * geometry fidelity this function had to accept. See this package's
 * README, "Email is not a small web page," for the full list of hard
 * constraints the emitted HTML satisfies, and `internal/emailDocument.ts`
 * for exactly where each one is satisfied.
 *
 * THE PIPELINE, IN ORDER
 * ---------------------------
 *   1. CHANNEL CHECK — `doc.channel`/`doc.meta.channel` must both be
 *      `"email"`. Throws `RenderError("wrong-channel", ...)` otherwise.
 *   2. A REAL SLOT LIST — `@vespeneventures/compose`'s own `resolveDocument`
 *      needs a `LayoutSpec` to match `doc.bindings` against, and an
 *      `email`-channel `ComposeDocument` is FORBIDDEN from carrying one on
 *      `doc.layout` itself (`compose`'s `validate.ts`, `layout-forbidden` —
 *      see `resolveDocument`'s own doc comment for why `layout` is always a
 *      separate argument, never read off the document). So this function
 *      uses `options.layout` when the caller supplied one (a real,
 *      positioned template), or builds a synthetic one via
 *      `internal/geometry.ts`'s `buildSyntheticLayout` when they didn't —
 *      see that module's own doc comment for exactly what changes between
 *      the two paths, and this package's README, "The geometry problem."
 *   3. RESOLUTION — `resolveDocument(doc, layout)`, exactly the machinery
 *      `@vespeneventures/compose` ships and `./web` already uses; see its
 *      own doc comment for what `ok: false` means. Not `ok` is a throw
 *      (`"resolution-failed"`), never a partial render.
 *   4. COPY RESOLUTION — `resolveCopy(result, lookup)`, the pass this
 *      channel's own task brief requires by name (issue #43: "a rule that
 *      every consumer must independently remember is a rule that one of
 *      them will forget"). `options.lookup` defaults to a function that
 *      resolves nothing (`() => undefined`) when omitted — the same
 *      "omitting the resolver treats every `copyId` as unresolved"
 *      contract `./web`'s `RenderWebOptions.resolveCopyId` documents.
 *   5. THE RESOLUTION BAR — a deliberately STRICTER bar than `./web`'s:
 *      `./web` only requires slots marked `required: true` to have
 *      resolved (an optional slot can silently drop). Email has no such
 *      per-slot leniency here: `resolveCopy`'s own `ok` flag already means
 *      "every bound slot resolved to real text," and this function treats
 *      ANY unresolved or unchecked slot as fatal (`"empty-output"`)
 *      regardless of that slot's `required` flag. This is a deliberate
 *      strengthening for this channel specifically — an email is a single,
 *      static artifact sent once, with no chance for a user to notice a
 *      missing optional paragraph and reload; "the caller bound a slot and
 *      got no text for it" is exactly the silent-partial-render failure
 *      this whole package exists to refuse. Flagged here explicitly the
 *      same way `./web`'s own `empty-output` strengthening is flagged in
 *      its doc comment, for the next reader who might reasonably expect
 *      this function to mirror `./web`'s per-slot leniency and needs to
 *      know it does not.
 *   6. DUPLICATE BINDINGS — `resolveDocument` explicitly does not pick a
 *      winner when more than one binding targets the same slot key (see
 *      its own doc comment: "deciding what to do about it ... depends on
 *      renderer-specific policy this package does not have an opinion
 *      on"). This function's policy: LAST WRITE WINS. Every binding for a
 *      slot key still gets resolved and validated (nothing here suppresses
 *      an unresolved `copyId` just because it will be discarded), but only
 *      the last-encountered text is emitted, at that slot's one row
 *      position — never a duplicate row.
 *   7. ORDERING AND GEOMETRY WARNINGS — see `internal/geometry.ts`.
 *      `orderEntries` when a real `options.layout` was supplied (sorted by
 *      `frame.y` then `frame.x`); binding order, unchanged, when it
 *      wasn't (`Array.prototype.sort` stability makes this the same
 *      code path either way — see that module's own comment). Warnings
 *      are computed ONLY for the real-layout path.
 *   8. THE DOCUMENT — `internal/emailDocument.ts`'s `buildEmailHtml` for
 *      `html`, `internal/plainText.ts`'s `buildPlainText` (over the SAME
 *      ordered/deduplicated entries) for `text` — see that module's own
 *      doc comment for why deriving both from one shared list, rather
 *      than stripping tags off `html`, is load-bearing.
 */

import { resolveCopy, resolveDocument } from "@vespeneventures/compose";
import type { ComposeDocument, EmailMeta } from "@vespeneventures/compose";
import { RenderError } from "../internal/errors.js";
import { buildEmailHtml } from "./internal/emailDocument.js";
import { buildGeometryWarnings, buildSyntheticLayout, orderEntries } from "./internal/geometry.js";
import type { GeometryEntry } from "./internal/geometry.js";
import { buildPlainText } from "./internal/plainText.js";
import { buildEmailPalette } from "./internal/styles.js";
import type { EmailRenderResult, RenderEmailOptions } from "./types.js";

export function renderEmailDocument(doc: ComposeDocument, options: RenderEmailOptions = {}): EmailRenderResult {
  if (doc.channel !== "email" || doc.meta.channel !== "email") {
    throw new RenderError(
      "wrong-channel",
      `renderEmailDocument only renders channel "email" documents, got document.channel="${doc.channel}" / document.meta.channel="${doc.meta.channel}".`,
    );
  }

  const layoutSupplied = options.layout !== undefined;
  const layout = options.layout ?? buildSyntheticLayout(doc.bindings);

  const result = resolveDocument(doc, layout);
  if (!result.ok) {
    const parts: string[] = [];
    if (result.missingRequired.length > 0) {
      parts.push(`missing required slot(s): ${result.missingRequired.join(", ")}`);
    }
    if (result.unknownBindings.length > 0) {
      parts.push(`binding(s) targeting unknown slot(s): ${result.unknownBindings.map((b) => b.slot).join(", ")}`);
    }
    const bindingErrors = result.bindingFindings.filter((f) => f.severity === "error");
    if (bindingErrors.length > 0) {
      parts.push(`malformed binding(s): ${bindingErrors.map((f) => f.message).join("; ")}`);
    }
    if (result.resolved.length === 0 && parts.length === 0) {
      parts.push("no binding matched any slot in the layout — nothing to render");
    }
    throw new RenderError(
      "resolution-failed",
      `renderEmailDocument could not resolve document "${doc.id}" against its layout: ${parts.join("; ")}.`,
    );
  }

  const lookup = options.lookup ?? (() => undefined);
  const copyResult = resolveCopy(result, lookup);
  if (!copyResult.ok) {
    const parts: string[] = [];
    if (copyResult.unresolvedCopyIds.length > 0) {
      parts.push(`copyId(s) that did not resolve to real text: ${copyResult.unresolvedCopyIds.join(", ")}`);
    }
    if (copyResult.unchecked.length > 0) {
      parts.push(`slot(s) resolveCopy could not even attempt to resolve: ${copyResult.unchecked.join(", ")}`);
    }
    if (copyResult.texts.length === 0 && parts.length === 0) {
      parts.push("no slot produced any text at all");
    }
    throw new RenderError(
      "empty-output",
      `renderEmailDocument resolved document "${doc.id}" against its layout, but not every bound slot produced real text: ${parts.join("; ")}. Rendering would silently ship an incomplete email, which this function refuses to do.`,
    );
  }

  // `copyResult.texts` is aligned 1:1, same order, with `result.resolved` —
  // guaranteed by `resolveCopy`'s own iteration (see its doc comment) AND
  // by `copyResult.ok` above, which requires zero skipped entries. Safe to
  // zip by index.
  const zipped: GeometryEntry[] = result.resolved.map((slot, i) => ({
    key: slot.key,
    frame: slot.spec.frame,
    element: slot.spec.element,
    text: copyResult.texts[i]!.text,
  }));

  // Last-write-wins on duplicate slot keys — see this file's own doc
  // comment, point 6. `Map.set` on an already-present key updates its
  // value without moving its position, so the FIRST occurrence's position
  // is kept (irrelevant here since every occurrence of one key shares the
  // same `SlotSpec`, hence the same `frame`) while the LAST occurrence's
  // text wins.
  const deduped = new Map<string, GeometryEntry>();
  for (const entry of zipped) deduped.set(entry.key, entry);
  const entries = [...deduped.values()];

  const ordered = layoutSupplied ? orderEntries(entries) : entries;
  const warnings = layoutSupplied ? buildGeometryWarnings(ordered) : [];

  const meta = doc.meta as EmailMeta;
  const palette = buildEmailPalette(options.brand);

  const html = buildEmailHtml({
    subject: meta.subject,
    preheader: meta.preheader,
    entries: ordered,
    palette,
  });
  const text = buildPlainText(ordered);

  return {
    html,
    text,
    subject: meta.subject,
    preheader: meta.preheader,
    warnings,
  };
}
