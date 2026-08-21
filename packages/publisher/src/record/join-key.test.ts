import { describe, expect, it } from "vitest";
import { checkJoinKeyCompleteness } from "./join-key.js";
import type { PublicationEntry } from "./types.js";

function entry(id: string, overrides: Partial<PublicationEntry> = {}): PublicationEntry {
  return {
    id,
    publishedAt: "2026-08-07T14:03:00.000Z",
    channel: "web",
    strategyRevision: "strategy@1.4.0",
    factCitations: [],
    ...overrides,
  };
}

describe("checkJoinKeyCompleteness — fail-closed shape/emptiness cases", () => {
  it("reports ledger-invalid, liveEntriesChecked:0, for a malformed ledger", () => {
    const result = checkJoinKeyCompleteness({ not: "an array" });
    expect(result.ok).toBe(false);
    expect(result.liveEntriesChecked).toBe(0);
    expect(result.findings.some((f) => f.rule === "ledger-invalid")).toBe(true);
  });

  it("reports empty-ledger, liveEntriesChecked:0, for an empty array", () => {
    const result = checkJoinKeyCompleteness([]);
    expect(result.ok).toBe(false);
    expect(result.liveEntriesChecked).toBe(0);
    expect(result.findings.some((f) => f.rule === "empty-ledger")).toBe(true);
  });

  it("reports no-live-entries when every contentId group's latest entry has a closed window — zero live entries is never a clean pass", () => {
    const ledger = [
      entry("a", {
        contentId: "page:pricing",
        publishedAt: "2026-08-01T00:00:00.000Z",
        supersededAt: "2026-08-15T00:00:00.000Z",
      }),
    ];
    const result = checkJoinKeyCompleteness(ledger);
    expect(result.ok).toBe(false);
    expect(result.liveEntriesChecked).toBe(0);
    expect(result.findings.some((f) => f.rule === "no-live-entries")).toBe(true);
  });
});

describe("checkJoinKeyCompleteness — per-live-entry completeness", () => {
  it("reports ok:true for a single live entry with a complete join key", () => {
    const ledger = [entry("a", { contentId: "page:pricing", url: "https://example.com/pricing" })];
    const result = checkJoinKeyCompleteness(ledger);
    expect(result.ok).toBe(true);
    expect(result.liveEntriesChecked).toBe(1);
    expect(result.completeLiveEntries).toBe(1);
    expect(result.incompleteLiveEntries).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it("reports join-key-missing-identity for a live entry with no contentId — fails closed (ungroupable entries default to live)", () => {
    const ledger = [entry("a")];
    const result = checkJoinKeyCompleteness(ledger);
    expect(result.ok).toBe(false);
    expect(result.liveEntriesChecked).toBe(1);
    expect(result.incompleteLiveEntries).toBe(1);
    expect(result.findings.some((f) => f.rule === "join-key-missing-identity")).toBe(true);
  });

  it("reports join-key-window-invalid when the latest entry in a group carries a supersededAt that does not fall after publishedAt", () => {
    const ledger = [
      entry("a", {
        contentId: "page:pricing",
        publishedAt: "2026-08-15T00:00:00.000Z",
        supersededAt: "2026-08-01T00:00:00.000Z", // before publishedAt — does not close a window
      }),
    ];
    const result = checkJoinKeyCompleteness(ledger);
    expect(result.ok).toBe(false);
    // Still classified live (a malformed close does not retire it), so it is evaluated, not skipped.
    expect(result.liveEntriesChecked).toBe(1);
    expect(result.findings.some((f) => f.rule === "join-key-window-invalid")).toBe(true);
  });

  it("does not require supersededAt on the live entry — an open window is a complete join key, not a missing one", () => {
    const ledger = [entry("a", { contentId: "page:pricing" })];
    const result = checkJoinKeyCompleteness(ledger);
    expect(result.ok).toBe(true);
    expect(result.findings.some((f) => f.rule === "join-key-window-invalid")).toBe(false);
  });

  it("only the latest entry in a contentId group is evaluated as live — an older revision with a newer sibling is not double-counted", () => {
    const ledger = [
      entry("a", { contentId: "page:pricing", publishedAt: "2026-08-01T00:00:00.000Z" }),
      entry("b", { contentId: "page:pricing", publishedAt: "2026-08-15T00:00:00.000Z" }),
    ];
    const result = checkJoinKeyCompleteness(ledger);
    expect(result.ok).toBe(true);
    expect(result.liveEntriesChecked).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// MANDATORY PROOF #1 — the separating fixture (issue #376 / house rule 3).
//
// A weaker tool that only checks field PRESENCE ("does every entry have a
// publishedAt / a non-empty contentId?") is passed by a ledger where each
// revision of the SAME real surface carries its own freshly-generated
// contentId — every field present, and still impossible to compare a page
// against its own previous version, because nothing ties the two entries
// together as "the same thing".
//
// The correctly-built ledger (contentId genuinely reused across revisions)
// must pass the same weak presence check AND must additionally be visible
// through this gate's own report as ONE identity spanning TWO windows —
// not merely "ok:true", a literal, inspectable grouping via
// `JoinKeyReport.identities`.
// ---------------------------------------------------------------------------
describe("checkJoinKeyCompleteness — separating fixture: two revisions of the same surface", () => {
  function naiveFieldPresenceCheck(ledger: PublicationEntry[]): boolean {
    // The "weaker tool" issue #376 warns about: checks that every field a
    // join key needs is PRESENT, never whether identity was actually reused.
    return ledger.every(
      (e) => typeof e.publishedAt === "string" && e.publishedAt.length > 0 && typeof e.contentId === "string" && e.contentId.length > 0,
    );
  }

  const revision1 = entry("pricing-v1", {
    contentId: "page:pricing",
    channel: "web",
    url: "https://example.com/pricing",
    publishedAt: "2026-08-01T00:00:00.000Z",
  });
  const revision2 = entry("pricing-v2", {
    contentId: "page:pricing", // correctly reused — same real surface
    channel: "web",
    url: "https://example.com/pricing",
    publishedAt: "2026-08-15T00:00:00.000Z",
  });
  const correctlyLinkedLedger = [revision1, revision2];

  it("passes the naive field-presence check", () => {
    expect(naiveFieldPresenceCheck(correctlyLinkedLedger)).toBe(true);
  });

  it("this gate shows the two revisions as ONE identity across TWO windows, and only the newer window is live", () => {
    const result = checkJoinKeyCompleteness(correctlyLinkedLedger);
    expect(result.ok).toBe(true);

    expect(result.identities).toHaveLength(1);
    const identity = result.identities[0];
    expect(identity?.contentId).toBe("page:pricing");
    expect(identity?.windows).toHaveLength(2);
    expect(identity?.windows.map((w) => w.entryId)).toEqual(["pricing-v1", "pricing-v2"]);

    // Only revision2 (the latest window) is evaluated as live.
    expect(result.liveEntriesChecked).toBe(1);
    expect(result.completeLiveEntries).toBe(1);
  });

  it("a ledger with a FRESH contentId per revision also passes the same naive field-presence check", () => {
    const separatedLedger = [
      revision1,
      { ...revision2, id: "pricing-v2-fresh-id", contentId: "page:pricing-2026-08-15-4f8a" }, // freshly generated, not reused
    ];
    expect(naiveFieldPresenceCheck(separatedLedger)).toBe(true);

    // But this gate does NOT show them as one identity — it shows two,
    // each with a single window, which is exactly the "impossible to
    // compare a page against its own previous version" failure the weak
    // check cannot see.
    const result = checkJoinKeyCompleteness(separatedLedger);
    expect(result.identities).toHaveLength(2);
    expect(result.identities.every((i) => i.windows.length === 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MANDATORY PROOF #2 — constructed positive control (house rule 4).
//
// Start from the KNOWN-GOOD ledger above (already asserted ok:true, one
// identity, two windows). Perturb it in exactly ONE way: give the second
// revision a fresh contentId instead of reusing the first's — everything
// else (id, channel, url, publishedAt) stays identical. Assert the gate
// reports the SPECIFIC finding kind this perturbation should produce, not
// merely "something failed".
// ---------------------------------------------------------------------------
describe("checkJoinKeyCompleteness — positive control: fresh identity on a known-good record", () => {
  const knownGood: PublicationEntry[] = [
    entry("pricing-v1", {
      contentId: "page:pricing",
      channel: "web",
      url: "https://example.com/pricing",
      publishedAt: "2026-08-01T00:00:00.000Z",
    }),
    entry("pricing-v2", {
      contentId: "page:pricing", // reused, correctly
      channel: "web",
      url: "https://example.com/pricing",
      publishedAt: "2026-08-15T00:00:00.000Z",
    }),
  ];

  it("baseline: the known-good ledger is clean, with no identity-churn finding", () => {
    const before = checkJoinKeyCompleteness(knownGood);
    expect(before.ok).toBe(true);
    expect(before.findings.some((f) => f.rule === "join-key-identity-churn")).toBe(false);
  });

  it("perturbing ONLY revision 2's contentId (fresh instead of reused) produces exactly a join-key-identity-churn finding", () => {
    const perturbed = knownGood.map((e) => (e.id === "pricing-v2" ? { ...e, contentId: "page:pricing-redesign-2026" } : e));

    // Confirm exactly one field changed relative to the known-good fixture.
    expect(perturbed[0]).toEqual(knownGood[0]);
    expect(perturbed[1]?.contentId).not.toBe(knownGood[1]?.contentId);
    expect({ ...perturbed[1], contentId: knownGood[1]?.contentId }).toEqual(knownGood[1]);

    const after = checkJoinKeyCompleteness(perturbed);
    expect(after.ok).toBe(false);
    const churn = after.findings.find((f) => f.rule === "join-key-identity-churn");
    expect(churn).toBeDefined();
    expect(churn?.severity).toBe("error");
    expect(churn?.message).toContain("page:pricing");
    expect(churn?.message).toContain("page:pricing-redesign-2026");

    // The perturbation produced THIS finding, not some other unrelated
    // failure — no ledger-invalid/empty-ledger/no-live-entries here, and
    // the individual live entry's own identity/window fields are still
    // each individually present and well-formed.
    expect(after.findings.some((f) => f.rule === "ledger-invalid")).toBe(false);
    expect(after.findings.some((f) => f.rule === "empty-ledger")).toBe(false);
    expect(after.findings.some((f) => f.rule === "join-key-missing-identity")).toBe(false);
  });
});

describe("checkJoinKeyCompleteness — address consistency is address-scoped, not global", () => {
  it("does not flag two different contentIds at two DIFFERENT addresses as churn", () => {
    const ledger = [
      entry("pricing", { contentId: "page:pricing", channel: "web", url: "https://example.com/pricing" }),
      entry("about", { contentId: "page:about", channel: "web", url: "https://example.com/about" }),
    ];
    const result = checkJoinKeyCompleteness(ledger);
    expect(result.ok).toBe(true);
    expect(result.findings.some((f) => f.rule === "join-key-identity-churn")).toBe(false);
  });

  it("skips address-consistency checking for entries without a url", () => {
    const ledger = [
      entry("a", { contentId: "id-1", channel: "slides" }),
      entry("b", { contentId: "id-2", channel: "slides" }),
    ];
    const result = checkJoinKeyCompleteness(ledger);
    expect(result.findings.some((f) => f.rule === "join-key-identity-churn")).toBe(false);
  });
});
