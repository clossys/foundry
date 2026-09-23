import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOOP_STAGES, BLOCKER_KINDS, BLOCKER_OWNERS } from "./types.js";

// docs/contracts/loop.json is the human-readable twin of this module, the
// same reason lifecycle.test.ts checks docs/contracts/lifecycle.json:
// only one vocabulary should exist for a given rule.
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const contract = JSON.parse(readFileSync(join(repoRoot, "docs/contracts/loop.json"), "utf8"));

describe("loop.json contract sync", () => {
  it("declares the same five stages, in the same order, as LOOP_STAGES", () => {
    expect(contract.stages).toEqual([...LOOP_STAGES]);
  });

  it("declares the same five blocker kinds, in the same order, as BLOCKER_KINDS", () => {
    expect(contract.blockers.kinds).toEqual([...BLOCKER_KINDS]);
  });

  it("declares the same owner vocabulary as BLOCKER_OWNERS, not only the same keys", () => {
    expect(Object.keys(contract.blockers.owners).sort()).toEqual([...BLOCKER_KINDS].sort());
    expect(contract.blockers.owners).toEqual(BLOCKER_OWNERS);
  });

  it("declares the same five artifact-operation kinds this module implements", () => {
    expect(contract.artifactOperations.kinds).toEqual(["create", "update", "move", "supersede", "retire"]);
  });

  it("declares the same five STATUS document sections, in the same fixed order", () => {
    expect(contract.state.statusSections).toEqual(["Mandate", "Where we are", "Recommended next", "Decisions", "Blockers"]);
  });

  it("names the loop keyword and both invocation forms", () => {
    expect(contract.invocation.keyword).toBe("loop");
    expect(contract.invocation.claudeCode).toContain("loop");
    expect(contract.invocation.cursor).toContain("loop");
  });
});
