/**
 * `renderPrintDocument` — this package's whole job for the `print` channel.
 * Takes a `ComposeDocument` with `channel: "print"` and returns a complete,
 * standalone, deterministic paged-media HTML+CSS document string — never a
 * PDF, never via a headless browser. See this package's README, "The key
 * architectural decision, already made", for the full argument; short
 * version: a PDF golden test asserts nothing meaningful (it's a binary
 * blob you cannot meaningfully diff), and a headless-browser dependency
 * (Puppeteer, ~300MB) is a cost this package does not need to pay when the
 * actual deliverable — "a string a browser's print pipeline renders
 * correctly" — is plain HTML+CSS. Rasterizing or printing this string to
 * an actual PDF is a downstream caller's job.
 *
 * GEOMETRY SURVIVES HERE — UNLIKE `./web`
 * -----------------------------------------
 * `./web` never reads `SlotSpec.frame` at all (every slot there uses a
 * fixed full-canvas placeholder — see `../web/internal/webTemplates.ts`'s
 * own doc comment) because a flowed web page has no coordinate system a
 * `Frame` could describe. A print PAGE is a fixed physical canvas, so this
 * is the first channel in this package where `Frame` means something real:
 * `doc.layout.slots[].frame` — a 0..1 fraction of the page's PRINTABLE area
 * (the page minus its margins; see `internal/document.ts`'s own doc
 * comment for exactly why that's the containing block, not the full page)
 * — becomes an absolutely-positioned percentage box via
 * `@vespeneventures/compose`'s own `frameToPercent` (`internal/geometry.ts`
 * is the only place that conversion happens; this file never recomputes
 * it).
 *
 * WHERE `doc.layout` COMES FROM
 * -------------------------------
 * Unlike `./web` (which has its own `internal/webTemplates.ts` registry
 * mapping `doc.template` -> a real `LayoutSpec`, because a web/email
 * document carries NO `layout` of its own — see `compose`'s `LayoutSpec`
 * doc comment), a print document's `LayoutSpec` lives directly on
 * `doc.layout`: `compose`'s own contract REQUIRES it for `print`/`slides`/
 * `image` (`validate.ts`'s `layout-required` rule). So this file has no
 * template registry at all — `doc.template` is carried through only as a
 * `data-template` attribute on the rendered `.page` element, for a
 * downstream stylesheet hook; this function never validates or interprets
 * it as the name of anything.
 *
 * REFUSAL PATHS — NEVER A SILENT PARTIAL PAGE
 * -----------------------------------------------
 * | `RenderError.reason` | When |
 * | --- | --- |
 * | `"wrong-channel"` | `doc.channel` (or `doc.meta.channel`) isn't `"print"`. |
 * | `"missing-layout"` | `doc.layout` is absent or malformed — print's own frozen contract requires it (see above); a stronger, earlier check than letting `resolveDocument` silently treat a missing layout as zero slots. |
 * | `"missing-custom-page-size"` | `doc.meta.pageSize === "Custom"` and `options.customPageSize` wasn't supplied (or was blank) — see `internal/page.ts`'s `resolvePageBox`. |
 * | `"resolution-failed"` | `@vespeneventures/compose`'s `resolveDocument` itself reports `ok: false` — a required slot has no binding, a binding targets an unknown slot, a bound slot is itself malformed, or nothing at all matched. |
 * | `"empty-output"` | `resolveDocument` succeeded, but `@vespeneventures/compose`'s `resolveCopy` reports `ok: false` — some matched slot's `copyId` never resolved to real text (no `options.resolveCopyId` was given, it returned `undefined`, or a binding had two conflicting sources). Reused from `./web`'s own vocabulary rather than invented fresh — the two situations are the same shape: a document that LOOKS resolved but produces no real content for at least one matched slot. **This is `resolveCopy`, not a hand-rolled second check** — see `@vespeneventures/compose`'s own `resolve-copy.ts` doc comment and issue #43: "a rule every renderer must independently remember is a rule one of them will forget." |
 * | `"unknown-style-role"` | A `SlotSpec.style.color`/`.background` (or `doc.layout.background.color`/`.background`) names a token role absent from `@vespeneventures/tokens`' `TOKENS` registry — see `internal/style.ts`. |
 *
 * COLOURS ARE FLATTENED TO LITERAL HEX, ON PURPOSE
 * ----------------------------------------------------
 * A browser's print pipeline DOES understand `oklch()` and CSS custom
 * properties — unlike `./email`'s target, which understands neither. So
 * flattening here is a real decision, not an inherited necessity, and the
 * argument for it is: this HTML is a paged-media document meant to be
 * printed or turned into a PDF, and the tooling that performs that step is
 * frequently NOT a browser at all — prepress software, a PDF-rasterizing
 * library embedded in a print pipeline, a `wkhtmltopdf`-shaped headless
 * renderer — much of which has patchy-to-nonexistent `oklch()`/custom-
 * property support. `internal/style.ts` resolves every `style.color`/
 * `.background` role through this package's shared `internal/tokens.ts`
 * `flattenTokens()`, the exact same flattening `./email` needs for the
 * exact same underlying reason: a flattened document is safe in both a
 * browser and a non-browser print pipeline; a `var()`/`oklch()`-bearing one
 * is only safe in the former. See this package's README for the fuller
 * version of this argument.
 */

import { resolveCopy, resolveDocument } from "@vespeneventures/compose";
import type { ComposeDocument, PrintMeta, ResolvedSlot } from "@vespeneventures/compose";
import { RenderError } from "../internal/errors.js";
import { flattenTokens } from "../internal/tokens.js";
import { buildHtmlDocument } from "./internal/document.js";
import { buildPageAtRuleCss, resolvePageBox } from "./internal/page.js";
import { buildSlotHtml } from "./internal/slot.js";
import { resolveStyleColors } from "./internal/style.js";
import type { RenderPrintOptions, RenderPrintResult } from "./types.js";

function hasRealLayout(doc: ComposeDocument): doc is ComposeDocument & { layout: NonNullable<ComposeDocument["layout"]> } {
  return doc.layout !== undefined && Array.isArray(doc.layout.slots);
}

export function renderPrintDocument(doc: ComposeDocument, options: RenderPrintOptions = {}): RenderPrintResult {
  if (doc.channel !== "print" || doc.meta.channel !== "print") {
    throw new RenderError(
      "wrong-channel",
      `renderPrintDocument only renders channel "print" documents, got document.channel="${doc.channel}" / document.meta.channel="${doc.meta.channel}".`,
    );
  }

  if (!hasRealLayout(doc)) {
    throw new RenderError(
      "missing-layout",
      `renderPrintDocument could not render document "${doc.id}": doc.layout is required for a "print" document ` +
        `(@vespeneventures/compose's own contract — see its types.ts's LayoutSpec doc comment, "Required for ` +
        `print/slides/image") but was ${doc.layout === undefined ? "absent" : "not a valid LayoutSpec (slots must be an array)"}.`,
    );
  }

  const meta = doc.meta as PrintMeta;
  const layout = doc.layout;

  const pageBox = resolvePageBox(meta, options.customPageSize);

  const result = resolveDocument(doc, layout);
  if (!result.ok) {
    const parts: string[] = [];
    if (result.missingRequired.length > 0) parts.push(`missing required slot(s): ${result.missingRequired.join(", ")}`);
    if (result.unknownBindings.length > 0) parts.push(`binding(s) targeting unknown slot(s): ${result.unknownBindings.map((b) => b.slot).join(", ")}`);
    if (result.resolved.length === 0) parts.push("no binding matched any slot in the layout — nothing to render");
    const findingMessages = result.bindingFindings.map((f) => f.message);
    if (findingMessages.length > 0) parts.push(`binding shape finding(s): ${findingMessages.join("; ")}`);
    throw new RenderError(
      "resolution-failed",
      `renderPrintDocument could not resolve document "${doc.id}" against its own layout: ${parts.join("; ")}.`,
    );
  }

  const lookup = options.resolveCopyId ?? (() => undefined);
  const copyResult = resolveCopy(result, lookup);
  if (!copyResult.ok) {
    const parts: string[] = [];
    if (copyResult.unresolvedCopyIds.length > 0) parts.push(`copyId(s) that resolved to no text: ${copyResult.unresolvedCopyIds.join(", ")}`);
    if (copyResult.unchecked.length > 0) parts.push(`slot(s) with no usable, unambiguous source of text: ${copyResult.unchecked.join(", ")}`);
    if (parts.length === 0) parts.push("no slot produced any text");
    throw new RenderError(
      "empty-output",
      `renderPrintDocument resolved document "${doc.id}" against its layout, but at least one matched slot ` +
        `produced no real text: ${parts.join("; ")}. Rendering would silently ship an incomplete page, which this ` +
        `function refuses to do.`,
    );
  }

  const textByKey = new Map(copyResult.texts.map((t) => [t.key, t.text]));
  const specByKey = new Map<string, ResolvedSlot["spec"]>(result.resolved.map((r) => [r.key, r.spec]));

  const flat = flattenTokens(options.tokenOverrides);

  // Multiple bindings can target the same slot key (resolveDocument doesn't
  // pick a winner — see its own doc comment) — render each real slot once;
  // `textByKey`/`specByKey`, both plain `Map`s keyed by slot key, naturally
  // keep the LAST resolved binding for a duplicate key, the same
  // last-write-wins default a caller who wants different behaviour (a
  // hard error on a collision, first-write-wins) can detect for themselves
  // by grouping `result.resolved` on `key` before calling this function.
  const orderedKeys = [...new Set(result.resolved.map((r) => r.key))];

  const slotsHtml = orderedKeys.map((key) => buildSlotHtml(specByKey.get(key)!, textByKey.get(key)!, flat, options)).join("");

  const { color: pageColor, backgroundColor: pageBackgroundColor } = resolveStyleColors(layout.background, "<page>", flat);

  const pageAtRuleCss = buildPageAtRuleCss(meta, pageBox);

  const html = buildHtmlDocument({
    doc,
    pageBox,
    pageAtRuleCss,
    pageColor,
    pageBackgroundColor,
    marginTop: meta.margins.top,
    marginRight: meta.margins.right,
    marginBottom: meta.margins.bottom,
    marginLeft: meta.margins.left,
    slotsHtml,
  });

  return {
    html,
    page: {
      pageSize: meta.pageSize,
      orientation: meta.orientation,
      width: pageBox.width,
      height: pageBox.height,
      ...(meta.dpi !== undefined ? { dpi: meta.dpi } : {}),
    },
  };
}
