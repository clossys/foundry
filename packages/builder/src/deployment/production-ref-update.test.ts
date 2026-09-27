import { describe, expect, it } from "vitest";
import {
  planProductionRefUpdate,
  verifyProductionRefUpdate,
} from "./production-ref-update.js";

const productionCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const integrationCommit = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const otherCommit = "cccccccccccccccccccccccccccccccccccccccc";

describe("planProductionRefUpdate", () => {
  it("requires fast-forward when production is an ancestor of integration", () => {
    expect(planProductionRefUpdate({ productionIsAncestor: true })).toEqual({ method: "fast-forward" });
  });

  it("requires a merge when production is not an ancestor", () => {
    expect(planProductionRefUpdate({ productionIsAncestor: false })).toEqual({
      method: "merge",
      firstParent: "production",
      secondParent: "integration",
    });
  });
});

describe("verifyProductionRefUpdate", () => {
  it("is violated when the observed update used force", () => {
    const result = verifyProductionRefUpdate(planProductionRefUpdate({ productionIsAncestor: true }), {
      method: "force",
      productionCommit,
      integrationCommit,
    });
    expect(result.verdict).toBe("violated");
    if (result.verdict !== "violated") return;
    expect(result.findings.map((entry) => entry.rule)).toContain("production-ref-forced");
  });

  it("is violated when the observed update used admin bypass", () => {
    const result = verifyProductionRefUpdate(planProductionRefUpdate({ productionIsAncestor: true }), {
      method: "admin-bypass",
      productionCommit,
      integrationCommit,
    });
    expect(result.verdict).toBe("violated");
    if (result.verdict !== "violated") return;
    expect(result.findings.map((entry) => entry.rule)).toContain("production-ref-admin-bypass");
  });

  it("is satisfied for a fast-forward plan observed as fast-forward onto integration", () => {
    const result = verifyProductionRefUpdate(planProductionRefUpdate({ productionIsAncestor: true }), {
      method: "fast-forward",
      productionCommit,
      integrationCommit,
      targetCommit: integrationCommit,
    });
    expect(result).toMatchObject({ verdict: "satisfied" });
  });

  it("is satisfied for a merge plan observed with production then integration parents", () => {
    const result = verifyProductionRefUpdate(planProductionRefUpdate({ productionIsAncestor: false }), {
      method: "merge",
      productionCommit,
      integrationCommit,
      parents: [productionCommit, integrationCommit],
    });
    expect(result).toMatchObject({ verdict: "satisfied" });
  });

  it("is violated when merge parents are swapped", () => {
    const result = verifyProductionRefUpdate(planProductionRefUpdate({ productionIsAncestor: false }), {
      method: "merge",
      productionCommit,
      integrationCommit,
      parents: [integrationCommit, productionCommit],
    });
    expect(result.verdict).toBe("violated");
  });

  it("is violated when a merge observation has three parents", () => {
    const result = verifyProductionRefUpdate(planProductionRefUpdate({ productionIsAncestor: false }), {
      method: "merge",
      productionCommit,
      integrationCommit,
      parents: [productionCommit, integrationCommit, otherCommit],
    });
    expect(result.verdict).toBe("violated");
  });

  it("is violated when a merge plan is observed as fast-forward", () => {
    const result = verifyProductionRefUpdate(planProductionRefUpdate({ productionIsAncestor: false }), {
      method: "fast-forward",
      productionCommit,
      integrationCommit,
      targetCommit: integrationCommit,
    });
    expect(result.verdict).toBe("violated");
  });

  it("is indeterminate when commit SHAs are missing", () => {
    const result = verifyProductionRefUpdate(planProductionRefUpdate({ productionIsAncestor: true }), {
      method: "fast-forward",
      targetCommit: integrationCommit,
    });
    expect(result.verdict).toBe("indeterminate");
    if (result.verdict !== "indeterminate") return;
    expect(result.reason).toBe("production-ref-observation-incomplete");
  });
});
