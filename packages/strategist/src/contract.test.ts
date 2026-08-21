import { describe, expect, it } from "vitest";
import {
  createStrategyProvenance,
  getApprovedClaims,
  serializeStrategyContract,
  validateStrategyContract,
  type StrategyContract,
} from "./contract.js";

const provenance = { source: "fictional-research-register", recordedAt: "2026-08-11", sourceRevision: "1.0.0" };

/** A B2B product fixture. Everything here is fictional and product-neutral. */
const workshopContract: StrategyContract = {
  id: "workshop-strategy",
  revision: "1.0.0",
  provenance,
  records: [
    { kind: "product", id: "workshop", revision: "1.0.0", provenance, name: "Workshop", summary: "A fictional planning product for distributed teams." },
    { kind: "brand", id: "workshop-brand", revision: "1.0.0", provenance, productId: "workshop", name: "Workshop", essence: "Calm planning for consequential work." },
    { kind: "audience", id: "operations-leads", revision: "1.0.0", provenance, productId: "workshop", name: "Operations leads", description: "People who coordinate work across changing teams." },
    { kind: "evidence", id: "interview-round-one", revision: "1.0.0", provenance, productId: "workshop", evidenceKind: "research", statement: "Interview participants described fragmented planning as a recurring risk.", observedAt: "2026-07-20" },
    { kind: "claim", id: "fewer-status-meetings", revision: "1.0.0", provenance, productId: "workshop", claimKey: "fewer-status-meetings", assertion: "Workshop reduces avoidable status meetings.", status: "approved", evidenceIds: ["interview-round-one"], approval: { approvedBy: "strategy-review", approvedAt: "2026-08-01" }, audienceIds: ["operations-leads"] },
    { kind: "positioning", id: "workshop-positioning", revision: "1.0.0", provenance, productId: "workshop", audienceIds: ["operations-leads"], category: "planning software", differentiation: "It turns changing work into a shared operating picture.", reasonToBelieveClaimIds: ["fewer-status-meetings"] },
    { kind: "constraint", id: "avoid-guarantees", revision: "1.0.0", provenance, productId: "workshop", constraintKind: "claim-governance", target: "all", instruction: "Do not express the approved claim as a guaranteed outcome.", claimIds: ["fewer-status-meetings"] },
  ],
};

/** A direct-to-consumer shape proves the contract does not assume B2B roles or brands. */
const fieldGuideContract: StrategyContract = {
  id: "field-guide-strategy",
  revision: "2.1.0",
  provenance: { source: "fictional-field-notes", recordedAt: "2026-08-10" },
  records: [
    { kind: "product", id: "field-guide", revision: "2.1.0", provenance: { source: "fictional-field-notes", recordedAt: "2026-08-10" }, name: "Field Guide", summary: "A fictional guide for people learning a new outdoor skill." },
    { kind: "audience", id: "new-observers", revision: "2.1.0", provenance: { source: "fictional-field-notes", recordedAt: "2026-08-10" }, productId: "field-guide", name: "New observers", description: "People beginning an outdoor observation practice." },
    { kind: "evidence", id: "pilot-notes", revision: "2.1.0", provenance: { source: "fictional-field-notes", recordedAt: "2026-08-10" }, productId: "field-guide", evidenceKind: "observed-fact", statement: "Pilot readers completed the first lesson without facilitator support." },
    { kind: "claim", id: "independent-first-lesson", revision: "2.1.0", provenance: { source: "fictional-field-notes", recordedAt: "2026-08-10" }, productId: "field-guide", claimKey: "independent-first-lesson", assertion: "The first lesson can be completed independently.", status: "hypothesis", evidenceIds: ["pilot-notes"], audienceIds: ["new-observers"] },
  ],
};

describe("validateStrategyContract", () => {
  it("accepts distinct product shapes and preserves approved/hypothesis separation", () => {
    const workshop = validateStrategyContract(workshopContract);
    const guide = validateStrategyContract(fieldGuideContract);
    expect(workshop.ok).toBe(true);
    expect(guide.ok).toBe(true);
    expect(getApprovedClaims(workshopContract).map((claim) => claim.id)).toEqual(["fewer-status-meetings"]);
    expect(getApprovedClaims(fieldGuideContract)).toEqual([]);
  });

  it("requires semver revisions, source provenance, and evidence for approved claims", () => {
    const invalid = structuredClone(workshopContract) as Record<string, unknown>;
    invalid.revision = "revision-one";
    const records = invalid.records as Array<Record<string, unknown>>;
    records[4] = { ...records[4], evidenceIds: [], approval: undefined };
    const result = validateStrategyContract(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.path)).toContain("revision");
      expect(result.issues.some((issue) => issue.path === "records[4].evidenceIds")).toBe(true);
      expect(result.issues.some((issue) => issue.path === "records[4].approval")).toBe(true);
    }
  });

  it("rejects duplicate IDs, unresolved evidence, and conflicting claim keys deterministically", () => {
    const invalid = structuredClone(workshopContract);
    invalid.records.push({ ...invalid.records[4]!, id: "second-claim", assertion: "A conflicting version of the claim." } as StrategyContract["records"][number]);
    (invalid.records[4]! as { evidenceIds: string[] }).evidenceIds = ["missing-evidence"];
    invalid.records.push({ ...invalid.records[0]! } as StrategyContract["records"][number]);
    const result = validateStrategyContract(invalid);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((issue) => issue.message)).toEqual(expect.arrayContaining([
        expect.stringContaining('references missing record "missing-evidence"'),
        expect.stringContaining('conflicting claim key "fewer-status-meetings"'),
        expect.stringContaining('duplicate record id "workshop"'),
      ]));
    }
  });
});

describe("strategy serialization and output provenance", () => {
  it("canonicalizes record/reference ordering and produces a stable fingerprint", () => {
    const reordered = structuredClone(workshopContract);
    reordered.records.reverse();
    const positioning = reordered.records.find((record) => record.kind === "positioning");
    if (positioning?.kind === "positioning") {
      positioning.audienceIds.reverse();
      positioning.reasonToBelieveClaimIds.reverse();
    }
    expect(serializeStrategyContract(reordered)).toBe(serializeStrategyContract(workshopContract));
    expect(createStrategyProvenance(reordered)).toEqual(createStrategyProvenance(workshopContract));
  });

  it("can limit manifest provenance to the records used by a surface without changing the contract fingerprint", () => {
    const provenancePayload = createStrategyProvenance(workshopContract, ["operations-leads", "fewer-status-meetings"]);
    expect(provenancePayload.records).toEqual([
      { kind: "claim", id: "fewer-status-meetings", revision: "1.0.0" },
      { kind: "audience", id: "operations-leads", revision: "1.0.0" },
    ]);
    expect(provenancePayload.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
});
