/**
 * critique.schema.json `candidate` and verdict.schema.json `pick` accept the candidate stems the shared
 * candidateStemIssue rule accepts: the slot leaf (`meta-v1.md`) and a dotted record a slot contract
 * declares (`home.meta-v1.md`). A malformed candidate name is still refused.
 */
import { describe, expect, it } from "vitest";
import { loadSchema, validateValue } from "./schema.js";

const critique = (candidate: string) => ({
  schema: "clossys.critique/1",
  slot: "page.home.meta",
  candidate,
  standard: "copy.meta",
  scores: { clarity: 4 },
  packet: { manifest: [{ role: "contract", ref: "contract.json" }] },
});
const verdict = (pick: string) => ({
  schema: "clossys.verdict/1",
  slot: "page.home.meta",
  pick,
  reason: "best fit",
  criteria: ["clarity"],
});

const accepted = ["meta-v1.md", "home.meta-v1.md", "home.meta-v12.json"];
const malformed = ["Home.meta-v1.md", ".meta-v1.md", "home.meta.md", "home.meta-v0.md", "home.meta-v1.svg", "home meta-v1.md"];

describe("candidate names in the critique and verdict schemas", () => {
  for (const name of accepted) {
    it(`accepts ${name}`, () => {
      expect(validateValue(critique(name), loadSchema("critique"))).toEqual([]);
      expect(validateValue(verdict(name), loadSchema("verdict"))).toEqual([]);
    });
  }
  for (const name of malformed) {
    it(`refuses ${name}`, () => {
      expect(validateValue(critique(name), loadSchema("critique")).map(issue => issue.path)).toContain("/candidate");
      expect(validateValue(verdict(name), loadSchema("verdict"))).not.toEqual([]);
    });
  }
});
