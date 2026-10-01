import { afterEach, describe, expect, it, vi } from "vitest";
import { MESSAGING_KIT_COPY_IDS, resolveMessagingKit } from "./messaging-kit.js";
import { computeCopyFingerprint, COPY_FINGERPRINT_ALGORITHM } from "./fingerprint.js";
import { validateCopyRegistryShape } from "./schema.js";
import type { CopyApproval, CopyRegistry, CopyRegistryEntry } from "./types.js";

const now = new Date("2026-09-27T00:00:00.000Z");

const IDS = [
  "messaging.pitch.one-liner",
  "messaging.pitch.elevator",
  "messaging.pitch.paragraph",
  "messaging.boilerplate.short",
  "messaging.boilerplate.medium",
  "messaging.boilerplate.long",
] as const;

const FIELDS = [
  "pitch.oneLiner",
  "pitch.elevator",
  "pitch.paragraph",
  "boilerplate.short",
  "boilerplate.medium",
  "boilerplate.long",
] as const;

// Word counts 3, 5, 8 and 4, 6, 10: each ladder strictly grows.
const TEXTS = [
  "Example one-liner here",
  "An example elevator pitch text",
  "An example paragraph pitch text that runs longer",
  "Example short boilerplate text",
  "An example medium boilerplate text here",
  "An example long boilerplate text that runs on for longer",
] as const;

function ownerApprovalFor(text: string): CopyApproval {
  return {
    approvedBy: "owner",
    approvedAt: "2026-08-01T00:00:00.000Z",
    textFingerprint: computeCopyFingerprint(text),
    fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
  };
}

function entryAt(index: number, overrides: Partial<CopyRegistryEntry> = {}): CopyRegistryEntry {
  const text = overrides.text ?? TEXTS[index];
  return {
    id: IDS[index],
    text,
    context: "press kit: messaging",
    status: "approved",
    approval: ownerApprovalFor(text),
    ...overrides,
  };
}

function registryOf(entries: CopyRegistryEntry[]): CopyRegistry {
  return {
    id: "example-site",
    locale: "en",
    revision: "2026-09-01",
    source: { kind: "consumer", reference: "editorial/revisions/1" },
    entries,
  };
}

function goodEntries(overrides: Record<number, Partial<CopyRegistryEntry>> = {}): CopyRegistryEntry[] {
  return IDS.map((_, index) => entryAt(index, overrides[index]));
}

describe("reserved ids", () => {
  it("names the six messaging-kit copy ids in order", () => {
    expect(MESSAGING_KIT_COPY_IDS).toEqual(IDS);
  });

  it("uses ids the registry schema accepts", () => {
    expect(validateCopyRegistryShape(registryOf(goodEntries()))).toEqual([]);
  });
});

describe("resolveMessagingKit", () => {
  it("resolves a complete approved kit", { timeout: 5000 }, () => {
    const result = resolveMessagingKit(registryOf(goodEntries()), { now });
    expect(result.complete).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.kit).toEqual({
      pitch: { oneLiner: TEXTS[0], elevator: TEXTS[1], paragraph: TEXTS[2] },
      boilerplate: { short: TEXTS[3], medium: TEXTS[4], long: TEXTS[5] },
    });
    expect(result.resolutions?.pitch.elevator).toMatchObject({
      text: TEXTS[1],
      entryId: "messaging.pitch.elevator",
      recordId: "example-site",
      approval: { approvedBy: "owner", pendingOwnerReview: false },
    });
    expect(result.resolutions?.boilerplate.long).toMatchObject({ text: TEXTS[5], entryId: "messaging.boilerplate.long" });
  });

  it("inherits resolver refusals", { timeout: 5000 }, () => {
    const draft = resolveMessagingKit(registryOf(goodEntries({ 4: { status: "draft", approval: undefined } })), { now });
    expect(draft.complete).toBe(false);
    expect(draft.kit).toBeUndefined();
    expect(draft.resolutions).toBeUndefined();
    expect(draft.issues).toEqual([
      expect.objectContaining({ reason: "copy-not-approved", field: "boilerplate.medium", id: "messaging.boilerplate.medium" }),
    ]);

    const unknown = resolveMessagingKit(registryOf(goodEntries().filter((entry) => entry.id !== IDS[1])), { now });
    expect(unknown.complete).toBe(false);
    expect(unknown.kit).toBeUndefined();
    expect(unknown.resolutions).toBeUndefined();
    expect(unknown.issues).toEqual([
      expect.objectContaining({ reason: "unknown-copy-id", field: "pitch.elevator", id: "messaging.pitch.elevator" }),
    ]);
  });

  describe("blank and placeholder refused", () => {
    afterEach(() => {
      vi.doUnmock("./resolve.js");
      vi.resetModules();
    });

    it("refuses whitespace-only text the resolver returned as messaging-blank", { timeout: 5000 }, async () => {
      vi.resetModules();
      vi.doMock("./resolve.js", async (importOriginal) => {
        const original = await importOriginal<typeof import("./resolve.js")>();
        return {
          ...original,
          resolveCopyRef: (registry: unknown, ref: { id: string }, options: unknown) => {
            const real = original.resolveCopyRef(registry, ref, options);
            if (ref.id === "messaging.pitch.one-liner" && real.resolution) {
              return { ...real, resolution: { ...real.resolution, text: "   " } };
            }
            return real;
          },
        };
      });
      const mocked = await import("./messaging-kit.js");
      const result = mocked.resolveMessagingKit(registryOf(goodEntries()), { now });
      expect(result.complete).toBe(false);
      expect(result.kit).toBeUndefined();
      expect(result.issues).toEqual([
        expect.objectContaining({ reason: "messaging-blank", field: "pitch.oneLiner", id: "messaging.pitch.one-liner" }),
      ]);
    });

    it("refuses an entry that declares placeholders as messaging-placeholder", { timeout: 5000 }, () => {
      const text = "An example {thing} elevator pitch text";
      const result = resolveMessagingKit(
        registryOf(goodEntries({ 1: { text, placeholders: ["thing"], approval: ownerApprovalFor(text) } })),
        { now },
      );
      expect(result.complete).toBe(false);
      expect(result.kit).toBeUndefined();
      expect(result.issues).toEqual([
        expect.objectContaining({ reason: "messaging-placeholder", field: "pitch.elevator", id: "messaging.pitch.elevator" }),
      ]);
    });

    it("refuses text the resolver would rewrite when no placeholders are declared", { timeout: 5000 }, () => {
      const text = "An example {thing} elevator pitch text";
      const result = resolveMessagingKit(registryOf(goodEntries({ 1: { text, approval: ownerApprovalFor(text) } })), { now });
      expect(result.complete).toBe(false);
      expect(result.kit).toBeUndefined();
      expect(result.resolutions).toBeUndefined();
      expect(result.issues).toEqual([
        expect.objectContaining({ reason: "messaging-placeholder", field: "pitch.elevator", id: "messaging.pitch.elevator" }),
      ]);
    });

    it("refuses a blank entry text through registry validation", { timeout: 5000 }, () => {
      const result = resolveMessagingKit(registryOf(goodEntries({ 0: { text: "   ", approval: undefined } })), { now });
      expect(result.complete).toBe(false);
      expect(result.kit).toBeUndefined();
      expect(result.issues.map((issue) => issue.reason)).toEqual(FIELDS.map(() => "invalid-registry"));
    });
  });

  it("ladder must grow", { timeout: 5000 }, () => {
    // `medium` gets the same word count (4) as `short`.
    const equal = "Another four words here";
    const result = resolveMessagingKit(registryOf(goodEntries({ 4: { text: equal, approval: ownerApprovalFor(equal) } })), { now });
    expect(result.complete).toBe(false);
    expect(result.kit).toBeUndefined();
    expect(result.issues).toEqual([expect.objectContaining({ reason: "messaging-ladder-order", field: "boilerplate.medium" })]);
  });

  it("reports every issue at once", { timeout: 5000 }, () => {
    const registry = registryOf(goodEntries({ 0: { status: "draft", approval: undefined }, 5: { status: "draft", approval: undefined } }));
    const before = JSON.stringify(registry);
    const result = resolveMessagingKit(registry, { now });
    expect(result.complete).toBe(false);
    expect(result.kit).toBeUndefined();
    expect(result.issues.map((issue) => [issue.field, issue.reason])).toEqual([
      ["pitch.oneLiner", "copy-not-approved"],
      ["boilerplate.long", "copy-not-approved"],
    ]);
    expect(JSON.stringify(registry)).toBe(before);
  });

  it("never throws on malformed input", { timeout: 5000 }, () => {
    for (const registry of [undefined, null, 42, "x", {}, { entries: "no" }]) {
      const result = resolveMessagingKit(registry, { now });
      expect(result.complete).toBe(false);
      expect(result.kit).toBeUndefined();
      expect(result.issues.map((issue) => issue.field)).toEqual([...FIELDS]);
    }
    const result = resolveMessagingKit(registryOf(goodEntries()), 5);
    expect(result.complete).toBe(false);
    expect(result.issues.map((issue) => issue.reason)).toEqual(FIELDS.map(() => "invalid-options"));
  });
});
