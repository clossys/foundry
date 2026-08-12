import type { AssetLookup, CopyLookup, FlowLayoutSpec, LayoutSpec } from "../core/index.js";

// ---------------------------------------------------------------------------
// RenderWarning — the geometry loss report
// ---------------------------------------------------------------------------

/**
 * One real loss of fidelity `renderEmailDocument` had to accept and is
 * telling the caller about, rather than hiding. See
 * `internal/geometry.ts`'s own doc comment for the full reasoning; this is
 * the public shape that module's findings are reported through.
 */
export interface RenderWarning {
  /**
   * `"slots-stacked"` — two or more slots that were positioned side-by-side
   * in the supplied layout (overlapping vertical extents, different `x`)
   * are now rendered as separate full-width rows, stacked top to bottom —
   * the side-by-side arrangement itself is lost.
   *
   * `"slot-width-lost"` — a slot whose `frame.w < 1` now renders at the
   * email's full content width; its intended fractional width could not be
   * preserved once stacked into the vertical flow.
   */
  code: "slots-stacked" | "slot-width-lost";
  /** A human-readable description of exactly what was dropped and why. */
  message: string;
  /** The `SlotSpec.key`(s) this warning is about — every key in the affected cluster for `"slots-stacked"`, exactly one for `"slot-width-lost"`. Never empty. */
  slots: string[];
}

// ---------------------------------------------------------------------------
// RenderEmailOptions / EmailRenderResult
// ---------------------------------------------------------------------------

export interface RenderEmailOptions {
  /** Canonical ordered slot declaration for a flowed email template. */
  flow?: FlowLayoutSpec;
  /**
   * The real, positioned `LayoutSpec` this document's `template` defines —
   * the same "supply the real slot list from wherever it lives" seam
   * `@vespeneventures/surface/core`'s own `resolveDocument` documents (its
   * `layout` argument is never read off `doc.layout`, because a
   * `channel: "email"` document is FORBIDDEN from carrying one at all —
   * see `surface/core`'s `validate.ts`, `layout-forbidden`). Omit this entirely
   * when there is no real positioned template to supply — see this
   * package's README, "The geometry problem," for exactly what changes
   * (and what warnings disappear) when it's omitted.
   */
  /** @deprecated Use `flow`. Retained only to preserve the former positioned-email migration path and its warnings. */
  layout?: LayoutSpec;
  /** See `@vespeneventures/surface/core`'s own `CopyLookup`. Omitted entirely (rather than passed as `undefined`) is treated the same as a lookup that resolves nothing — every `copyId` binding is then unresolved, which fails this function's own resolution bar (see `renderEmailDocument.ts`). */
  lookup?: CopyLookup;
  /**
   * See `@vespeneventures/surface/core`'s own `AssetLookup` — the identical seam
   * `lookup` draws for `copyId`, one binding field over. Omitted entirely is
   * treated the same as a lookup that resolves nothing — every `assetId`
   * binding is then unresolved, which is ALWAYS fatal for this channel (see
   * `renderEmailDocument.ts`'s own doc comment: email's existing "every
   * bound slot must resolve" bar already covers assets too, with no extra
   * leniency to remove).
   */
  assetLookup?: AssetLookup;
  /** A `flattenTokens` override map (`@vespeneventures/ui/tokens`' brand-override shape) — passed straight through to `internal/styles.ts`'s `buildEmailPalette`. Omit to render with the unbranded default token values. */
  brand?: Record<string, string>;
}

/** What `renderEmailDocument` returns: everything a caller needs to actually send the email. */
export interface EmailRenderResult {
  /** The complete, self-contained HTML document — table-based layout, MSO conditional comments, every color/size/font a literal value, no CSS custom properties, no `oklch()`. Ready to hand to an ESP/SMTP client as the message's `text/html` part. */
  html: string;
  /** The plain-text alternative, generated from the same resolved slot text as `html` — see `internal/plainText.ts`. Ready to hand to an ESP/SMTP client as the message's `text/plain` part. */
  text: string;
  /** `EmailMeta.subject`, carried through unchanged — convenience so a caller building a full outgoing message doesn't have to re-read `doc.meta.subject` separately. */
  subject: string;
  /** `EmailMeta.preheader`, carried through unchanged — same convenience as `subject`, and useful to a caller that also wants to log or display it outside the rendered HTML. */
  preheader: string;
  /** Every geometry loss `renderEmailDocument` had to accept — see {@link RenderWarning}. Always an array, never `undefined`; empty when nothing was lost (including the entire no-`options.layout` path — see that option's own doc comment). */
  warnings: RenderWarning[];
}
