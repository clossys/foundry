import { describe, expect, it } from "vitest";
import { collectCopyProvenance, createResolvedOutputManifest } from "./output-manifest.js";
import type { ResolvedSurfaceDocument } from "./resolve-surface.js";
import type { SurfaceDocument } from "./types.js";

const surface: SurfaceDocument = {
  id: "reference.page",
  channel: "web",
  meta: { channel: "web", title: { id: "reference.title" }, description: { id: "reference.description" } },
  template: "AuthView",
  bindings: [{ slot: "heading", copy: { id: "reference.heading" } }],
};

const resolved: ResolvedSurfaceDocument = {
  document: {
    id: surface.id,
    channel: "web",
    meta: { channel: "web", title: "Title", description: "Description" },
    template: surface.template,
    bindings: [{ slot: "heading", value: "Heading" }],
  },
  resolutions: [
    { ref: { id: "reference.heading", values: { name: "Ada" } }, text: "Hello Ada", recordId: "zeta", revision: "2", locale: "en", source: { kind: "consumer", reference: "editorial/zeta" }, entryId: "reference.heading" },
    { ref: { id: "reference.description" }, text: "Description", recordId: "alpha", revision: "1", locale: "en", source: { kind: "generated", reference: "editorial/alpha" }, entryId: "reference.description" },
    { ref: { id: "reference.heading", values: { name: "Grace" } }, text: "Hello Grace", recordId: "zeta", revision: "2", locale: "en", source: { kind: "consumer", reference: "editorial/zeta" }, entryId: "reference.heading" },
  ],
};

describe("copy provenance in output manifests", () => {
  it("groups and sorts registry provenance without retaining resolved text or interpolation values", () => {
    expect(collectCopyProvenance(resolved.resolutions)).toEqual([
      { recordId: "alpha", revision: "1", locale: "en", source: { kind: "generated", reference: "editorial/alpha" }, entryIds: ["reference.description"] },
      { recordId: "zeta", revision: "2", locale: "en", source: { kind: "consumer", reference: "editorial/zeta" }, entryIds: ["reference.heading"] },
    ]);

    const manifest = createResolvedOutputManifest(surface, resolved, [{ id: "page", path: "reference/page.html", mediaType: "text/html" }]);
    expect(manifest.copy).toEqual(collectCopyProvenance(resolved.resolutions));
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain("Ada");
    expect(serialized).not.toContain("Grace");
    expect(serialized).not.toContain("Hello");
  });

  it("rejects a resolution from another canonical surface", () => {
    const foreign: ResolvedSurfaceDocument = { ...resolved, document: { ...resolved.document, id: "foreign.page" } };
    expect(() => createResolvedOutputManifest(surface, foreign, [])).toThrow(/must belong/);
  });
});
