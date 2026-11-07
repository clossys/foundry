import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as components from "./index.js";
import * as root from "../index.js";
import { Checkbox } from "./preview-runtime/components/checkbox/checkbox.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./preview-runtime/components/select/select.js";

// R2F-33 D1: the checkbox and select leaves are the stock shadcn@aria parts.
describe("components.checkbox and components.select leaf sources", () => {
  it("exports the stock Checkbox and Select anatomy and no Foundry SelectOption", () => {
    expect([components.Checkbox, root.Checkbox]).toEqual([Checkbox, Checkbox]);
    expect([components.Select, components.SelectTrigger, components.SelectValue, components.SelectContent, components.SelectItem]).toEqual([Select, SelectTrigger, SelectValue, SelectContent, SelectItem]);
    expect([root.Select, root.SelectItem]).toEqual([Select, SelectItem]);
    expect("SelectOption" in components).toBe(false);
    expect("SelectOption" in root).toBe(false);
  });

  it("leaves no Foundry Checkbox or Select module behind", () => {
    for (const file of ["./Checkbox.tsx", "./Select.tsx"]) expect(existsSync(new URL(file, import.meta.url)), file).toBe(false);
  });
});
