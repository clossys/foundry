import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_CONDITIONS,
  LIFECYCLE_STATES,
  PACK_STATUSES,
  packStatusToLifecycle,
  type PackStatus,
} from "./lifecycle.js";

// The repository's own canonical contract -- docs/contracts/lifecycle.json --
// is the human-readable twin of this module. issue #1228's whole point is
// that only one vocabulary exists; this test is what keeps the two from
// drifting apart the way the loop lifecycle and pack statuses once did.
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const contract = JSON.parse(readFileSync(join(repoRoot, "docs/contracts/lifecycle.json"), "utf8"));

describe("lifecycle vocabulary", () => {
  it("matches the canonical contract's states and conditions exactly", () => {
    expect(contract.states).toEqual([...LIFECYCLE_STATES]);
    expect(contract.conditions).toEqual([...LIFECYCLE_CONDITIONS]);
  });

  it("has exactly six states and three conditions", () => {
    expect(LIFECYCLE_STATES).toHaveLength(6);
    expect(LIFECYCLE_CONDITIONS).toHaveLength(3);
  });

  it("maps every pack status onto the contract's own packStatusMapping", () => {
    for (const status of PACK_STATUSES) {
      const expected = contract.packStatusMapping[status];
      const actual = packStatusToLifecycle(status);
      expect(actual.state).toBe(expected.state);
      expect(actual.note).toBe(expected.note ?? null);
    }
  });

  it("specializes in-review, kept, and published without inventing new state words", () => {
    expect(packStatusToLifecycle("in-review")).toEqual({ status: "in-review", state: "draft", note: "draft with a pending judgment" });
    expect(packStatusToLifecycle("kept")).toEqual({ status: "kept", state: "approved", note: "approved by the Customer keep" });
    expect(packStatusToLifecycle("published")).toEqual({ status: "published", state: "verified", note: "sealed and verified live" });
  });

  it("leaves absent, found, and draft as bare, unspecialized states", () => {
    const bare: readonly PackStatus[] = ["absent", "found", "draft"];
    for (const status of bare) {
      const position = packStatusToLifecycle(status);
      expect(position.state).toBe(status);
      expect(position.note).toBeNull();
    }
  });

  it("covers every declared pack status with no gaps", () => {
    expect(PACK_STATUSES.every((status) => LIFECYCLE_STATES.includes(packStatusToLifecycle(status).state))).toBe(true);
  });
});
