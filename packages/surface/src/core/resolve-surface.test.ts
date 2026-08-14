import { describe, expect, it } from "vitest";
import type { CopyRegistry, CopyResolver } from "@vespeneventures/copy";
import { createCopyResolver } from "@vespeneventures/copy";
import { collectCopyProvenance } from "./output-manifest.js";
import { resolveSurfaceDocument, SurfaceResolutionError } from "./resolve-surface.js";
import type { SurfaceDocument } from "./types.js";

// Minimal, obviously-fictional fixtures — the same "acme" placeholder
// convention this package's other tests already use. Never real product
// copy.

const ref = (id: string) => ({ id });

const registry: CopyRegistry = {
  id: "acme-fixture",
  locale: "en",
  revision: "1",
  source: { kind: "consumer", reference: "fixtures/acme" },
  entries: [
    { id: "acme.title", text: "Acme", context: "fixture", status: "approved" },
    { id: "acme.description", text: "Acme does the thing.", context: "fixture", status: "approved" },
    { id: "acme.heading", text: "Heading", context: "fixture", status: "approved" },
    { id: "acme.capability.one", text: "Capability one", context: "fixture", status: "approved" },
    { id: "acme.capability.two", text: "Capability two", context: "fixture", status: "approved" },
    { id: "acme.capability.three", text: "Capability three", context: "fixture", status: "approved" },
  ],
};

const resolver: CopyResolver = createCopyResolver(registry);

const singleBindingOnly: SurfaceDocument = {
  id: "acme.home",
  channel: "web",
  meta: { channel: "web", title: ref("acme.title"), description: ref("acme.description") },
  template: "AuthView",
  bindings: [{ slot: "heading", copy: ref("acme.heading") }],
};

describe("resolveSurfaceDocument — single-binding backward compatibility", () => {
  it("produces a byte-identical resolution result for an existing single-binding-only document", () => {
    // Pinned fixture — a SurfaceDocument with no repeating-group binding at
    // all. This exact shape (no `groups` key present) is the contract this
    // test protects: adding SurfaceRepeatingSlotBinding must never change
    // what an existing document resolves to.
    const resolved = resolveSurfaceDocument(singleBindingOnly, resolver);
    expect(resolved).toEqual({
      document: {
        id: "acme.home",
        channel: "web",
        meta: { channel: "web", title: "Acme", description: "Acme does the thing." },
        template: "AuthView",
        bindings: [{ slot: "heading", value: "Heading" }],
      },
      resolutions: [
        { ref: { id: "acme.heading" }, text: "Heading", recordId: "acme-fixture", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixtures/acme" }, entryId: "acme.heading" },
        { ref: { id: "acme.title" }, text: "Acme", recordId: "acme-fixture", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixtures/acme" }, entryId: "acme.title" },
        { ref: { id: "acme.description" }, text: "Acme does the thing.", recordId: "acme-fixture", revision: "1", locale: "en", source: { kind: "consumer", reference: "fixtures/acme" }, entryId: "acme.description" },
      ],
    });
    // The pin that actually matters: no `groups` key at all, not even an
    // empty array — see ResolvedSurfaceDocument's own doc comment.
    expect(Object.hasOwn(resolved, "groups")).toBe(false);
    expect(JSON.stringify(resolved)).not.toContain("groups");
  });
});

describe("resolveSurfaceDocument — repeating-group resolution", () => {
  const capabilityGrid: SurfaceDocument = {
    ...singleBindingOnly,
    bindings: [
      ...singleBindingOnly.bindings,
      {
        slot: "capabilities",
        items: [{ copy: ref("acme.capability.one") }, { copy: ref("acme.capability.two") }, { assetId: "acme.capability.icon.three" }],
      },
    ],
  };

  it("resolves every item in order, structured and independently addressable", () => {
    const resolved = resolveSurfaceDocument(capabilityGrid, resolver);
    expect(resolved.groups).toEqual([
      {
        slot: "capabilities",
        items: [
          { index: 0, value: "Capability one" },
          { index: 1, value: "Capability two" },
          { index: 2, assetId: "acme.capability.icon.three" },
        ],
      },
    ]);
    // A repeating-group binding never leaks into the legacy ComposeDocument
    // bindings array — it has no way to represent more than one source.
    expect(resolved.document.bindings.some((binding) => binding.slot === "capabilities")).toBe(false);
  });

  it("resolves a caller-owned node item without lowering it into ComposeDocument", () => {
    const withNode: SurfaceDocument = {
      ...singleBindingOnly,
      bindings: [...singleBindingOnly.bindings, { slot: "capabilities", items: [{ node: { kind: "consumer-icon", name: "bolt" } }] }],
    };
    const resolved = resolveSurfaceDocument(withNode, resolver);
    expect(resolved.groups).toEqual([{ slot: "capabilities", items: [{ index: 0, node: { kind: "consumer-icon", name: "bolt" } }] }]);
  });

  it("resolves an explicit empty group to zero items, not an error", () => {
    const emptyGroup: SurfaceDocument = { ...singleBindingOnly, bindings: [...singleBindingOnly.bindings, { slot: "testimonials", items: [] }] };
    const resolved = resolveSurfaceDocument(emptyGroup, resolver);
    expect(resolved.groups).toEqual([{ slot: "testimonials", items: [] }]);
  });

  it("attributes a bad item's resolution failure to that item, and fails the whole document rather than a partial result", () => {
    const badItem: SurfaceDocument = {
      ...singleBindingOnly,
      bindings: [
        ...singleBindingOnly.bindings,
        {
          slot: "capabilities",
          items: [{ copy: ref("acme.capability.one") }, { copy: ref("acme.capability.missing") }, { copy: ref("acme.capability.three") }],
        },
      ],
    };
    let thrown: unknown;
    try {
      resolveSurfaceDocument(badItem, resolver);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SurfaceResolutionError);
    expect((thrown as SurfaceResolutionError).message).toContain("bindings.1.items.1.copy");
    expect((thrown as SurfaceResolutionError).message).toContain("acme.capability.missing");
  });

  it("collects per-item provenance, not just per-slot, into collectCopyProvenance — no rendered text leaks in", () => {
    const resolved = resolveSurfaceDocument(capabilityGrid, resolver);
    const provenance = collectCopyProvenance(resolved.resolutions);
    const entryIds = provenance.flatMap((entry) => entry.entryIds);
    expect(entryIds).toEqual(expect.arrayContaining(["acme.title", "acme.description", "acme.heading", "acme.capability.one", "acme.capability.two"]));
    // acme.capability.icon.three is an assetId, never resolved through the
    // copy resolver, so it must never appear in provenance.
    expect(entryIds).not.toContain("acme.capability.icon.three");
    expect(JSON.stringify(provenance)).not.toContain("Capability one");
    expect(JSON.stringify(provenance)).not.toContain("Capability two");
  });
});
