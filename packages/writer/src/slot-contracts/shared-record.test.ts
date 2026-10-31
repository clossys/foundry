import { describe, expect, it } from "vitest";
import { flattenWriterLimits, loadWriterContracts, toSlotContractRecord } from "./format.js";

const contracts = loadWriterContracts();

describe("Writer contracts as shared slot-contract records", () => {
  it("projects every contract with scalar limits and hashed guide references", () => {
    for (const contract of contracts.slots) {
      const record = toSlotContractRecord(contract);
      expect(record).toMatchObject({ schema: "clossys.slot-contract/1", slot: contract.id, package: "writer", layer: contract.layer, checkSuite: "writer.copy.v1", specimenKind: "text" });
      expect(record.slot.startsWith(`${record.layer}.`)).toBe(true);
      for (const value of Object.values(record.limits)) expect(["number", "string", "boolean"]).toContain(typeof value);
      expect(record.references.map(ref => ref.item)).toEqual(contract.references.map(ref => ref.id));
      for (const ref of record.references) expect(ref.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(record.inputs.every(input => input.kind === "cell" && input.name.startsWith("director:"))).toBe(true);
    }
  });

  it("keeps every nested field limit under a dotted key", () => {
    const contract = contracts.slots.find(slot => Object.keys(slot.limits.fields).length > 0)!;
    const flat = flattenWriterLimits(contract.limits);
    for (const [key, field] of Object.entries(contract.limits.fields)) {
      expect(flat[`fields.${key}.maxChars`]).toBe(field.maxChars);
      expect(flat[`fields.${key}.required`]).toBe(field.required);
    }
    expect(flat.translationHeadroom).toBe(contract.limits.translationHeadroom);
  });

  it("hashes a reference by its content", () => {
    const contract = contracts.slots[0]!;
    const changed = { ...contract, references: contract.references.map(ref => ({ ...ref, guide: `${ref.guide} (edited)` })) };
    expect(toSlotContractRecord(changed).references[0]!.hash).not.toBe(toSlotContractRecord(contract).references[0]!.hash);
  });
});
