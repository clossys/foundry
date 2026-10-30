import { describe, expect, it } from "vitest";
import type { CandidateContent } from "../model.js";
import { createContentRevision } from "../revisions.js";
import { contentFixture } from "../validate.test.js";
import { joinStoreRevision, splitStoreRevision } from "./revision.js";

const at = "2026-01-01T00:00:00Z";
function referencedContent(): CandidateContent {
  const content = contentFixture();
  return { ...content, pageMeta: [
    { key: "title", locale: "en", source: "writer", ref: { id: "meta.title", locale: "en", values: { name: "Example", count: 2 } } },
    { key: "description", locale: "en", source: "handwritten", value: "Legacy description" },
  ], composition: { ...content.composition!, sections: [{
    ...content.composition!.sections[0]!, fields: [
      { key: "heading", locale: "en", source: "writer", ref: { id: "body.heading", values: { count: 1 } } },
      { key: "detail", locale: "en", source: "writer", value: "Legacy body" },
    ],
  }] } };
}

describe("stored revision Writer reference identities", () => {
  it("round trips references and arguments with legacy inline copies", () => {
    const snapshot = createContentRevision(referencedContent(), "r1", at);
    const split = splitStoreRevision(snapshot, ["en", "fr"]);
    const serialized = JSON.parse(JSON.stringify(split));
    expect(joinStoreRevision(serialized.revision, serialized.copies, ["en", "fr"])).toEqual(snapshot);
    expect(split.revision.content.pageMeta![0]).toEqual(snapshot.content.pageMeta![0]);
    expect(split.revision.content.pageMeta![1]).not.toHaveProperty("value");
    expect(split.copies.en![0]).not.toHaveProperty("value");
    expect(split.copies.fr).toEqual([]);
  });

  it("rejects sidecar changes to either the reference id or arguments", () => {
    const snapshot = createContentRevision(referencedContent(), "r1", at);
    for (const ref of [{ id: "other.title", values: { count: 2 } }, { id: "meta.title", locale: "en", values: { count: 3, name: "Example" } }]) {
      const split = splitStoreRevision(snapshot, ["en"]);
      const copies = { en: split.copies.en!.map((field, index) => index ? field : { ...field, ref }) };
      expect(() => joinStoreRevision(split.revision, copies, ["en"])).toThrow(/structural field/);
    }
  });

  it("compares argument maps independently of JSON key order and keeps the digest protected", () => {
    const snapshot = createContentRevision(referencedContent(), "r1", at);
    const split = splitStoreRevision(snapshot, ["en"]);
    const copies = { en: split.copies.en!.map((field, index) => index ? field : {
      ...field, ref: { id: "meta.title", locale: "en", values: { count: 2, name: "Example" } },
    }) };
    expect(joinStoreRevision(split.revision, copies, ["en"])).toEqual(snapshot);
    const changed = structuredClone(split.revision);
    Object.assign(changed.content.pageMeta![0], { ref: { id: "changed.title" } });
    Object.assign(copies.en[0]!, { ref: { id: "changed.title" } });
    expect(() => joinStoreRevision(changed, copies, ["en"])).toThrow(/digest/);
  });
});
