import { describe, expect, it } from "vitest";
import { CANDIDATE_STATES, CANDIDATE_ORIGINS, SLOT_KINDS, SECTION_INTENTS, LINK_RELATIONS, isRevisionId } from "./vocabulary.js";

describe("content record vocabularies", () => {
  it("keeps candidate states separate from stage statuses", () => {
    expect(CANDIDATE_STATES).toEqual(["draft", "in-review", "approved", "active", "retired"]);
    expect(CANDIDATE_ORIGINS).toEqual(["agent-draft", "alternative", "rewrite", "imported"]);
    expect(SLOT_KINDS).toEqual(["content", "redirect", "status"]);
    expect(SECTION_INTENTS).toEqual(["continues", "contrasts", "zooms-in", "proof", "call-to-action"]);
    expect(LINK_RELATIONS).toEqual(["nav", "next", "cta", "branch"]);
  });
  it.each(["r1", "r2", "r123"])("recognizes pinned revision %s", (value) => {
    expect(isRevisionId(value)).toBe(true);
  });
  it.each(["latest", "r0", "r01", "r-1", "r1.5", "r", 1, null, undefined])("rejects floating or invalid revision %s", (value) => {
    expect(isRevisionId(value)).toBe(false);
  });
});
