import { describe, expect, it } from "vitest";
import { loadDirectorContracts, toSlotContractRecord } from "./format.js";

const contracts = loadDirectorContracts();

describe("Director contracts as shared slot-contract records", () => {
  it("projects every contract into the strategy layer with scalar limits", () => {
    for (const contract of contracts.slots) {
      const record = toSlotContractRecord(contract);
      expect(record).toMatchObject({ schema: "clossys.slot-contract/1", slot: `strategy.${contract.id}`, package: "director", layer: "strategy", checkSuite: "director.cell.v1", specimenKind: "text" });
      expect(record.limits).toEqual({
        requiredKeys: contract.limits.requiredKeys.join(","), minWordsPerKey: contract.limits.minWordsPerKey,
        singleTokenKeys: contract.limits.singleTokenKeys.join(","), feeds: contract.feeds.join(","),
      });
      expect(record.references.map(ref => ref.item)).toEqual(contract.references.map(ref => ref.id));
      for (const ref of record.references) expect(ref.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });
});
