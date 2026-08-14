import { describe, expect, it } from "vitest";
import { createOutputManifest } from "./output-manifest.js";
import { isSurfaceRepeatingSlotBinding, validateSurfaceDocument } from "./validate.js";
import type { SurfaceDocument } from "./types.js";

const ref = (id: string) => ({ id });

const validWeb: SurfaceDocument = {
  id: "account.sign-in",
  channel: "web",
  meta: { channel: "web", title: ref("account.sign-in.title"), description: ref("account.sign-in.description") },
  template: "AuthView",
  bindings: [
    { slot: "heading", copy: ref("account.sign-in.heading") },
    { slot: "form", node: { kind: "consumer-form" } },
  ],
};

describe("SurfaceDocument", () => {
  it("accepts CopyRef-based flowed metadata and explicit caller nodes without a canvas layout", () => {
    expect(validateSurfaceDocument(validWeb)).toEqual([]);
  });

  it("rejects literal audience-facing metadata and an ambiguous content binding", () => {
    const findings = validateSurfaceDocument({
      ...validWeb,
      meta: { ...validWeb.meta, title: "Sign in" },
      bindings: [{ slot: "heading", copy: ref("account.sign-in.heading"), node: "not-a-node-binding" }],
    });
    expect(findings.map((finding) => finding.rule)).toEqual(expect.arrayContaining(["copy-ref-shape", "surface-binding-source-exclusive", "surface-node-shape"]));
  });

  it("does not let a primitive node bypass copy ownership", () => {
    const findings = validateSurfaceDocument({ ...validWeb, bindings: [{ slot: "heading", node: "literal copy" }] });
    expect(findings.map((finding) => finding.rule)).toContain("surface-node-shape");
  });

  it("requires CopyRefs for image alt text and slide notes", () => {
    const image: SurfaceDocument = {
      id: "social.card",
      channel: "image",
      meta: { channel: "image", width: 1200, height: 630, format: "svg", alt: ref("social.card.alt") },
      template: "social-card",
      bindings: [{ slot: "headline", copy: ref("social.card.headline") }],
      layout: { slots: [{ key: "headline", element: "heading", frame: { x: 0, y: 0, w: 1, h: 1 } }] },
    };
    expect(validateSurfaceDocument(image)).toEqual([]);
    expect(validateSurfaceDocument({ ...image, meta: { ...image.meta, alt: "literal alt" } }).map((finding) => finding.rule)).toContain("copy-ref-shape");
  });
});

describe("SurfaceRepeatingSlotBinding", () => {
  const capabilityGrid: SurfaceDocument = {
    ...validWeb,
    bindings: [
      ...validWeb.bindings,
      {
        slot: "capabilities",
        items: [
          { copy: ref("acme.capability.one") },
          { copy: ref("acme.capability.two") },
          { assetId: "acme.capability.icon.three" },
        ],
      },
    ],
  };

  it("accepts an ordered list of items, each independently obeying the exactly-one-of-copy/node/assetId rule", () => {
    expect(validateSurfaceDocument(capabilityGrid)).toEqual([]);
  });

  it("distinguishes a repeating-group binding from a single-source binding by the presence of items, never a kind tag", () => {
    expect(isSurfaceRepeatingSlotBinding(capabilityGrid.bindings[2]!)).toBe(true);
    expect(isSurfaceRepeatingSlotBinding(capabilityGrid.bindings[0]!)).toBe(false);
  });

  it("accepts an explicit empty group as valid — a legitimately-empty repeating list is not a finding", () => {
    const emptyGroup: SurfaceDocument = { ...validWeb, bindings: [...validWeb.bindings, { slot: "testimonials", items: [] }] };
    expect(validateSurfaceDocument(emptyGroup)).toEqual([]);
  });

  it("rejects a group binding that also sets copy/node/assetId on the binding itself", () => {
    const findings = validateSurfaceDocument({
      ...validWeb,
      bindings: [...validWeb.bindings, { slot: "capabilities", copy: ref("acme.stray"), items: [{ copy: ref("acme.capability.one") }] }],
    });
    expect(findings.map((finding) => finding.rule)).toContain("surface-binding-group-exclusive");
  });

  it("rejects a non-array items field", () => {
    const findings = validateSurfaceDocument({ ...validWeb, bindings: [...validWeb.bindings, { slot: "capabilities", items: "not-an-array" }] });
    expect(findings.map((finding) => finding.rule)).toContain("surface-binding-group-items-shape");
  });

  it("attributes a bad item to its own index, not just the slot, and does not discard findings for sibling items", () => {
    const findings = validateSurfaceDocument({
      ...validWeb,
      bindings: [
        ...validWeb.bindings,
        {
          slot: "capabilities",
          items: [
            { copy: ref("acme.capability.one") },
            { copy: ref("acme.capability.two"), assetId: "acme.capability.icon.two" },
            { copy: ref("acme.capability.three") },
          ],
        },
      ],
    });
    const groupItemFinding = findings.find((finding) => finding.rule === "surface-binding-group-item-source-exclusive");
    expect(groupItemFinding?.path).toBe("bindings.2.items.1");
    // The malformed item's finding does not erase the fact that items 0 and
    // 2 are themselves well-formed — no finding names them.
    expect(findings.some((finding) => finding.path?.startsWith("bindings.2.items.0"))).toBe(false);
    expect(findings.some((finding) => finding.path?.startsWith("bindings.2.items.2"))).toBe(false);
  });

  it("rejects a primitive item entry and a whitespace-only assetId the same way a single binding would", () => {
    const findings = validateSurfaceDocument({ ...validWeb, bindings: [...validWeb.bindings, { slot: "capabilities", items: ["not-an-object", { assetId: "" }] }] });
    expect(findings.map((finding) => finding.rule)).toEqual(expect.arrayContaining(["surface-binding-group-item-shape", "binding-asset-id-shape"]));
  });
});

describe("OutputManifest", () => {
  it("copies artifact records so publication owns no renderer state", () => {
    const artifacts = [{ id: "page", path: "site/account/sign-in.html", mediaType: "text/html", role: "page" }];
    const manifest = createOutputManifest("account.sign-in", "web", artifacts, {
      strategyId: "product",
      revision: "2026-08-11",
      records: [{ kind: "fact", id: "product.category", revision: "1" }],
      fingerprint: "sha256:example",
    });
    artifacts[0]!.path = "changed.html";
    expect(manifest).toEqual({ surfaceId: "account.sign-in", channel: "web", artifacts: [{ id: "page", path: "site/account/sign-in.html", mediaType: "text/html", role: "page" }], provenance: { strategyId: "product", revision: "2026-08-11", records: [{ kind: "fact", id: "product.category", revision: "1" }], fingerprint: "sha256:example" } });
  });
});
