import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as components from "./index.js";
import * as root from "../index.js";
import * as dialog from "./preview-runtime/components/dialog/dialog.js";
import * as menu from "./preview-runtime/components/menu/dropdown-menu.js";
import * as popover from "./preview-runtime/components/popover/popover.js";
import * as tooltip from "./preview-runtime/components/tooltip/tooltip.js";

const PARTS: ReadonlyArray<readonly [string, unknown]> = [
  ["Menu", menu.DropdownMenu], ["InlineMenu", menu.InlineMenu],
  ...(["Dialog", "DialogTrigger", "DialogHeader", "DialogTitle", "DialogDescription"] as const).map(name => [name, dialog[name]] as const),
  ...(["Popover", "PopoverTrigger"] as const).map(name => [name, popover[name]] as const),
  ...(["Tooltip", "TooltipTrigger"] as const).map(name => [name, tooltip[name]] as const),
];

// R2F-32 D1: the menu, dialog, popover and tooltip leaves are the stock shadcn@aria overlays; the Foundry copies are gone.
describe("overlay leaf sources", () => {
  it("exports the stock overlay parts from the components barrel and the package root", () => {
    for (const [name, stock] of PARTS) {
      expect(stock, name).toBeTypeOf("function");
      expect((components as Record<string, unknown>)[name], name).toBe(stock);
      expect((root as Record<string, unknown>)[name], name).toBe(stock);
    }
  });

  it("leaves no Foundry overlay module behind", () => {
    for (const file of ["./Menu.tsx", "./Dialog.tsx", "./Popover.tsx", "./Tooltip.tsx", "./internal/menu-contract.check.tsx"]) expect(existsSync(new URL(file, import.meta.url)), file).toBe(false);
  });
});
