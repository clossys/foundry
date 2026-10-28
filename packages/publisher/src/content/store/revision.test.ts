import { describe, expect, it } from "vitest";
import type { CopyField } from "../composition.js";
import type { CandidateContent, ContentRevision } from "../model.js";
import { createContentRevision } from "../revisions.js";
import { joinStoreRevision, splitStoreRevision } from "./revision.js";
import type { StoredRevision } from "./revision.js";

const locales = ["en", "fr"];
const at = "2026-01-01T00:00:00Z";
const field = (locale: string, value: string): CopyField => ({ key: "heading", locale, value, source: "writer" });
function content(): CandidateContent {
  return {
    name: "Example", brief: { audience: "Readers", goal: "Inform", keyMessage: "Example", callToAction: "Continue", tone: "Clear", constraints: ["Concise"], sourceAnswers: [{ answer: "Provided" }], version: 1 },
    composition: { frame: { frameId: "frames.example", configId: "default" }, libraryVersion: "1", sections: [
      { key: "intro", sectionId: "sections.example", configId: "default", intent: "continues", fields: [field("fr", "Bonjour"), field("en", "Hello")], assets: [{ assetId: "example", libraryVersion: "1" }] },
      { key: "detail", sectionId: "sections.example", configId: "alternate", intent: "proof", fields: [field("en", ""), field("fr", "Suite")], ref: { candidateId: "example", sectionKey: "source", revision: "r1" } },
    ] },
    links: [{ toSlotId: "documents/docs/next", relation: "next", intent: "Continue", condition: "ready", offset: { page: 2 } }],
    typeSettings: { title: "Example", nested: { enabled: true } }, openQuestions: [{ field: "brief.goal", question: "What follows?", blocking: false }],
  };
}
const snapshot = () => createContentRevision(content(), "r3", at);
const split = () => splitStoreRevision(snapshot(), locales);

describe("stored revision copy sidecars", () => {
  it("round trips all metadata and repeated keys by locale ordinal across sections", () => {
    const original = snapshot();
    const stored = splitStoreRevision(original, locales);
    expect(stored.copies.en).toEqual([field("en", "Hello"), field("en", "")]);
    expect(stored.copies.fr).toEqual([field("fr", "Bonjour"), field("fr", "Suite")]);
    expect(joinStoreRevision(stored.revision, stored.copies, locales)).toEqual(original);
    expect(stored.revision.digest).toBe(original.digest);
    for (const section of stored.revision.content.composition!.sections) {
      for (const identity of section.fields) {
        expect(identity).not.toHaveProperty("value");
        expect(Object.keys(identity).sort()).toEqual(["key", "locale", "source"]);
      }
    }
    const serialized = JSON.parse(JSON.stringify(stored));
    expect(joinStoreRevision(serialized.revision, serialized.copies, locales)).toEqual(original);
  });

  it("emits an empty array for locales with no fields and redirect-only revisions", () => {
    const empty = { ...content(), composition: { ...content().composition!, sections: [] } };
    const { composition: _composition, ...base } = content();
    for (const value of [empty, { ...base, redirectTarget: "/next" }]) {
      const original = createContentRevision(value, "r1", at);
      const stored = splitStoreRevision(original, locales);
      expect(stored.copies).toEqual({ en: [], fr: [] });
      expect(joinStoreRevision(stored.revision, stored.copies, locales)).toEqual(original);
    }
  });

  it("isolates sidecar mutations from the input snapshot", () => {
    const original = snapshot();
    const stored = splitStoreRevision(original, locales);
    (stored.copies.en![0] as { value: string }).value = "Changed";
    expect(original.content.composition!.sections[0]!.fields[1]!.value).toBe("Hello");
    expect(() => joinStoreRevision(stored.revision, stored.copies, locales)).toThrow(/digest/);
  });

  it("rejects modified snapshot digests and structural content", () => {
    expect(() => splitStoreRevision({ ...snapshot(), digest: "changed" }, locales)).toThrow(/digest/);
    const stored = split();
    expect(() => joinStoreRevision({ ...stored.revision, content: { ...stored.revision.content, name: "Changed" } }, stored.copies, locales)).toThrow(/digest/);
    const changed = structuredClone(stored.revision);
    (changed.content.composition!.sections[0]!.fields[0] as unknown as { value: string }).value = "Unexpected";
    expect(() => joinStoreRevision(changed, stored.copies, locales)).toThrow();
  });

  it("rejects missing, extra, reordered, or incorrectly identified copy", () => {
    const stored = split();
    const badCopies = [
      { ...stored.copies, en: stored.copies.en!.slice(1) },
      { ...stored.copies, en: [...stored.copies.en!, field("en", "Extra")] },
      { ...stored.copies, fr: [...stored.copies.fr!].reverse() },
      { ...stored.copies, en: [{ ...stored.copies.en![0]!, key: "other" }, stored.copies.en![1]!] },
      { ...stored.copies, en: [{ ...stored.copies.en![0]!, locale: "fr" }, stored.copies.en![1]!] },
      { ...stored.copies, en: [{ ...stored.copies.en![0]!, source: "other" }, stored.copies.en![1]!] },
      { ...stored.copies, en: [{ ...stored.copies.en![0]!, section: "intro" }, stored.copies.en![1]!] },
    ];
    for (const copies of badCopies) expect(() => joinStoreRevision(stored.revision, copies as typeof stored.copies, locales)).toThrow();
  });

  it("requires exactly the configured locales on both sides", () => {
    const stored = split();
    expect(() => splitStoreRevision(snapshot(), ["en"])).toThrow();
    expect(() => joinStoreRevision(stored.revision, { en: stored.copies.en! }, locales)).toThrow();
    expect(() => joinStoreRevision(stored.revision, { ...stored.copies, de: [] }, locales)).toThrow();
    for (const invalid of [[], ["en", "en"], ["invalid_locale"]]) {
      expect(() => splitStoreRevision(snapshot(), invalid)).toThrow();
      expect(() => joinStoreRevision(stored.revision, stored.copies, invalid)).toThrow();
    }
  });

  it("rejects malformed JSON inputs before traversing nested records", () => {
    const stored = split();
    for (const bad of [null, [], {}, { ...stored.revision, content: null }, { ...stored.revision, content: { composition: { sections: [null] } } }]) {
      expect(() => joinStoreRevision(bad as StoredRevision, stored.copies, locales)).toThrow(TypeError);
    }
    for (const bad of [null, [], {}, { en: null, fr: [] }, { en: [null], fr: [] }]) {
      expect(() => joinStoreRevision(stored.revision, bad as typeof stored.copies, locales)).toThrow(TypeError);
    }
    for (const bad of [null, {}, { ...snapshot(), content: { composition: null } }]) {
      expect(() => splitStoreRevision(bad as ContentRevision, locales)).toThrow(TypeError);
    }
  });
});
