import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COPY_FINGERPRINT_ALGORITHM,
  PLACEHOLDER_SENTINEL,
  computeCopyFingerprint,
  createCopyResolver,
} from "@clossys/writer";
import type { CopyApproval, CopyRef, CopyRegistry, CopyRegistryEntry, CopyResolution, CopyResolver } from "@clossys/writer";
import { resolveConsentCopy } from "./resolve.js";
import type { ConsentCopyRefs } from "./resolve.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

const NOW = new Date("2026-09-01T00:00:00.000Z");

const TOP = ["title", "promptLead", "noticeLead", "acceptLabel", "rejectLabel", "privacyLinkLabel"] as const;
const STATUS = ["memoryOnly", "withdrawalFailed", "evidenceUnavailable", "evidenceConflict", "storageUnavailable", "gpcInForce"] as const;
const kebab = (key: string) => key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const ALL_IDS = [...TOP.map((key) => `consent.${kebab(key)}`), ...STATUS.map((key) => `consent.status.${kebab(key)}`)];

const REFS: ConsentCopyRefs = {
  title: { id: "consent.title" },
  promptLead: { id: "consent.prompt-lead" },
  noticeLead: { id: "consent.notice-lead" },
  acceptLabel: { id: "consent.accept-label" },
  rejectLabel: { id: "consent.reject-label" },
  privacyLinkLabel: { id: "consent.privacy-link-label" },
  status: {
    memoryOnly: { id: "consent.status.memory-only" },
    withdrawalFailed: { id: "consent.status.withdrawal-failed" },
    evidenceUnavailable: { id: "consent.status.evidence-unavailable" },
    evidenceConflict: { id: "consent.status.evidence-conflict" },
    storageUnavailable: { id: "consent.status.storage-unavailable" },
    gpcInForce: { id: "consent.status.gpc-in-force" },
  },
};

const textFor = (id: string) => `Approved wording for ${id}.`;

function approval(text: string, extra: Partial<CopyApproval> = {}): CopyApproval {
  return {
    approvedBy: "owner",
    approvedAt: "2026-08-01T00:00:00.000Z",
    textFingerprint: computeCopyFingerprint(text),
    fingerprintAlgorithm: COPY_FINGERPRINT_ALGORITHM,
    ...extra,
  };
}

const DELEGATE: Partial<CopyApproval> = { approvedBy: "delegate", delegate: { id: "delegate-a", scope: ["consent"] }, pendingOwnerReview: true };

/** A registry where every consent entry is owner-approved, with per-entry overrides. */
function registry(
  overrides: Record<string, (entry: CopyRegistryEntry) => CopyRegistryEntry> = {},
  shape: Partial<Pick<CopyRegistry, "locale" | "source">> = {},
): CopyRegistry {
  return {
    id: "consent-registry",
    locale: shape.locale ?? "en",
    revision: "r1",
    source: shape.source ?? { kind: "consumer", reference: "fixture" },
    entries: ALL_IDS.map((id) => {
      const text = textFor(id);
      const entry: CopyRegistryEntry = { id, text, context: "consent notice", status: "approved", approval: approval(text) };
      return overrides[id] ? overrides[id](entry) : entry;
    }),
  };
}

const resolverFor = (reg: CopyRegistry, target: "preview" | "production", extra: { acceptDelegateInProduction?: boolean } = {}) =>
  createCopyResolver(reg, { target, now: NOW, ...extra });

const allDelegate = () =>
  Object.fromEntries(ALL_IDS.map((id) => [id, (entry: CopyRegistryEntry) => ({ ...entry, approval: approval(entry.text, DELEGATE) })]));

function expectRefusal(run: () => unknown, fieldName: string) {
  let error: unknown;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message).toContain(`"${fieldName}"`);
  for (const id of ALL_IDS) expect(message).not.toContain(textFor(id));
  expect(message).not.toContain(PLACEHOLDER_SENTINEL);
}

describe("consent-copy/resolve (P-20)", () => {
  it("resolves every field with its provenance, on preview and production", () => {
    for (const target of ["preview", "production"] as const) {
      const copy = resolveConsentCopy({ resolveCopy: resolverFor(registry(), target), target, refs: REFS, locale: "en" });
      expect(Object.keys(copy).sort()).toEqual([...TOP, "status"].sort());
      expect(Object.keys(copy.status).sort()).toEqual([...STATUS].sort());
      expect(copy.noticeLead).toEqual({
        text: textFor("consent.notice-lead"),
        recordId: "consent-registry",
        entryId: "consent.notice-lead",
        revision: "r1",
        locale: "en",
      });
      expect(copy.status.gpcInForce.text).toBe(textFor("consent.status.gpc-in-force"));
    }
  });

  it.each([...TOP, ...STATUS.map((key) => `status.${key}`)])("requires %s whatever the regime", (path) => {
    const refs = structuredClone(REFS) as unknown as Record<string, Record<string, unknown>>;
    if (path.startsWith("status.")) delete refs.status![path.slice("status.".length)];
    else delete refs[path];
    expectRefusal(
      () => resolveConsentCopy({ resolveCopy: resolverFor(registry(), "preview"), target: "preview", refs: refs as unknown as ConsentCopyRefs, locale: "en" }),
      path,
    );
  });

  it.each([
    ["draft", ({ approval: _approval, ...entry }: CopyRegistryEntry): CopyRegistryEntry => ({ ...entry, status: "draft" })],
    ["stale", (entry: CopyRegistryEntry): CopyRegistryEntry => ({ ...entry, approval: approval("Different approved wording.") })],
    [
      "expired-delegate",
      (entry: CopyRegistryEntry): CopyRegistryEntry => ({ ...entry, approval: approval(entry.text, { ...DELEGATE, expiresAt: "2026-08-15T00:00:00.000Z" }) }),
    ],
  ] as const)("refuses %s copy, naming the field", (_label, override) => {
    const reg = registry({ "consent.notice-lead": override });
    expectRefusal(() => resolveConsentCopy({ resolveCopy: resolverFor(reg, "preview"), target: "preview", refs: REFS, locale: "en" }), "noticeLead");
  });

  it("refuses out-of-scope delegate copy the resolver returns nothing for", () => {
    const inner = resolverFor(registry(allDelegate()), "preview");
    const scoped: CopyResolver = (ref) => (ref.id === "consent.status.evidence-conflict" ? undefined : inner(ref));
    expectRefusal(() => resolveConsentCopy({ resolveCopy: scoped, target: "preview", refs: REFS, locale: "en" }), "status.evidenceConflict");
  });

  it("refuses wrong-locale copy from the registry, from the resolution and from the reference", () => {
    const french = resolverFor(registry({}, { locale: "fr" }), "preview");
    expectRefusal(() => resolveConsentCopy({ resolveCopy: french, target: "preview", refs: REFS, locale: "en" }), "title");

    const inner = resolverFor(registry(), "preview");
    const relabelled: CopyResolver = (ref) => {
      const resolution = inner(ref);
      return resolution && ref.id === "consent.accept-label" ? { ...resolution, locale: "en-GB" } : resolution;
    };
    expectRefusal(() => resolveConsentCopy({ resolveCopy: relabelled, target: "preview", refs: REFS, locale: "en" }), "acceptLabel");

    const refs: ConsentCopyRefs = { ...REFS, rejectLabel: { id: "consent.reject-label", locale: "fr" } };
    expectRefusal(() => resolveConsentCopy({ resolveCopy: inner, target: "preview", refs, locale: "en" }), "rejectLabel");
  });

  it("refuses blank and placeholder text", () => {
    const inner = resolverFor(registry(), "preview");
    const withText =
      (id: string, text: string): CopyResolver =>
      (ref: CopyRef) => {
        const resolution = inner(ref);
        return resolution && ref.id === id ? ({ ...resolution, text } satisfies CopyResolution) : resolution;
      };
    expectRefusal(() => resolveConsentCopy({ resolveCopy: withText("consent.title", "   "), target: "preview", refs: REFS, locale: "en" }), "title");
    expectRefusal(
      () =>
        resolveConsentCopy({
          resolveCopy: withText("consent.status.memory-only", `Saved ${PLACEHOLDER_SENTINEL} here.`),
          target: "preview",
          refs: REFS,
          locale: "en",
        }),
      "status.memoryOnly",
    );
  });

  it("under production refuses unapproved, delegate-approved and generated-source copy", () => {
    const unapproved = registry({ "consent.prompt-lead": (entry) => ({ id: entry.id, text: entry.text, context: entry.context, status: "approved" }) });
    expectRefusal(
      () => resolveConsentCopy({ resolveCopy: resolverFor(unapproved, "production"), target: "production", refs: REFS, locale: "en" }),
      "promptLead",
    );
    // The same record-less entry resolves on preview.
    expect(
      resolveConsentCopy({ resolveCopy: resolverFor(unapproved, "preview"), target: "preview", refs: REFS, locale: "en" }).promptLead.entryId,
    ).toBe("consent.prompt-lead");

    const delegated = resolverFor(registry(allDelegate()), "production", { acceptDelegateInProduction: true });
    expect(delegated({ id: "consent.title" })?.approval?.approvedBy).toBe("delegate");
    expectRefusal(() => resolveConsentCopy({ resolveCopy: delegated, target: "production", refs: REFS, locale: "en" }), "title");

    const generated = registry({}, { source: { kind: "generated", reference: "fixture" } });
    expect(
      resolveConsentCopy({ resolveCopy: resolverFor(generated, "preview"), target: "preview", refs: REFS, locale: "en" }).title.recordId,
    ).toBe("consent-registry");
    expectRefusal(
      () => resolveConsentCopy({ resolveCopy: resolverFor(generated, "production"), target: "production", refs: REFS, locale: "en" }),
      "title",
    );
  });

  it("with NODE_ENV production, a declared preview target throws and preview-bound delegate copy is refused", () => {
    vi.stubEnv("NODE_ENV", "production");
    const previewBound = resolverFor(registry(allDelegate()), "preview");
    expect(() => resolveConsentCopy({ resolveCopy: previewBound, target: "preview", refs: REFS, locale: "en" })).toThrow(/production build/);
    expectRefusal(() => resolveConsentCopy({ resolveCopy: previewBound, target: "production", refs: REFS, locale: "en" }), "title");
    // Owner-approved copy still resolves.
    expect(
      resolveConsentCopy({ resolveCopy: resolverFor(registry(), "production"), target: "production", refs: REFS, locale: "en" }).title.text,
    ).toBe(textFor("consent.title"));
  });

  it("with NODE_ENV absent, or no process global, nothing throws on the read and the declared target decides", () => {
    const previewBound = resolverFor(registry(allDelegate()), "preview");
    vi.stubEnv("NODE_ENV", undefined);
    expect(resolveConsentCopy({ resolveCopy: previewBound, target: "preview", refs: REFS, locale: "en" }).title.text).toBe(
      textFor("consent.title"),
    );
    vi.unstubAllEnvs();

    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "process")!;
    let withoutProcess: unknown;
    let productionWithoutProcess: unknown;
    try {
      Object.defineProperty(globalThis, "process", { value: undefined, configurable: true, writable: true });
      withoutProcess = resolveConsentCopy({ resolveCopy: previewBound, target: "preview", refs: REFS, locale: "en" });
      try {
        resolveConsentCopy({ resolveCopy: previewBound, target: "production", refs: REFS, locale: "en" });
      } catch (error) {
        productionWithoutProcess = error;
      }
    } finally {
      Object.defineProperty(globalThis, "process", descriptor);
    }
    expect((withoutProcess as { title: { text: string } }).title.text).toBe(textFor("consent.title"));
    expect(productionWithoutProcess).toBeInstanceOf(Error);
  });
});
