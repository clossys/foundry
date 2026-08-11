import { describe, expect, it } from "vitest";
import { createCopyResolver, resolveCopyRef } from "./resolve.js";
import type { CopyRegistry } from "./types.js";

const registry: CopyRegistry = {
  id: "acme-app",
  locale: "en",
  revision: "2026-08-11",
  source: { kind: "consumer", reference: "editorial/revisions/42" },
  entries: [
    {
      id: "dashboard.welcome",
      text: "Welcome, {name}.",
      context: "dashboard heading",
      placeholders: ["name"],
      status: "approved",
    },
    { id: "dashboard.pending", text: "Pending review", context: "dashboard status", status: "draft" },
  ],
};

describe("resolveCopyRef", () => {
  it("resolves approved copy with deterministic placeholder substitution and provenance", () => {
    const result = resolveCopyRef(registry, { id: "dashboard.welcome", locale: "en", values: { name: "Ada" } });
    expect(result.complete).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.resolution).toMatchObject({
      text: "Welcome, Ada.",
      recordId: "acme-app",
      revision: "2026-08-11",
      locale: "en",
      entryId: "dashboard.welcome",
    });
  });

  it("fails closed for a missing entry, wrong locale, draft entry, and missing parameter", () => {
    expect(resolveCopyRef(registry, { id: "dashboard.missing" }).issues[0]?.reason).toBe("unknown-copy-id");
    expect(resolveCopyRef(registry, { id: "dashboard.welcome", locale: "fr" }).issues[0]?.reason).toBe(
      "locale-mismatch",
    );
    expect(resolveCopyRef(registry, { id: "dashboard.pending" }).issues[0]?.reason).toBe("copy-not-approved");
    expect(resolveCopyRef(registry, { id: "dashboard.welcome" }).issues[0]?.reason).toBe("missing-placeholder-value");
  });

  it("fails closed instead of throwing when JavaScript callers supply an invalid registry or ref shape", () => {
    const malformedRegistry = { ...registry, source: { kind: "unsupported", reference: "editorial/revisions/42" } };
    expect(() => resolveCopyRef(malformedRegistry, { id: "dashboard.welcome" })).not.toThrow();
    expect(resolveCopyRef(malformedRegistry, { id: "dashboard.welcome" })).toEqual({
      issues: [expect.objectContaining({ reason: "invalid-registry" })],
      complete: false,
    });

    expect(resolveCopyRef(registry, { id: "dashboard.welcome", values: null } as unknown).issues[0]?.reason).toBe("invalid-ref");
    expect(createCopyResolver({ entries: null })({ id: "dashboard.welcome" })).toBeUndefined();
  });

  it("rejects unexpected or non-scalar interpolation values", () => {
    expect(resolveCopyRef(registry, { id: "dashboard.welcome", values: { name: "Ada", extra: true } }).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: "unexpected-placeholder-value", placeholder: "extra" })]),
    );
    expect(
      resolveCopyRef(registry, {
        id: "dashboard.welcome",
        values: { name: { invalid: true } as unknown as string },
      }).issues,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "missing-placeholder-value", placeholder: "name" })]));
  });

  it("creates the narrow CopyResolver callback surface renderers consume", () => {
    const resolver = createCopyResolver(registry);
    expect(resolver({ id: "dashboard.welcome", values: { name: "Ada" } })?.text).toBe("Welcome, Ada.");
    expect(resolver({ id: "dashboard.missing" })).toBeUndefined();
  });
});
