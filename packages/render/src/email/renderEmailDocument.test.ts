/**
 * Behavioral tests for `renderEmailDocument` beyond the golden-output bar
 * (`golden-render.test.ts`): every refusal path actually fires with the
 * right `RenderError.reason`, the geometry-warning path names every slot
 * whose layout was lost, the no-`options.layout` path degrades to binding
 * order with zero warnings, and last-write-wins on a duplicate slot key.
 */

import { describe, expect, it } from "vitest";
import type { ComposeDocument, LayoutSpec } from "@vespeneventures/compose";
import { RenderError } from "../internal/errors.js";
import { renderEmailDocument } from "./renderEmailDocument.js";

const SINGLE_SLOT_LAYOUT: LayoutSpec = {
  slots: [{ key: "a", element: "body", frame: { x: 0, y: 0, w: 1, h: 1 }, required: true }],
};

describe("refusal: wrong-channel", () => {
  it("throws RenderError('wrong-channel') for a non-email document", () => {
    const doc = {
      id: "x",
      channel: "web",
      template: "T",
      meta: { channel: "web", title: "t", description: "d" },
      bindings: [],
    } as unknown as ComposeDocument;

    let caught: unknown;
    try {
      renderEmailDocument(doc);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RenderError);
    expect((caught as RenderError).reason).toBe("wrong-channel");
    expect((caught as RenderError).message).toBe(
      'renderEmailDocument only renders channel "email" documents, got document.channel="web" / document.meta.channel="web".',
    );
  });
});

describe("refusal: resolution-failed", () => {
  it("throws RenderError('resolution-failed') when a binding targets an unknown slot and a required slot goes unbound", () => {
    const doc: ComposeDocument = {
      id: "x",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [{ slot: "nonexistent", value: "v" }],
    };

    let caught: unknown;
    try {
      renderEmailDocument(doc, { layout: SINGLE_SLOT_LAYOUT });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RenderError);
    expect((caught as RenderError).reason).toBe("resolution-failed");
    expect((caught as RenderError).message).toBe(
      'renderEmailDocument could not resolve document "x" against its layout: missing required slot(s): a; binding(s) targeting unknown slot(s): nonexistent.',
    );
  });

  it("throws RenderError('resolution-failed') for a wholly empty document (no bindings, no layout)", () => {
    const doc: ComposeDocument = {
      id: "empty-doc",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [],
    };

    let caught: unknown;
    try {
      renderEmailDocument(doc);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RenderError);
    expect((caught as RenderError).reason).toBe("resolution-failed");
    expect((caught as RenderError).message).toContain("nothing to render");
  });
});

describe("refusal: empty-output", () => {
  it("throws RenderError('empty-output') when a bound copyId has no resolver at all", () => {
    const doc: ComposeDocument = {
      id: "x",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [{ slot: "a", copyId: "missing.copy" }],
    };

    let caught: unknown;
    try {
      renderEmailDocument(doc, { layout: SINGLE_SLOT_LAYOUT });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RenderError);
    expect((caught as RenderError).reason).toBe("empty-output");
    expect((caught as RenderError).message).toBe(
      'renderEmailDocument resolved document "x" against its layout, but not every bound slot produced real text: copyId(s) that did not resolve to real text: missing.copy. Rendering would silently ship an incomplete email, which this function refuses to do.',
    );
  });

  it("throws RenderError('empty-output') when the lookup returns undefined for a bound copyId", () => {
    const doc: ComposeDocument = {
      id: "x",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [{ slot: "a", copyId: "missing.copy" }],
    };

    expect(() => renderEmailDocument(doc, { layout: SINGLE_SLOT_LAYOUT, lookup: () => undefined })).toThrow(RenderError);
  });
});

describe("the geometry problem: a two-column layout degrades to a stack, and BOTH slots are named in the warnings", () => {
  const twoColumnLayout: LayoutSpec = {
    slots: [
      { key: "left", element: "body", frame: { x: 0, y: 0, w: 0.5, h: 0.2 }, required: true },
      { key: "right", element: "body", frame: { x: 0.5, y: 0, w: 0.5, h: 0.2 }, required: true },
    ],
  };
  const doc: ComposeDocument = {
    id: "two-col",
    channel: "email",
    template: "T",
    meta: { channel: "email", subject: "s", preheader: "p" },
    bindings: [
      { slot: "left", value: "Left column" },
      { slot: "right", value: "Right column" },
    ],
  };

  it("names both slots in a single slots-stacked warning, plus one slot-width-lost warning each", () => {
    const { warnings } = renderEmailDocument(doc, { layout: twoColumnLayout });

    expect(warnings).toEqual([
      {
        code: "slots-stacked",
        slots: ["left", "right"],
        message:
          "Slot(s) left, right were positioned side-by-side (overlapping vertical extents, different x) in the supplied layout. Email cannot place content side-by-side, so they are now stacked as separate full-width rows, in top-to-bottom / left-to-right order — the side-by-side arrangement is lost.",
      },
      {
        code: "slot-width-lost",
        slots: ["left"],
        message:
          'Slot "left" was sized to 50% of the canvas width in the supplied layout. Email has no narrower-than-full-width unit once a slot is stacked into the vertical flow, so it now renders at the email\'s full content width — its intended width is lost.',
      },
      {
        code: "slot-width-lost",
        slots: ["right"],
        message:
          'Slot "right" was sized to 50% of the canvas width in the supplied layout. Email has no narrower-than-full-width unit once a slot is stacked into the vertical flow, so it now renders at the email\'s full content width — its intended width is lost.',
      },
    ]);
  });

  it("still renders both slots' content, stacked left-then-right per the sort order", () => {
    const { html } = renderEmailDocument(doc, { layout: twoColumnLayout });
    const leftIndex = html.indexOf("Left column");
    const rightIndex = html.indexOf("Right column");
    expect(leftIndex).toBeGreaterThan(-1);
    expect(rightIndex).toBeGreaterThan(leftIndex);
  });

  it("reports no width-lost warning for a slot whose frame.w is already 1 (full width)", () => {
    const fullWidthLayout: LayoutSpec = {
      slots: [{ key: "solo", element: "body", frame: { x: 0, y: 0, w: 1, h: 0.2 }, required: true }],
    };
    const soloDoc: ComposeDocument = {
      id: "solo",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [{ slot: "solo", value: "Full width" }],
    };
    const { warnings } = renderEmailDocument(soloDoc, { layout: fullWidthLayout });
    expect(warnings).toEqual([]);
  });
});

describe("no options.layout at all: binding order is the only order there is", () => {
  it("renders every bound slot in binding order, with zero geometry warnings", () => {
    const doc: ComposeDocument = {
      id: "no-layout",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [
        { slot: "b", value: "Second" },
        { slot: "a", value: "First" },
      ],
    };

    const { html, text, warnings } = renderEmailDocument(doc);

    expect(warnings).toEqual([]);
    expect(text).toBe("Second\n\nFirst\n");
    const secondIndex = html.indexOf("Second");
    const firstIndex = html.indexOf("First");
    expect(secondIndex).toBeGreaterThan(-1);
    expect(firstIndex).toBeGreaterThan(secondIndex);
  });

  it("throws resolution-failed, not a silent empty render, when an unbound required-looking layout is never supplied and bindings is empty", () => {
    const doc: ComposeDocument = {
      id: "no-layout-empty",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [],
    };
    expect(() => renderEmailDocument(doc)).toThrow(RenderError);
  });
});

describe("duplicate bindings targeting the same slot key: last write wins", () => {
  it("emits exactly one row for the slot, using the LAST binding's resolved text", () => {
    const layout: LayoutSpec = {
      slots: [{ key: "a", element: "body", frame: { x: 0, y: 0, w: 1, h: 1 }, required: true }],
    };
    const doc: ComposeDocument = {
      id: "dup",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [
        { slot: "a", value: "first value" },
        { slot: "a", value: "second value" },
      ],
    };

    const { html, text } = renderEmailDocument(doc, { layout });
    expect(html).not.toContain("first value");
    expect(html.match(/second value/g)).toHaveLength(1);
    expect(text).toBe("second value\n");
  });
});

describe("options.brand — a flattenTokens override reaches the emitted HTML", () => {
  it("substitutes a branded literal hex color in place of the default token value", () => {
    const layout: LayoutSpec = {
      slots: [{ key: "a", element: "heading", frame: { x: 0, y: 0, w: 1, h: 1 }, required: true }],
    };
    const doc: ComposeDocument = {
      id: "brand",
      channel: "email",
      template: "T",
      meta: { channel: "email", subject: "s", preheader: "p" },
      bindings: [{ slot: "a", value: "Branded heading" }],
    };

    const { html: defaultHtml } = renderEmailDocument(doc, { layout });
    const { html: brandedHtml } = renderEmailDocument(doc, {
      layout,
      brand: { "--color-ink-primary": "oklch(0.5 0.2 30)" },
    });

    expect(defaultHtml).not.toBe(brandedHtml);
    expect(/oklch\(/i.test(brandedHtml)).toBe(false);
    expect(defaultHtml).toContain("color:#1a1a1a");
    expect(brandedHtml).not.toContain("color:#1a1a1a");
  });
});
