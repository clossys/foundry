/**
 * Writer and Director slot contracts, projected by their own packages, validate
 * against the slot engine's `clossys.slot-contract/1` schema.
 */
import { describe, expect, it } from "vitest";
import { agentModule } from "../server/cells.js";
import { validateSlotContract } from "./validate.js";

describe("agent slot contracts against clossys.slot-contract/1", () => {
  it.each([
    ["writer", "loadWriterContracts"],
    ["director", "loadDirectorContracts"],
  ] as const)("every %s contract validates", async (kind, load) => {
    const format = await agentModule(kind, "slot-contracts/format.js");
    const slots = format[load]().slots as unknown[];
    expect(slots.length).toBeGreaterThan(0);
    const failures = slots.map(slot => format.toSlotContractRecord(slot)).map(record => [record.slot, validateSlotContract(record)] as const).filter(([, result]) => !result.ok);
    expect(failures.map(([slot, result]) => `${slot}: ${JSON.stringify((result as { issues?: unknown }).issues)}`)).toEqual([]);
  });

  it("rejects a projection that breaks the shared schema", async () => {
    const format = await agentModule("writer", "slot-contracts/format.js");
    const record = format.toSlotContractRecord(format.loadWriterContracts().slots[0]);
    expect(validateSlotContract({ ...record, limits: { nested: { maxChars: 1 } } }).ok).toBe(false);
    expect(validateSlotContract({ ...record, layer: "other" }).ok).toBe(false);
  });
});
