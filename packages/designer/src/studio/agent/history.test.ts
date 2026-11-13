import { expect, it } from "vitest";
import { designerWriteHistory } from "./history.js";
import type { DesignerReceipt } from "../../library-cli/write-receipt.js";
it("filters direct and changes-array leaf stamps newest first without mutating them", () => {
  const writes = [{ leaf: "themes.shadow" }, { leaf: "themes.radius" }, { changes: [{ slot: "themes.shadow" }] }].map((inputs, index) => ({ command: "designer-library apply", inputs, contentHash: String(index), unreceipted: [] }));
  const receipt = { version: 1, files: {}, writes } as DesignerReceipt;
  expect(designerWriteHistory(receipt, "themes.shadow").map(r => r.index)).toEqual([2, 0]);
  expect(designerWriteHistory(undefined, "themes.shadow")).toEqual([]);
  expect(receipt.writes).toEqual(writes);
});
