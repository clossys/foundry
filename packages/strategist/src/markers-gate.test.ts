import { describe, expect, it } from "vitest";
import { checkClaimMarkers, checkConstraintMarkers } from "./markers-gate.js";

describe("checkClaimMarkers", () => {
  const claims = [
    {
      id: "prototype-same-meeting",
      status: "approved" as const,
      assertion: "We ship a working prototype in the same meeting the request is made.",
      basis: "Observed in three consecutive pilot sessions with operations teams.",
    },
    {
      id: "maybe-later",
      status: "hypothesis" as const,
      assertion: "Teams adopt us without a champion.",
    },
  ];

  it("accepts an approved claim marker", () => {
    const result = checkClaimMarkers([{ path: "page.md", content: "Ship fast. <!-- claim:prototype-same-meeting -->" }], claims);
    expect(result.findings).toEqual([]);
  });

  it("rejects a hypothesis claim marker", () => {
    const result = checkClaimMarkers([{ path: "page.md", content: "<!-- claim:maybe-later -->" }], claims);
    expect(result.findings.some((finding) => finding.rule === "hypothesis-claim-citation")).toBe(true);
  });

  it("rejects a missing claim id", () => {
    const result = checkClaimMarkers([{ path: "page.md", content: "// claim:missing-id" }], claims);
    expect(result.findings.some((finding) => finding.rule === "unknown-claim-citation")).toBe(true);
  });
});

describe("checkConstraintMarkers", () => {
  const constraints = [
    { id: "avoid-guarantees", target: "copy" as const, instruction: "Do not express the approved claim as a guaranteed outcome." },
    { id: "surface-tone", target: "surface" as const, instruction: "Keep hero typography restrained." },
  ];

  it("requires copy-target constraints in the scan corpus", () => {
    const result = checkConstraintMarkers([{ path: "page.md", content: "plain prose" }], constraints);
    expect(result.findings.some((finding) => finding.message.includes("avoid-guarantees"))).toBe(true);
  });

  it("passes when copy and surface constraints are cited in the right corpora", () => {
    const result = checkConstraintMarkers(
      [{ path: "page.md", content: "<!-- constraint:avoid-guarantees -->" }],
      constraints,
      { surfaceFiles: [{ path: "surface.css", content: "/* constraint:surface-tone */" }] },
    );
    expect(result.findings).toEqual([]);
  });
});
