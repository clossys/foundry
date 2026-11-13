import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as components from "./index.js";
import * as root from "../index.js";
import * as stock from "./preview-runtime/components/table/table.js";

const PARTS = ["Table", "TableHeader", "TableHead", "TableBody", "TableRow", "TableCell", "TableFooter", "TableCaption"] as const;

// R2F-31 D1: the table leaf is the stock shadcn@aria Table anatomy; the Foundry compound Table is gone.
describe("components.table leaf source", () => {
  it("exports the stock Table anatomy and no Foundry compound parts", () => {
    for (const name of PARTS) {
      expect((components as Record<string, unknown>)[name], name).toBe(stock[name]);
      expect((root as Record<string, unknown>)[name], name).toBe(stock[name]);
    }
    for (const part of ["Header", "Column", "Body", "Row", "Cell", "ResizableContainer", "SelectAllCheckbox", "SelectionCheckbox"]) expect(part in components.Table, part).toBe(false);
  });

  it("leaves no Foundry Table module behind", () => {
    expect(existsSync(new URL("./Table.tsx", import.meta.url))).toBe(false);
  });
});
