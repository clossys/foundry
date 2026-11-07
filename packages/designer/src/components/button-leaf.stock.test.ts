import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as components from "./index.js";
import * as root from "../index.js";
import { Button, LinkButton } from "./preview-runtime/components/button/button.js";
import { Toggle } from "./preview-runtime/components/toggle-button/toggle.js";

// R2F-28 D1: the button and toggle-button leaves are the stock shadcn@aria Button and Toggle.
describe("components.button and components.toggle-button leaf sources", () => {
  it("exports the stock Button, LinkButton and Toggle and no Foundry ToggleButton", () => {
    expect([components.Button, root.Button]).toEqual([Button, Button]);
    expect([components.LinkButton, root.LinkButton]).toEqual([LinkButton, LinkButton]);
    expect(components.Toggle).toBe(Toggle);
    expect("ToggleButton" in components).toBe(false);
    expect("ToggleButton" in root).toBe(false);
  });

  it("leaves no Foundry Button or ToggleButton module behind", () => {
    for (const file of ["./Button.tsx", "./ToggleButton.tsx"]) expect(existsSync(new URL(file, import.meta.url)), file).toBe(false);
  });
});
