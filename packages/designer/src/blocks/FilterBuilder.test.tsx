import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as blocks from "./index.js";
import type { FilterBuilderProps } from "./FilterBuilder.js";
import { filterBuilderSample } from "./filter-builder/sample.js";

const FilterBuilder = (blocks as Record<string, unknown>).FilterBuilder as (props: FilterBuilderProps) => JSX.Element;
const props = (): FilterBuilderProps => ({ ...filterBuilderSample, onGroupsChange: vi.fn() });

describe("FilterBuilder", () => {
  it("is a public blocks export rendering one labelled group per filter group with field, operator and value per condition", () => {
    render(<FilterBuilder {...props()} />);
    expect(screen.getByRole("group", { name: "Filter records" }).tagName).toBe("FIELDSET");
    const groups = screen.getAllByRole("group", { name: /^Group \d/ });
    expect(groups).toHaveLength(2);
    expect(within(groups[0]!).getByRole("button", { name: "Status Field" })).toBeInTheDocument();
    expect(within(groups[0]!).getByRole("button", { name: "is Operator" })).toBeInTheDocument();
    expect(within(groups[0]!).getByRole("textbox", { name: "Value" })).toHaveValue("Active");
    expect(within(groups[1]!).getByRole("button", { name: "Any condition Match" })).toBeInTheDocument();
  });

  it("hides the value input for an operator that takes no value", () => {
    render(<FilterBuilder {...props()} />);
    const second = screen.getAllByRole("group", { name: /^Group \d/ })[1]!;
    expect(within(second).getAllByRole("textbox")).toHaveLength(1);
  });

  it("emits a new condition, a removed condition and a new group without mutating the host value", async () => {
    const user = userEvent.setup(), original = props();
    render(<FilterBuilder {...original} />);
    const first = screen.getAllByRole("group", { name: /^Group \d/ })[0]!;
    await user.click(within(first).getByRole("button", { name: "Add condition" }));
    const added = (original.onGroupsChange as ReturnType<typeof vi.fn>).mock.lastCall![0] as FilterBuilderProps["groups"];
    expect(added[0]!.conditions).toHaveLength(2);
    expect(added[0]!.conditions[1]).toMatchObject({ field: "status", operator: "is", value: "" });
    expect(new Set(added[0]!.conditions.map(row => row.id)).size).toBe(2);
    expect(original.groups[0]!.conditions).toHaveLength(1);
    await user.click(within(first).getByRole("button", { name: "Remove condition 1" }));
    expect((original.onGroupsChange as ReturnType<typeof vi.fn>).mock.lastCall![0][0].conditions).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Add group" }));
    const grown = (original.onGroupsChange as ReturnType<typeof vi.fn>).mock.lastCall![0] as FilterBuilderProps["groups"];
    expect(grown).toHaveLength(3);
    expect(grown[2]).toMatchObject({ match: "all", conditions: [{ field: "status", operator: "is", value: "" }] });
  });

  it("emits a typed value and a changed field", async () => {
    const user = userEvent.setup(), original = props();
    render(<FilterBuilder {...original} />);
    const first = screen.getAllByRole("group", { name: /^Group \d/ })[0]!;
    await user.type(within(first).getByRole("textbox", { name: "Value" }), "!");
    expect((original.onGroupsChange as ReturnType<typeof vi.fn>).mock.lastCall![0][0].conditions[0].value).toBe("Active!");
    await user.click(within(first).getByRole("button", { name: "Status Field" }));
    await user.click(screen.getByRole("option", { name: "Owner" }));
    expect((original.onGroupsChange as ReturnType<typeof vi.fn>).mock.lastCall![0][0].conditions[0].field).toBe("owner");
  });

  it("refuses a condition that names an unknown field or operator", () => {
    const bad = props();
    expect(() => render(<FilterBuilder {...bad} groups={[{ id: "g", match: "all", conditions: [{ id: "c", field: "missing", operator: "is", value: "" }] }]} />)).toThrow(/FilterBuilder: unknown field missing/);
    expect(() => render(<FilterBuilder {...bad} groups={[{ id: "g", match: "all", conditions: [{ id: "c", field: "status", operator: "nope", value: "" }] }]} />)).toThrow(/FilterBuilder: unknown operator nope/);
  });
});
