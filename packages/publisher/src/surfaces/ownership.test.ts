import { describe, expect, it } from "vitest";
import { PUBLISHER_SURFACES_DIR, validateSurfaceOwnership } from "./ownership.js";

describe("validateSurfaceOwnership", () => {
  it("passes when every path has exactly one owner and Publisher's own surfaces are claimed by publisher", () => {
    const result = validateSurfaceOwnership([
      { path: `${PUBLISHER_SURFACES_DIR}home.json`, owner: "publisher" },
      { path: "clossys/designer/brand.css", owner: "designer" },
      { path: "clossys/writer/copy.json", owner: "writer" },
    ]);
    expect(result).toEqual({ exitCode: 0, findings: [] });
  });

  it("flags a path two roles both claim (the #1205 defect: Designer editing Publisher's surface file directly)", () => {
    const result = validateSurfaceOwnership([
      { path: `${PUBLISHER_SURFACES_DIR}home.json`, owner: "publisher" },
      { path: `${PUBLISHER_SURFACES_DIR}home.json`, owner: "designer" },
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rule: "multiple-owners", path: `${PUBLISHER_SURFACES_DIR}home.json` }),
      ]),
    );
  });

  it("flags a path under clossys/publisher/surfaces/ that publisher itself never claimed", () => {
    const result = validateSurfaceOwnership([{ path: `${PUBLISHER_SURFACES_DIR}home.json`, owner: "designer" }]);
    expect(result.exitCode).toBe(1);
    expect(result.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ rule: "surface-owner-mismatch" })]),
    );
  });

  it("flags a claim missing a path or an owner", () => {
    const result = validateSurfaceOwnership([{ path: "", owner: "publisher" }, { path: "clossys/writer/copy.json", owner: "" }]);
    expect(result.exitCode).toBe(1);
    expect(result.findings.every((finding) => finding.rule === "invalid-claim")).toBe(true);
    expect(result.findings).toHaveLength(2);
  });

  it("is order-independent and deduplicates identical claims", () => {
    const a = validateSurfaceOwnership([
      { path: "clossys/designer/brand.css", owner: "designer" },
      { path: "clossys/designer/brand.css", owner: "designer" },
    ]);
    expect(a).toEqual({ exitCode: 0, findings: [] });
  });
});
