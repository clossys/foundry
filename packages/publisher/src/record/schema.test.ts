import { describe, expect, it } from "vitest";
import { validateEntry, validateLedger } from "./schema.js";
import { citeFact } from "./fact.js";
import type { PublicationEntry } from "./types.js";

function validEntry(overrides: Partial<PublicationEntry> = {}): PublicationEntry {
  return {
    id: "entry-1",
    publishedAt: "2026-08-07T14:03:00.000Z",
    channel: "web",
    url: "https://example.com/pricing",
    strategyRevision: "strategy@1.4.0",
    factCitations: [citeFact("active-customers", 4200)],
    ...overrides,
  };
}

describe("validateEntry", () => {
  it("accepts a well-formed entry", () => {
    expect(validateEntry(validEntry())).toEqual([]);
  });

  it("accepts an entry with zero fact citations", () => {
    expect(validateEntry(validEntry({ factCitations: [] }))).toEqual([]);
  });

  it("accepts an entry with no url", () => {
    const entry = validEntry();
    delete entry.url;
    expect(validateEntry(entry)).toEqual([]);
  });

  it("rejects a non-object", () => {
    const findings = validateEntry("nope");
    expect(findings).toEqual([expect.objectContaining({ rule: "entry-shape", severity: "error" })]);
  });

  it("rejects a missing/empty id", () => {
    const findings = validateEntry(validEntry({ id: "" }));
    expect(findings.some((f) => f.rule === "entry-id-shape")).toBe(true);
  });

  it("rejects a publishedAt that is not a full ISO instant", () => {
    const findings = validateEntry(validEntry({ publishedAt: "2026-08-07" }));
    expect(findings.some((f) => f.rule === "entry-published-at-shape")).toBe(true);
  });

  it("rejects an empty channel", () => {
    const findings = validateEntry(validEntry({ channel: "" }));
    expect(findings.some((f) => f.rule === "entry-channel-shape")).toBe(true);
  });

  it("rejects an unparseable url", () => {
    const findings = validateEntry(validEntry({ url: "not a url" }));
    expect(findings.some((f) => f.rule === "entry-url-shape")).toBe(true);
  });

  it("rejects an empty strategyRevision", () => {
    const findings = validateEntry(validEntry({ strategyRevision: "" }));
    expect(findings.some((f) => f.rule === "entry-strategy-revision-shape")).toBe(true);
  });

  it("rejects factCitations that is not an array", () => {
    // Deliberately wrong shape, passed through `unknown` — not a
    // `@ts-expect-error`, which this repository's `check:typechecked-assertions`
    // gate refuses inside a `*.test.ts` file.
    const entry = validEntry() as unknown as Record<string, unknown>;
    entry.factCitations = "nope";
    const findings = validateEntry(entry);
    expect(findings.some((f) => f.rule === "entry-fact-citations-shape")).toBe(true);
  });

  it("rejects a citation whose valueBinding.policyId does not match its factRef", () => {
    const entry = validEntry({
      factCitations: [{ factRef: "active-customers", valueBinding: { policyId: "wrong-ref", digestAlgorithm: "sha256", digest: "a".repeat(64) } }],
    });
    const findings = validateEntry(entry);
    expect(findings.some((f) => f.rule === "citation-policy-id-mismatch")).toBe(true);
  });

  it("rejects a citation with a malformed valueBinding, prefixing policy's own rule name", () => {
    const entry = validEntry({
      factCitations: [{ factRef: "active-customers", valueBinding: { policyId: "active-customers", digestAlgorithm: "sha256", digest: "not-hex" } }],
    });
    const findings = validateEntry(entry);
    expect(findings.some((f) => f.rule === "citation-binding-digest-shape")).toBe(true);
  });

  it("warns (not errors) on a duplicate factRef within the same entry", () => {
    const citation = citeFact("active-customers", 4200);
    const entry = validEntry({ factCitations: [citation, citation] });
    const findings = validateEntry(entry);
    const dup = findings.find((f) => f.rule === "duplicate-fact-citation");
    expect(dup).toBeDefined();
    expect(dup?.severity).toBe("warning");
  });

  it("validates an optional contentBinding", () => {
    const good = validateEntry(validEntry({ contentBinding: { policyId: "page:pricing", digestAlgorithm: "sha256", digest: "b".repeat(64) } }));
    expect(good).toEqual([]);

    const bad = validateEntry(validEntry({ contentBinding: { policyId: "page:pricing", digestAlgorithm: "sha256", digest: "short" } }));
    expect(bad.some((f) => f.rule === "entry-content-binding-digest-shape")).toBe(true);
  });
});

describe("validateLedger", () => {
  it("accepts a well-formed ledger", () => {
    expect(validateLedger([validEntry({ id: "a" }), validEntry({ id: "b" })])).toEqual([]);
  });

  it("accepts an empty array as a shape (emptiness is drift.ts's concern, not schema's)", () => {
    expect(validateLedger([])).toEqual([]);
  });

  it("rejects a non-array", () => {
    const findings = validateLedger({ not: "an array" });
    expect(findings).toEqual([expect.objectContaining({ rule: "ledger-shape", severity: "error" })]);
  });

  it("rejects a ledger with a duplicate id", () => {
    const findings = validateLedger([validEntry({ id: "same" }), validEntry({ id: "same" })]);
    expect(findings.some((f) => f.rule === "duplicate-entry-id")).toBe(true);
  });

  it("reports each malformed entry with its own indexed path", () => {
    const findings = validateLedger([validEntry({ id: "a" }), { id: "b" }]);
    expect(findings.some((f) => f.path?.startsWith("[1]"))).toBe(true);
  });
});
