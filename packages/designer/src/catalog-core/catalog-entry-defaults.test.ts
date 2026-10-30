/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import * as catalogEntry from "./index.js";
import type { ComponentDefaultBasis, ComponentDefaultRow, ComponentDefaultsInput, ComponentDefaultsPlan } from "./index.js";
import { planComponentDefaults } from "./component-defaults.js";

describe("catalog entry component-defaults surface", () => {
  it("exports planComponentDefaults from the catalog entry as the same function", () => {
    expect(typeof catalogEntry.planComponentDefaults).toBe("function");
    expect(catalogEntry.planComponentDefaults).toBe(planComponentDefaults);
  });

  it("exposes the four planner types from the catalog entry", () => {
    const basis: ComponentDefaultBasis = "owner-pick";
    const row: ComponentDefaultRow = { slot: "components.button", status: "default", basis, reasons: [] };
    const plan: ComponentDefaultsPlan = { rows: [row], decisions: [], findings: [] };
    const plan2: ReturnType<typeof catalogEntry.planComponentDefaults> = plan;
    const input: Pick<ComponentDefaultsInput, "slots" | "preference"> = { slots: ["components.button"], preference: ["foundry"] };
    expect(plan2.rows[0]?.basis).toBe("owner-pick");
    expect(input.slots).toEqual(["components.button"]);
  });
});
