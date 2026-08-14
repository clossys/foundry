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
 *   2. A REAL SLOT LIST — `@vespeneventures/surface/core`'s own `resolveDocument`
 *      needs a `LayoutSpec` to match `doc.bindings` against, and an
 *      `email`-channel `ComposeDocument` is FORBIDDEN from carrying one on
 *      `doc.layout` itself (`surface/core`'s `validate.ts`, `layout-forbidden` —
 *      see `resolveDocument`'s own doc comment for why `layout` is always a
 *      separate argument, never read off the document). So this function
 *      uses `options.layout` when the caller supplied one (a real,
 *      positioned template), or builds a synthetic one via
 *      `internal/geometry.ts`'s `buildSyntheticLayout` when they didn't —
 *      see that module's own doc comment for exactly what changes between
 *      the two paths, and this package's README, "The geometry problem."
 *   3. RESOLUTION — `resolveDocument(doc, layout)`, exactly the machinery
 *      `@vespeneventures/surface/core` ships and `./web` already uses; see its
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
 *
 * IMAGES: `assetId` BINDINGS JOIN THE SAME ORDERED ROW STACK AS TEXT
 * -----------------------------------------------------------------------
 * `SlotBinding.assetId` (`@vespeneventures/surface/core` 0.3.0) resolves via
 * `../internal/assets.ts`'s `resolveDocumentAssets` — never hand-rolled,
 * same reasoning as step 4 above, one binding field over. Email has no
 * absolute positioning at all (see step 7): an image slot is just another
 * full-width row in the vertical stack, positioned by `frame.y`/`frame.x`
 * exactly like a text row, painted as an `<img>` instead of escaped text
 * (`internal/emailDocument.ts`'s `buildRow`). Because `resolveCopy` and
 * `resolveDocumentAssets` each independently pick out only the bindings
 * that are their own job (deferring the other's — see `@vespeneventures/
 * compose`'s own `resolve-copy.ts`/`resolve-assets.ts`), the two passes'
 * result arrays are NOT the same length as `result.resolved` whenever the
 * document mixes both kinds — so this function joins them by SLOT KEY
 * (`Map`), never by array position. A prior version of this file zipped
 * `result.resolved[i]` against `copyResult.texts[i]` positionally, which
 * silently misaligned (or crashed on `undefined`) the moment a document
 * had even one `assetId` binding — exactly the "renders wrong content, or
 * nothing, without saying so" failure this whole package refuses
 * everywhere else. Key-based lookup cannot misalign this way.
 *
 * SAME "NO LENIENCY" BAR AS TEXT — AN ASSET-ONLY DOCUMENT IS NOT EMPTY
 * -----------------------------------------------------------------------
 * Step 5 above already holds every bound TEXT slot to a stricter bar than
 * `./web`'s (no leniency for "optional"). Assets get the identical
 * treatment, for the identical reason: `hasAssetProblems` forces a refusal
 * the moment ANY `assetId` binding fails to resolve into a real, paintable
 * asset. The other half of that same discipline is the fix this file
 * exists to prove: a document made ENTIRELY of `assetId` bindings (zero
 * `copyId`/`value` anywhere) must still render — `resolveCopy`'s own `ok`
 * already reports `true` for that shape (see its doc comment,
 * "`deferredToAssets`"), so the old bug here was never `resolveCopy`
 * itself; it was this file's positional zip silently producing zero rows
 * (or throwing on `undefined`) for a document `resolveCopy` correctly said
 * was fine.
 *
 * VIDEO: NO EMAIL CLIENT HAS A DEPENDABLE `<video>` STORY — A
 * `VideoAssetEntry` RENDERS ITS `poster`, OR FAILS CLOSED (issue #177)
 * -------------------------------------------------------------------------
 * Real inline `<video>` playback in email is, at best, spotty across
 * clients and unavailable in most — this channel makes no attempt at it.
 * `../internal/assets.ts`'s `resolveStaticAssets` reduces any resolved
 * `VideoAssetEntry`-sourced binding to its `poster` image and joins the
 * SAME ordered row stack as every other slot, painted exactly like an
 * image binding would be (`buildImageTag`, `internal/emailDocument.ts`). A
 * video with no `poster` is fatal — this channel's own `hasAssetProblems`
 * refusal now also covers `staticAssets.posterlessVideo`, the identical
 * "no leniency, any problem is fatal" bar every other asset problem
 * already gets here.
 */

import { resolveCopy, resolveDocument } from "../core/index.js";
import type { ComposeDocument, EmailMeta } from "../core/index.js";
import { RenderError } from "../internal/errors.js";
import { describeAssetProblems, describeStaticAssetProblems, hasAssetProblems, resolveDocumentAssets, resolveStaticAssets } from "../internal/assets.js";
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

  const legacyLayout = options.layout;
  const layoutSupplied = legacyLayout !== undefined;
  const flow = options.flow ?? (legacyLayout === undefined ? buildSyntheticLayout(doc.bindings) : { slots: legacyLayout.slots.map(({ key, required, style }) => ({ key, required, style })) });

  const result = resolveDocument(doc, flow);
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

  // Never hand-rolled — see this file's own top comment, "Images: assetId
  // bindings join the same ordered row stack as text".
  const assetsResolution = resolveDocumentAssets(result, options.assetLookup);
  // See this file's own top comment, "Video: no email client has a
  // dependable <video> story" — a resolved video asset with no poster is
  // exactly as fatal as an unresolved/invalid asset.
  const staticAssets = resolveStaticAssets(assetsResolution);

  if (!copyResult.ok || hasAssetProblems(assetsResolution) || staticAssets.posterlessVideo.length > 0) {
    const parts: string[] = [];
    if (copyResult.unresolvedCopyIds.length > 0) {
      parts.push(`copyId(s) that did not resolve to real text: ${copyResult.unresolvedCopyIds.join(", ")}`);
    }
    if (copyResult.unchecked.length > 0) {
      parts.push(`slot(s) resolveCopy could not even attempt to resolve: ${copyResult.unchecked.join(", ")}`);
    }
    parts.push(...describeAssetProblems(assetsResolution));
    parts.push(...describeStaticAssetProblems(staticAssets));
    if (parts.length === 0) {
      parts.push("no slot produced any content at all");
    }
    throw new RenderError(
      "empty-output",
      `renderEmailDocument resolved document "${doc.id}" against its layout, but not every bound slot produced real content: ${parts.join("; ")}. Rendering would silently ship an incomplete email, which this function refuses to do.`,
    );
  }

  // Joined by SLOT KEY, never by array position — see this file's own top
  // comment for why a positional zip against either `copyResult.texts` or
  // `assetsResolution.byKey` alone is wrong the moment a document mixes
  // both content kinds (each pass's own result array omits the other
  // pass's slots entirely). Given the refusal check just above passed,
  // every entry in `result.resolved` is guaranteed to have EITHER a text
  // entry OR a valid asset entry — `resolveDocument`'s own
  // binding-source-exclusivity check (already enforced before this
  // function ever calls `resolveCopy`/`resolveDocumentAssets`) means each
  // binding has EXACTLY one of `copyId`/`value`/`assetId`, and each of
  // those two passes only ever fails to place a slot it actually owns into
  // its own "resolved" bucket via a problem this function has already
  // refused on.
  const textByKey = new Map(copyResult.texts.map((t) => [t.key, t.text]));
  const assetByKey = staticAssets.byKey;

  const zipped: GeometryEntry[] = [];
  for (const slot of result.resolved) {
    const asset = assetByKey.get(slot.key);
    const text = asset !== undefined ? asset.alt : textByKey.get(slot.key);
    if (text === undefined) continue; // Unreachable given the refusal check above — see this block's own comment.
    zipped.push({
      key: slot.key,
      text,
      ...(asset !== undefined ? { asset } : {}),
      ...(slot.spec.style !== undefined ? { style: slot.spec.style } : {}),
    });
  }

  // Last-write-wins on duplicate slot keys — see this file's own doc
  // comment, point 6. `Map.set` on an already-present key updates its
  // value without moving its position, so the FIRST occurrence's position
  // is kept (irrelevant here since every occurrence of one key shares the
  // same `SlotSpec`, hence the same `frame`) while the LAST occurrence's
  // content wins.
  const deduped = new Map<string, GeometryEntry>();
  for (const entry of zipped) deduped.set(entry.key, entry);
  const entries = [...deduped.values()];

  if (legacyLayout !== undefined) {
    const legacyByKey = new Map(legacyLayout.slots.map((slot) => [slot.key, slot]));
    for (const entry of entries) {
      const legacy = legacyByKey.get(entry.key);
      if (legacy !== undefined) {
        entry.frame = legacy.frame;
        entry.element = legacy.element;
      }
    }
  }
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
