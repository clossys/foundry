import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveSiteIdentity,
  SITE_IDENTITY_COPY_IDS,
  SITE_NAME_COPY_ID,
  SITE_TAGLINE_COPY_ID,
} from "./site-identity.js";
import { computeCopyFingerprint, COPY_FINGERPRINT_ALGORITHM } from "./fingerprint.js";
import { validateCopyRegistryShape } from "./schema.js";
import type { CopyApproval, CopyRegistry, CopyRegistryEntry } from "./types.js";

const now = new Date("2026-09-27T00:00:00.000Z");

function ownerApprovalFor(text: string): CopyApproval {
  return {
    approvedBy: "owner",
    approvedAt: "2026-08-01T00:00:00.000Z",
    textFingerprint: computeCopyFingerprint(text),
    fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
  };
}

function delegateApprovalFor(text: string, expiresAt?: string): CopyApproval {
  return {
    approvedBy: "delegate",
    approvedAt: "2026-08-01T00:00:00.000Z",
    textFingerprint: computeCopyFingerprint(text),
    fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
    delegate: { id: "delegate-a", scope: ["site"] },
    pendingOwnerReview: true,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

const NAME_TEXT = "Example Site";
const TAGLINE_TEXT = "An example tagline";

function nameEntry(overrides: Partial<CopyRegistryEntry> = {}): CopyRegistryEntry {
  return {
    id: SITE_NAME_COPY_ID,
    text: NAME_TEXT,
    context: "page metadata: site name",
    status: "approved",
    approval: ownerApprovalFor(NAME_TEXT),
    ...overrides,
  };
}

function taglineEntry(overrides: Partial<CopyRegistryEntry> = {}): CopyRegistryEntry {
  return {
    id: SITE_TAGLINE_COPY_ID,
    text: TAGLINE_TEXT,
    context: "page metadata: site tagline",
    status: "approved",
    approval: ownerApprovalFor(TAGLINE_TEXT),
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

const goodRegistry = (): CopyRegistry => registryOf([nameEntry(), taglineEntry()]);

describe("reserved ids", () => {
  it("names the two site-identity copy ids", () => {
    expect(SITE_NAME_COPY_ID).toBe("site.name");
    expect(SITE_TAGLINE_COPY_ID).toBe("site.tagline");
    expect(SITE_IDENTITY_COPY_IDS).toEqual(["site.name", "site.tagline"]);
  });

  it("uses ids the registry schema accepts", () => {
    expect(validateCopyRegistryShape(goodRegistry())).toEqual([]);
  });
});

describe("resolveSiteIdentity", () => {
  it("resolves an owner-approved name and tagline with provenance for each", () => {
    const result = resolveSiteIdentity(goodRegistry(), { now });
    expect(result.complete).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.identity).toEqual({ name: NAME_TEXT, tagline: TAGLINE_TEXT });
    expect(result.resolutions?.name).toMatchObject({
      text: NAME_TEXT,
      entryId: "site.name",
      recordId: "example-site",
      revision: "2026-09-01",
      locale: "en",
      source: { kind: "consumer", reference: "editorial/revisions/1" },
      approval: { approvedBy: "owner", pendingOwnerReview: false },
    });
    expect(result.resolutions?.tagline).toMatchObject({ text: TAGLINE_TEXT, entryId: "site.tagline" });
  });

  it("resolves approved entries that carry no approval record", () => {
    const result = resolveSiteIdentity(registryOf([nameEntry({ approval: undefined }), taglineEntry({ approval: undefined })]));
    expect(result.complete).toBe(true);
    expect(result.identity).toEqual({ name: NAME_TEXT, tagline: TAGLINE_TEXT });
  });

  it("resolves when the requested locale matches the registry", () => {
    expect(resolveSiteIdentity(goodRegistry(), { locale: "en", now }).complete).toBe(true);
  });

  it("refuses a draft tagline and returns no identity even though the name is fine", () => {
    const result = resolveSiteIdentity(registryOf([nameEntry(), taglineEntry({ status: "draft", approval: undefined })]), { now });
    expect(result.complete).toBe(false);
    expect(result.identity).toBeUndefined();
    expect(result.resolutions).toBeUndefined();
    expect(result.issues).toEqual([expect.objectContaining({ reason: "copy-not-approved", field: "tagline", id: "site.tagline" })]);
  });

  it("refuses a stale tagline whose approval was recorded for older text", () => {
    const stale = taglineEntry({ text: "An edited example tagline", approval: ownerApprovalFor("An old example tagline") });
    const result = resolveSiteIdentity(registryOf([nameEntry(), stale]), { now });
    expect(result.complete).toBe(false);
    expect(result.identity).toBeUndefined();
    expect(result.issues).toEqual([expect.objectContaining({ reason: "approval-stale", field: "tagline" })]);
  });

  it("refuses a missing tagline as unknown-copy-id", () => {
    const result = resolveSiteIdentity(registryOf([nameEntry()]), { now });
    expect(result.complete).toBe(false);
    expect(result.identity).toBeUndefined();
    expect(result.issues).toEqual([expect.objectContaining({ reason: "unknown-copy-id", field: "tagline", id: "site.tagline" })]);
  });

  it("reports one issue per broken field in a single pass", () => {
    const result = resolveSiteIdentity(
      registryOf([nameEntry({ status: "draft", approval: undefined }), taglineEntry({ approval: ownerApprovalFor("An old example tagline") })]),
      { now },
    );
    expect(result.complete).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({ reason: "copy-not-approved", field: "name" }),
      expect.objectContaining({ reason: "approval-stale", field: "tagline" }),
    ]);
  });

  describe("delegate approval", () => {
    const delegateRegistry = (expiresAt?: string) =>
      registryOf([
        nameEntry({ approval: delegateApprovalFor(NAME_TEXT, expiresAt) }),
        taglineEntry({ approval: delegateApprovalFor(TAGLINE_TEXT, expiresAt) }),
      ]);

    it("is refused on production by default, once per field", () => {
      const result = resolveSiteIdentity(delegateRegistry(), { now });
      expect(result.complete).toBe(false);
      expect(result.identity).toBeUndefined();
      expect(result.issues).toEqual([
        expect.objectContaining({ reason: "delegate-approval-refused", field: "name" }),
        expect.objectContaining({ reason: "delegate-approval-refused", field: "tagline" }),
      ]);
    });

    it("resolves on target preview", () => {
      const result = resolveSiteIdentity(delegateRegistry(), { target: "preview", now });
      expect(result.complete).toBe(true);
      expect(result.identity).toEqual({ name: NAME_TEXT, tagline: TAGLINE_TEXT });
      expect(result.resolutions?.name.approval).toEqual({ approvedBy: "delegate", pendingOwnerReview: true });
    });

    it("resolves on production when the caller accepts delegate approval", () => {
      const result = resolveSiteIdentity(delegateRegistry(), { target: "production", acceptDelegateInProduction: true, now });
      expect(result.complete).toBe(true);
    });

    it("is refused once the approval has expired, on preview as well", () => {
      const result = resolveSiteIdentity(delegateRegistry("2026-09-01T00:00:00.000Z"), { target: "preview", now });
      expect(result.complete).toBe(false);
      expect(result.issues.map((issue) => issue.reason)).toEqual(["approval-expired", "approval-expired"]);
    });
  });

  it("refuses a locale mismatch on both fields", () => {
    const result = resolveSiteIdentity(goodRegistry(), { locale: "fr", now });
    expect(result.complete).toBe(false);
    expect(result.identity).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({ reason: "locale-mismatch", field: "name" }),
      expect.objectContaining({ reason: "locale-mismatch", field: "tagline" }),
    ]);
  });

  it("refuses an entry that declares placeholders", () => {
    const text = "Example {thing}";
    const entry = taglineEntry({ text, placeholders: ["thing"], approval: ownerApprovalFor(text) });
    const result = resolveSiteIdentity(registryOf([nameEntry(), entry]), { now });
    expect(result.complete).toBe(false);
    expect(result.identity).toBeUndefined();
    expect(result.issues).toEqual([expect.objectContaining({ reason: "site-identity-placeholder", field: "tagline", id: "site.tagline" })]);
  });

  it("refuses brace text the resolver would rewrite even when no placeholder is declared", () => {
    const text = "Example {thing}";
    const entry = nameEntry({ text, approval: ownerApprovalFor(text) });
    const result = resolveSiteIdentity(registryOf([entry, taglineEntry()]), { now });
    expect(result.complete).toBe(false);
    expect(result.issues).toEqual([expect.objectContaining({ reason: "site-identity-placeholder", field: "name" })]);
  });

  it("refuses a blank entry text (rejected by registry validation)", () => {
    const result = resolveSiteIdentity(registryOf([nameEntry({ text: "   ", approval: undefined }), taglineEntry()]), { now });
    expect(result.complete).toBe(false);
    expect(result.identity).toBeUndefined();
    expect(result.issues.map((issue) => issue.reason)).toEqual(["invalid-registry", "invalid-registry"]);
  });

  describe("blank resolved text", () => {
    afterEach(() => {
      vi.doUnmock("./resolve.js");
      vi.resetModules();
    });

    it("is refused even if the resolver returned it", async () => {
      vi.resetModules();
      vi.doMock("./resolve.js", async (importOriginal) => {
        const original = await importOriginal<typeof import("./resolve.js")>();
        return {
          ...original,
          resolveCopyRef: (registry: unknown, ref: { id: string }, options: unknown) => {
            const real = original.resolveCopyRef(registry, ref, options);
            if (ref.id === "site.name" && real.resolution) return { ...real, resolution: { ...real.resolution, text: "  " } };
            return real;
          },
        };
      });
      const mocked = await import("./site-identity.js");
      const result = mocked.resolveSiteIdentity(goodRegistry(), { now });
      expect(result.complete).toBe(false);
      expect(result.identity).toBeUndefined();
      expect(result.issues).toEqual([expect.objectContaining({ reason: "site-identity-blank", field: "name" })]);
    });
  });

  describe("malformed input fails closed without throwing", () => {
    it.each([
      ["null registry", null],
      ["undefined registry", undefined],
      ["empty object registry", {}],
      ["string registry", "registry"],
    ])("%s", (_label, input) => {
      expect(() => resolveSiteIdentity(input, { now })).not.toThrow();
      const result = resolveSiteIdentity(input, { now });
      expect(result.complete).toBe(false);
      expect(result.identity).toBeUndefined();
      expect(result.resolutions).toBeUndefined();
      expect(result.issues).toEqual([
        expect.objectContaining({ reason: "invalid-registry", field: "name" }),
        expect.objectContaining({ reason: "invalid-registry", field: "tagline" }),
      ]);
    });

    it.each([
      ["a number", 42],
      ["a string", "preview"],
      ["null", null],
      ["an array", []],
      ["an unknown target", { target: "staging" }],
      ["a non-boolean acceptDelegateInProduction", { acceptDelegateInProduction: "yes" }],
      ["an invalid date", { now: new Date("not a date") }],
      ["a non-string locale", { locale: 3 }],
      ["an empty locale", { locale: "" }],
    ])("options that are %s", (_label, options) => {
      expect(() => resolveSiteIdentity(goodRegistry(), options)).not.toThrow();
      const result = resolveSiteIdentity(goodRegistry(), options);
      expect(result.complete).toBe(false);
      expect(result.identity).toBeUndefined();
      expect(result.issues).toEqual([
        expect.objectContaining({ reason: "invalid-options", field: "name" }),
        expect.objectContaining({ reason: "invalid-options", field: "tagline" }),
      ]);
    });

    it("options whose property getter throws", () => {
      const hostile = {
        get target(): string {
          throw new Error("boom");
        },
      };
      expect(() => resolveSiteIdentity(goodRegistry(), hostile)).not.toThrow();
      expect(resolveSiteIdentity(goodRegistry(), hostile).complete).toBe(false);
    });

    it("a registry whose entries getter throws", () => {
      const hostile = {
        get entries(): never {
          throw new Error("boom");
        },
      };
      expect(() => resolveSiteIdentity(hostile, { now })).not.toThrow();
      expect(resolveSiteIdentity(hostile, { now }).complete).toBe(false);
    });
  });

  it("ignores unknown option keys rather than forwarding them", () => {
    const result = resolveSiteIdentity(goodRegistry(), { now, somethingElse: true });
    expect(result.complete).toBe(true);
  });

  it("is deterministic and does not mutate the registry", () => {
    const registry = goodRegistry();
    const before = structuredClone(registry);
    const first = resolveSiteIdentity(registry, { now });
    const second = resolveSiteIdentity(registry, { now });
    expect(second).toEqual(first);
    expect(registry).toEqual(before);

    const broken = registryOf([nameEntry({ status: "draft", approval: undefined })]);
    const brokenBefore = structuredClone(broken);
    expect(resolveSiteIdentity(broken, { now })).toEqual(resolveSiteIdentity(broken, { now }));
    expect(broken).toEqual(brokenBefore);
  });
});
