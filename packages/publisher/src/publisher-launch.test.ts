import { describe, expect, it } from "vitest";
import { validateBriefContract } from "@clossys/director";
import contract from "@clossys/publisher/strategy-brief.json";
describe("publisher.launch contract", () => {
  it("ships exactly the launch cells with the release optional", () => {
    expect(validateBriefContract(contract).ok).toBe(true);
    expect(contract.requires).toEqual(["focus.reach.channel", "focus.offer.included"]);
    expect(contract.optional).toEqual(["execution.roadmap.release"]);
  });
});
