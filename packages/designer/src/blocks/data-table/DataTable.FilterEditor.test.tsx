import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilterEditor } from "./FilterEditor.js";
import type { TableFilter } from "../table-model/index.js";

type DateFilter = Extract<TableFilter, { kind: "date" }>;
const cases: { name: string; bounds: { min?: number; max?: number }; edited: "min" | "max"; text: string; untouched: "min" | "max"; epoch: number }[] = [
  { name: "epoch-zero minimum", bounds: { min: 0 }, edited: "max", text: "2025-01-01", untouched: "min", epoch: 0 },
  { name: "epoch maximum", bounds: { max: 1735689600000 }, edited: "min", text: "2024-01-01", untouched: "max", epoch: 1735689600000 },
  { name: "two epochs with a millisecond minimum", bounds: { min: 1735689600123, max: 1735862400000 }, edited: "max", text: "2025-01-04", untouched: "min", epoch: 1735689600123 },
  { name: "two epochs with a millisecond maximum", bounds: { min: 0, max: 1735689600123 }, edited: "min", text: "1970-01-02", untouched: "max", epoch: 1735689600123 },
];

describe("DataTable date-range editing", () => {
  it.each(cases)("preserves the saved $name when only the other bound is edited", async ({ bounds, edited, text, untouched, epoch }) => {
    const user = userEvent.setup();
    const change = vi.fn();
    const filter: DateFilter = { column: "created", kind: "date", op: "range", ...bounds };
    render(<FilterEditor filter={filter} label="Created" facets={[]} change={change} />);
    const input = screen.getByRole("textbox", { name: edited === "min" ? "Minimum Created" : "Maximum Created" });
    await user.clear(input);
    await user.type(input, text);
    await user.click(screen.getByRole("button", { name: "Apply Created range" }));

    expect(change).toHaveBeenCalledTimes(1);
    const next = change.mock.lastCall![0] as DateFilter;
    expect(new Date(next[untouched]!).getTime()).toBe(epoch);
    expect(new Date(next[edited]!).getTime()).toBe(Date.parse(text));
    expect(screen.queryByText("Enter valid bounds with minimum no greater than maximum.")).not.toBeInTheDocument();
    expect(filter).toEqual({ column: "created", kind: "date", op: "range", ...bounds });
  });
});
