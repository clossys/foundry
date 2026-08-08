import { describe, expect, it } from "vitest";
import { validateComposeDocument } from "./validate.js";
import type { ComposeDocument, LayoutSpec } from "./types.js";

// Minimal but complete, obviously-fictional fixtures, one per channel — the
// same "acme" placeholder convention this repository's own README examples
// and sibling packages' tests already use. Never a real product, template,
// or piece of copy.

const validWeb: ComposeDocument = {
  id: "acme-home",
  channel: "web",
  template: "MarketingView",
  meta: {
    channel: "web",
    title: "Acme — do the thing",
    description: "Acme helps teams do the thing, faster.",
    canonical: "https://acme.example/",
    keywords: ["acme", "thing"],
    og: { title: "Acme", description: "Do the thing.", image: "https://acme.example/og.png", type: "website" },
    twitter: { card: "summary_large_image", site: "@acme" },
  },
  bindings: [
    { slot: "heading", copyId: "home.heading" },
    { slot: "subheading", value: "A literal, non-registry subheading." },
  ],
};

const validEmail: ComposeDocument = {
  id: "acme-welcome-email",
  channel: "email",
  template: "WelcomeEmail",
  meta: {
    channel: "email",
    subject: "Welcome to Acme",
    preheader: "Everything you need to get started.",
    replyTo: "hello@acme.example",
  },
  bindings: [{ slot: "body", copyId: "welcome.body" }],
};

const validPrintLayout: LayoutSpec = {
  background: { color: "surface-primary" },
  slots: [
    { key: "heading", element: "heading", frame: { x: 0.1, y: 0.1, w: 0.8, h: 0.15 }, required: true },
    { key: "body", element: "body", frame: { x: 0.1, y: 0.3, w: 0.8, h: 0.5 }, align: "start", vAlign: "top" },
  ],
};

const validPrint: ComposeDocument = {
  id: "acme-one-pager",
  channel: "print",
  template: "OnePagerTemplate",
  meta: {
    channel: "print",
    pageSize: "Letter",
    orientation: "portrait",
    margins: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
    cropMarks: false,
    dpi: 300,
  },
  bindings: [
    { slot: "heading", copyId: "one-pager.heading" },
    { slot: "body", value: "A literal body paragraph." },
  ],
  layout: validPrintLayout,
};

const validSlidesLayout: LayoutSpec = {
  slots: [{ key: "title", element: "heading", frame: { x: 0.05, y: 0.05, w: 0.9, h: 0.2 }, required: true }],
};

const validSlides: ComposeDocument = {
  id: "acme-deck-slide-1",
  channel: "slides",
  template: "TitleSlide",
  meta: { channel: "slides", aspect: "16:9", notes: { presenter: "Pause here." } },
  bindings: [{ slot: "title", copyId: "deck.title" }],
  layout: validSlidesLayout,
};

const validImageLayout: LayoutSpec = {
  slots: [{ key: "headline", element: "heading", frame: { x: 0.1, y: 0.4, w: 0.8, h: 0.2 }, required: true }],
};

const validImage: ComposeDocument = {
  id: "acme-og-card",
  channel: "image",
  template: "OgCardTemplate",
  meta: { channel: "image", width: 1200, height: 630, format: "png", scale: 2, alt: "Acme — do the thing" },
  bindings: [{ slot: "headline", copyId: "og.headline" }],
  layout: validImageLayout,
};

function hasRule(findings: ReturnType<typeof validateComposeDocument>, rule: string, path?: string): boolean {
  return findings.some((f) => f.rule === rule && (path === undefined || f.path === path));
}

describe("validateComposeDocument — clean documents", () => {
  it("returns zero findings for a well-formed web document", () => {
    expect(validateComposeDocument(validWeb)).toEqual([]);
  });
  it("returns zero findings for a well-formed email document", () => {
    expect(validateComposeDocument(validEmail)).toEqual([]);
  });
  it("returns zero findings for a well-formed print document", () => {
    expect(validateComposeDocument(validPrint)).toEqual([]);
  });
  it("returns zero findings for a well-formed slides document", () => {
    expect(validateComposeDocument(validSlides)).toEqual([]);
  });
  it("returns zero findings for a well-formed image document", () => {
    expect(validateComposeDocument(validImage)).toEqual([]);
  });
});

describe("validateComposeDocument — never throws, always fails closed on a non-object", () => {
  it("reports document-shape for null, a string, an array, a number, and undefined", () => {
    for (const bad of [null, "not an object", [], 42, undefined]) {
      expect(() => validateComposeDocument(bad)).not.toThrow();
      const findings = validateComposeDocument(bad);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.every((f) => f.severity === "error")).toBe(true);
      expect(hasRule(findings, "document-shape", "$")).toBe(true);
    }
  });
});

describe("validateComposeDocument — root fields", () => {
  it("flags a missing id with id-shape", () => {
    const findings = validateComposeDocument({ ...validWeb, id: undefined });
    expect(hasRule(findings, "id-shape", "id")).toBe(true);
  });

  it("flags an unknown channel with channel-known — sample: 'fax' is not a real Channel", () => {
    const findings = validateComposeDocument({ ...validWeb, channel: "fax" });
    const finding = findings.find((f) => f.rule === "channel-known");
    expect(finding).toMatchObject({ severity: "error", path: "channel" });
    expect(finding?.message).toContain("fax");
  });

  it("flags a missing template with template-shape", () => {
    const findings = validateComposeDocument({ ...validWeb, template: "" });
    expect(hasRule(findings, "template-shape", "template")).toBe(true);
  });

  it("flags a non-array bindings with bindings-shape", () => {
    const findings = validateComposeDocument({ ...validWeb, bindings: "nope" });
    expect(hasRule(findings, "bindings-shape", "bindings")).toBe(true);
  });
});

describe("validateComposeDocument — SlotBinding: exactly one of copyId/value", () => {
  it("flags a binding with neither copyId nor value", () => {
    const findings = validateComposeDocument({ ...validWeb, bindings: [{ slot: "heading" }] });
    const finding = findings.find((f) => f.rule === "binding-source-exclusive");
    expect(finding).toMatchObject({ severity: "error", path: "bindings.0" });
    expect(finding?.message).toContain("neither");
  });

  it("flags a binding with both copyId and value", () => {
    const findings = validateComposeDocument({
      ...validWeb,
      bindings: [{ slot: "heading", copyId: "home.heading", value: "literal too" }],
    });
    const finding = findings.find((f) => f.rule === "binding-source-exclusive");
    expect(finding).toMatchObject({ severity: "error", path: "bindings.0" });
    expect(finding?.message).toContain("both");
  });

  it("flags a missing/empty slot with binding-slot-shape", () => {
    const findings = validateComposeDocument({ ...validWeb, bindings: [{ slot: "", copyId: "x" }] });
    expect(hasRule(findings, "binding-slot-shape", "bindings.0.slot")).toBe(true);
  });

  it("flags an empty copyId with binding-copy-id-shape", () => {
    const findings = validateComposeDocument({ ...validWeb, bindings: [{ slot: "heading", copyId: "" }] });
    expect(hasRule(findings, "binding-copy-id-shape", "bindings.0.copyId")).toBe(true);
  });

  it("flags an empty value with binding-value-shape", () => {
    const findings = validateComposeDocument({ ...validWeb, bindings: [{ slot: "heading", value: "" }] });
    expect(hasRule(findings, "binding-value-shape", "bindings.0.value")).toBe(true);
  });

  it("accepts a well-formed binding with only copyId, and one with only value", () => {
    const findings = validateComposeDocument({
      ...validWeb,
      bindings: [
        { slot: "heading", copyId: "home.heading" },
        { slot: "subheading", value: "literal" },
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe("validateComposeDocument — meta/channel discriminant", () => {
  it("flags meta.channel disagreeing with channel, as meta-channel-mismatch", () => {
    const findings = validateComposeDocument({ ...validWeb, meta: { ...validEmail.meta } });
    const finding = findings.find((f) => f.rule === "meta-channel-mismatch");
    expect(finding).toMatchObject({ severity: "error", path: "meta.channel" });
    expect(finding?.message).toContain("email");
    expect(finding?.message).toContain("web");
  });

  it("flags a non-object meta with meta-shape", () => {
    const findings = validateComposeDocument({ ...validWeb, meta: "nope" });
    expect(hasRule(findings, "meta-shape", "meta")).toBe(true);
  });

  it("flags an unknown meta.channel with meta-channel-known", () => {
    const findings = validateComposeDocument({ ...validWeb, meta: { ...validWeb.meta, channel: "fax" } });
    expect(hasRule(findings, "meta-channel-known", "meta.channel")).toBe(true);
  });
});

describe("validateComposeDocument — WebMeta shape", () => {
  it("flags a missing title with web-title-shape", () => {
    const findings = validateComposeDocument({ ...validWeb, meta: { ...validWeb.meta, title: undefined } });
    expect(hasRule(findings, "web-title-shape", "meta.title")).toBe(true);
  });
  it("flags a missing description with web-description-shape", () => {
    const findings = validateComposeDocument({ ...validWeb, meta: { ...validWeb.meta, description: "" } });
    expect(hasRule(findings, "web-description-shape", "meta.description")).toBe(true);
  });
  it("flags non-string keywords entries with web-keywords-shape", () => {
    const findings = validateComposeDocument({ ...validWeb, meta: { ...validWeb.meta, keywords: ["ok", 5] } });
    expect(hasRule(findings, "web-keywords-shape", "meta.keywords")).toBe(true);
  });
  it("flags a malformed og.title with web-og-field-shape", () => {
    const findings = validateComposeDocument({ ...validWeb, meta: { ...validWeb.meta, og: { title: "" } } });
    expect(hasRule(findings, "web-og-field-shape", "meta.og.title")).toBe(true);
  });
  it("flags an unknown twitter.card with web-twitter-card-known", () => {
    const findings = validateComposeDocument({ ...validWeb, meta: { ...validWeb.meta, twitter: { card: "huge" } } });
    expect(hasRule(findings, "web-twitter-card-known", "meta.twitter.card")).toBe(true);
  });
  it("flags a non-array jsonLd with web-json-ld-shape", () => {
    const findings = validateComposeDocument({ ...validWeb, meta: { ...validWeb.meta, jsonLd: "nope" } });
    expect(hasRule(findings, "web-json-ld-shape", "meta.jsonLd")).toBe(true);
  });
});

describe("validateComposeDocument — EmailMeta shape", () => {
  it("flags a missing subject with email-subject-shape", () => {
    const findings = validateComposeDocument({ ...validEmail, meta: { ...validEmail.meta, subject: "" } });
    expect(hasRule(findings, "email-subject-shape", "meta.subject")).toBe(true);
  });

  it("flags a missing preheader with email-preheader-shape", () => {
    const findings = validateComposeDocument({ ...validEmail, meta: { ...validEmail.meta, preheader: undefined } });
    expect(hasRule(findings, "email-preheader-shape", "meta.preheader")).toBe(true);
  });

  it("flags a preheader over 140 characters with email-preheader-length — sample message", () => {
    const tooLong = "x".repeat(141);
    const findings = validateComposeDocument({ ...validEmail, meta: { ...validEmail.meta, preheader: tooLong } });
    const finding = findings.find((f) => f.rule === "email-preheader-length");
    expect(finding).toMatchObject({ severity: "error", path: "meta.preheader" });
    expect(finding?.message).toBe("meta.preheader must be at most 140 characters, got 141.");
  });

  it("accepts a preheader at exactly 140 characters", () => {
    const exact = "x".repeat(140);
    const findings = validateComposeDocument({ ...validEmail, meta: { ...validEmail.meta, preheader: exact } });
    expect(findings.some((f) => f.rule === "email-preheader-length")).toBe(false);
  });
});

describe("validateComposeDocument — PrintMeta shape", () => {
  it("flags an unknown pageSize with print-page-size-known", () => {
    const findings = validateComposeDocument({ ...validPrint, meta: { ...validPrint.meta, pageSize: "A5" } });
    expect(hasRule(findings, "print-page-size-known", "meta.pageSize")).toBe(true);
  });
  it("flags an unknown orientation with print-orientation-known", () => {
    const findings = validateComposeDocument({ ...validPrint, meta: { ...validPrint.meta, orientation: "diagonal" } });
    expect(hasRule(findings, "print-orientation-known", "meta.orientation")).toBe(true);
  });
  it("flags a missing margins.left with print-margin-field-shape", () => {
    const findings = validateComposeDocument({
      ...validPrint,
      meta: { ...validPrint.meta, margins: { top: "1in", right: "1in", bottom: "1in", left: "" } },
    });
    expect(hasRule(findings, "print-margin-field-shape", "meta.margins.left")).toBe(true);
  });
  it("flags a non-positive dpi with print-dpi-shape", () => {
    const findings = validateComposeDocument({ ...validPrint, meta: { ...validPrint.meta, dpi: 0 } });
    expect(hasRule(findings, "print-dpi-shape", "meta.dpi")).toBe(true);
  });
});

describe("validateComposeDocument — SlidesMeta shape", () => {
  it("flags an unknown aspect with slides-aspect-known", () => {
    const findings = validateComposeDocument({ ...validSlides, meta: { ...validSlides.meta, aspect: "1:1" } });
    expect(hasRule(findings, "slides-aspect-known", "meta.aspect")).toBe(true);
  });
  it("flags non-string notes values with slides-notes-shape", () => {
    const findings = validateComposeDocument({ ...validSlides, meta: { ...validSlides.meta, notes: { presenter: 5 } } });
    expect(hasRule(findings, "slides-notes-shape", "meta.notes")).toBe(true);
  });
});

describe("validateComposeDocument — ImageMeta shape", () => {
  it("flags a non-positive width with image-width-positive", () => {
    const findings = validateComposeDocument({ ...validImage, meta: { ...validImage.meta, width: 0 } });
    expect(hasRule(findings, "image-width-positive", "meta.width")).toBe(true);
  });
  it("flags a non-positive height with image-height-positive", () => {
    const findings = validateComposeDocument({ ...validImage, meta: { ...validImage.meta, height: -1 } });
    expect(hasRule(findings, "image-height-positive", "meta.height")).toBe(true);
  });
  it("flags an unknown format with image-format-known", () => {
    const findings = validateComposeDocument({ ...validImage, meta: { ...validImage.meta, format: "bmp" } });
    expect(hasRule(findings, "image-format-known", "meta.format")).toBe(true);
  });
  it("flags an unknown scale with image-scale-known", () => {
    const findings = validateComposeDocument({ ...validImage, meta: { ...validImage.meta, scale: 3 } });
    expect(hasRule(findings, "image-scale-known", "meta.scale")).toBe(true);
  });
  it("flags a missing alt with image-alt-shape", () => {
    const findings = validateComposeDocument({ ...validImage, meta: { ...validImage.meta, alt: "" } });
    expect(hasRule(findings, "image-alt-shape", "meta.alt")).toBe(true);
  });
});

describe("validateComposeDocument — layout is channel-gated", () => {
  it("flags a layout on a web document with layout-forbidden — sample message", () => {
    const findings = validateComposeDocument({ ...validWeb, layout: validPrintLayout });
    const finding = findings.find((f) => f.rule === "layout-forbidden");
    expect(finding).toMatchObject({ severity: "error", path: "layout" });
    expect(finding?.message).toBe(
      'layout must be absent for channel "web" — web is a flowed channel with no absolute positioning.',
    );
  });

  it("flags a layout on an email document with layout-forbidden", () => {
    const findings = validateComposeDocument({ ...validEmail, layout: validPrintLayout });
    expect(hasRule(findings, "layout-forbidden", "layout")).toBe(true);
  });

  it("flags a missing layout on a print document with layout-required — sample message", () => {
    const findings = validateComposeDocument({ ...validPrint, layout: undefined });
    const finding = findings.find((f) => f.rule === "layout-required");
    expect(finding).toMatchObject({ severity: "error", path: "layout" });
    expect(finding?.message).toBe('layout is required for channel "print".');
  });

  it("flags a missing layout on a slides document with layout-required", () => {
    const findings = validateComposeDocument({ ...validSlides, layout: undefined });
    expect(hasRule(findings, "layout-required", "layout")).toBe(true);
  });

  it("flags a missing layout on an image document with layout-required", () => {
    const findings = validateComposeDocument({ ...validImage, layout: undefined });
    expect(hasRule(findings, "layout-required", "layout")).toBe(true);
  });
});

describe("validateComposeDocument — LayoutSpec/SlotSpec shape", () => {
  it("flags a non-array slots with slots-shape", () => {
    const findings = validateComposeDocument({ ...validPrint, layout: { slots: "nope" } });
    expect(hasRule(findings, "slots-shape", "layout.slots")).toBe(true);
  });

  it("flags a missing slot key with slot-key-shape", () => {
    const findings = validateComposeDocument({
      ...validPrint,
      layout: { slots: [{ element: "heading", frame: { x: 0, y: 0, w: 1, h: 1 } }] },
    });
    expect(hasRule(findings, "slot-key-shape", "layout.slots.0.key")).toBe(true);
  });

  it("flags an unknown element with slot-element-known", () => {
    const findings = validateComposeDocument({
      ...validPrint,
      layout: { slots: [{ key: "x", element: "video", frame: { x: 0, y: 0, w: 1, h: 1 } }] },
    });
    expect(hasRule(findings, "slot-element-known", "layout.slots.0.element")).toBe(true);
  });

  it("flags duplicate slot keys with slot-key-unique — sample message", () => {
    const findings = validateComposeDocument({
      ...validPrint,
      layout: {
        slots: [
          { key: "dup", element: "heading", frame: { x: 0, y: 0, w: 0.4, h: 0.4 } },
          { key: "dup", element: "body", frame: { x: 0.5, y: 0.5, w: 0.4, h: 0.4 } },
        ],
      },
    });
    const finding = findings.find((f) => f.rule === "slot-key-unique");
    expect(finding).toMatchObject({ severity: "error", path: "layout.slots.1.key" });
    expect(finding?.message).toBe(
      'layout.slots.1.key "dup" duplicates layout.slots.0.key — every slot key must be unique within a LayoutSpec.',
    );
  });

  it("flags an unknown align with slot-align-known and an unknown vAlign with slot-valign-known", () => {
    const findings = validateComposeDocument({
      ...validPrint,
      layout: {
        slots: [
          { key: "x", element: "heading", frame: { x: 0, y: 0, w: 1, h: 1 }, align: "middle", vAlign: "center" },
        ],
      },
    });
    expect(hasRule(findings, "slot-align-known", "layout.slots.0.align")).toBe(true);
    expect(hasRule(findings, "slot-valign-known", "layout.slots.0.vAlign")).toBe(true);
  });

  it("flags a non-boolean required with slot-required-shape", () => {
    const findings = validateComposeDocument({
      ...validPrint,
      layout: { slots: [{ key: "x", element: "heading", frame: { x: 0, y: 0, w: 1, h: 1 }, required: "yes" }] },
    });
    expect(hasRule(findings, "slot-required-shape", "layout.slots.0.required")).toBe(true);
  });

  it("flags a non-empty-string style field with style-binding-field-shape", () => {
    const findings = validateComposeDocument({
      ...validPrint,
      layout: {
        slots: [
          { key: "x", element: "heading", frame: { x: 0, y: 0, w: 1, h: 1 }, style: { color: 5 } },
        ],
      },
    });
    expect(hasRule(findings, "style-binding-field-shape", "layout.slots.0.style.color")).toBe(true);
  });
});

describe("validateComposeDocument — Frame: 0..1 range, nonzero area, in bounds", () => {
  it("flags a non-numeric frame field with frame-field-shape", () => {
    const findings = validateComposeDocument({
      ...validPrint,
      layout: { slots: [{ key: "x", element: "heading", frame: { x: "0", y: 0, w: 1, h: 1 } }] },
    });
    expect(hasRule(findings, "frame-field-shape", "layout.slots.0.frame.x")).toBe(true);
  });

  it("flags a frame field outside 0..1 with frame-field-range — sample: w = 1.5", () => {
    const findings = validateComposeDocument({
      ...validPrint,
      layout: { slots: [{ key: "x", element: "heading", frame: { x: 0, y: 0, w: 1.5, h: 0.5 } }] },
    });
    const finding = findings.find((f) => f.rule === "frame-field-range");
    expect(finding).toMatchObject({ severity: "error", path: "layout.slots.0.frame.w" });
    expect(finding?.message).toBe("layout.slots.0.frame.w must be within 0..1 (a fraction of the canvas), got 1.5.");
  });

  it("flags a negative frame field with frame-field-range", () => {
    const findings = validateComposeDocument({
      ...validPrint,
      layout: { slots: [{ key: "x", element: "heading", frame: { x: -0.1, y: 0, w: 0.5, h: 0.5 } }] },
    });
    expect(hasRule(findings, "frame-field-range", "layout.slots.0.frame.x")).toBe(true);
  });

  it("flags a zero-width frame with frame-zero-area — sample message", () => {
    const findings = validateComposeDocument({
      ...validPrint,
      layout: { slots: [{ key: "x", element: "heading", frame: { x: 0.1, y: 0.1, w: 0, h: 0.5 } }] },
    });
    const finding = findings.find((f) => f.rule === "frame-zero-area");
    expect(finding).toMatchObject({ severity: "error", path: "layout.slots.0.frame" });
    expect(finding?.message).toBe("layout.slots.0.frame must have nonzero area (w * h > 0), got w=0, h=0.5.");
  });

  it("flags a frame extending past the right/bottom edge with frame-out-of-bounds — sample message", () => {
    const findings = validateComposeDocument({
      ...validPrint,
      layout: { slots: [{ key: "x", element: "heading", frame: { x: 0.7, y: 0.1, w: 0.5, h: 0.2 } }] },
    });
    const finding = findings.find((f) => f.rule === "frame-out-of-bounds");
    expect(finding).toMatchObject({ severity: "error", path: "layout.slots.0.frame" });
    expect(finding?.message).toBe(
      "layout.slots.0.frame.x + layout.slots.0.frame.w must not exceed 1 (the frame must fit within the canvas), got x=0.7, w=0.5, x+w=1.2.",
    );
  });

  it("accepts a frame flush against the canvas edge (x + w === 1 exactly)", () => {
    const findings = validateComposeDocument({
      ...validPrint,
      layout: { slots: [{ key: "x", element: "heading", frame: { x: 0.5, y: 0, w: 0.5, h: 1 } }] },
    });
    expect(findings.some((f) => f.rule === "frame-out-of-bounds")).toBe(false);
  });
});
