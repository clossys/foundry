import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ColumnMapper, type ColumnMapperProps } from "./ColumnMapper.js";
import { columnMapperSample } from "./column-mapper/sample.js";

afterEach(() => vi.useRealTimers());
const props = () => ({ ...columnMapperSample, onMappingChange: vi.fn() });

describe("ColumnMapper", () => {
  it("renders the sample fieldset, named selects, required copy, samples, and missing-required error (MC4)", () => {
    render(<ColumnMapper {...props()} />);
    expect(screen.getByRole("group", { name: "Match file columns to fields" }).tagName).toBe("FIELDSET");
    expect(screen.getAllByRole("button")).toHaveLength(4);
    for (const target of columnMapperSample.targets) expect(screen.getByRole("button", { name: new RegExp(target.label) })).toBeInTheDocument();
    expect(screen.getAllByText("Required")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Full name/ })).toHaveAccessibleDescription(/Examples: Ada Lovelace, Grace Hopper/);
    expect(screen.getByRole("button", { name: /Email/ })).toHaveAccessibleDescription(/Email needs a column/);
    expect(screen.getByRole("status")).toHaveTextContent("3 of 4 fields mapped, 1 to fix");
  });

  it("emits selected source ids and converts only the internal empty option to null", async () => {
    const user = userEvent.setup(), original = props();
    const { rerender } = render(<ColumnMapper {...original} />);
    await user.click(screen.getByRole("button", { name: /Email/ }));
    await user.click(screen.getByRole("option", { name: "E-mail address" }));
    const next = { ...original.mapping, email: "email" };
    expect(original.onMappingChange).toHaveBeenLastCalledWith(next);
    expect(original.mapping.email).toBeNull();
    rerender(<ColumnMapper {...original} mapping={next} />);
    await user.click(screen.getByRole("button", { name: /Email/ }));
    await user.click(screen.getByRole("option", { name: "Not mapped" }));
    expect(original.onMappingChange).toHaveBeenLastCalledWith({ ...next, email: null });
  });

  it("flags a duplicate source on each target, appends host issues, and counts problems", () => {
    render(<ColumnMapper {...props()} mapping={{ name: "name", email: "name", department: "team", start: "joined" }} issues={[{ targetId: "email", message: "Choose an address column" }]} />);
    expect(screen.getAllByText('"Name" is used more than once')).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Full name/ })).toHaveAccessibleDescription(/"Name" is used more than once/);
    expect(screen.getByRole("button", { name: /Email/ })).toHaveAccessibleDescription(/Choose an address column/);
    expect(screen.getByRole("status")).toHaveTextContent("4 of 4 fields mapped, 3 to fix");
  });

  it("does not treat null or absent mappings as duplicates (MC3)", () => {
    render(<ColumnMapper {...props()} mapping={{ name: null, email: null }} />);
    expect(screen.queryByText(/used more than once/)).not.toBeInTheDocument();
    expect(screen.getByText("Full name needs a column")).toBeInTheDocument();
    expect(screen.getByText("Email needs a column")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 of 4 fields mapped, 2 to fix");
  });

  it.each(["constructor", "toString", "__proto__"])("treats a missing declared prototype-shaped target %s as null everywhere", targetId => {
    const original = props();
    render(<ColumnMapper {...original} targets={[{ id: targetId, label: "Email", kind: "text", required: true }]} mapping={{}} />);
    expect(screen.getByRole("button", { name: /Email/ })).toHaveTextContent("Not mapped");
    expect(screen.getByRole("button", { name: /Email/ })).toHaveAccessibleDescription("Email needs a column");
    expect(screen.queryByText(/Examples:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/used more than once/)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("0 of 1 fields mapped, 1 to fix");
  });

  it("debounces status changes by 500ms while retaining its mounted polite region", () => {
    vi.useFakeTimers();
    const original = props();
    const { rerender } = render(<ColumnMapper {...original} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    rerender(<ColumnMapper {...original} mapping={{ ...original.mapping, email: "email" }} />);
    act(() => { vi.advanceTimersByTime(499); });
    expect(status).toHaveTextContent("3 of 4 fields mapped, 1 to fix");
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole("status")).toBe(status);
    expect(status).toHaveTextContent("4 of 4 fields mapped, 0 to fix");
  });

  it.each([
    ["mapping key", (p: ColumnMapperProps) => ({ ...p, mapping: { ...p.mapping, unknown: null } })],
    ["duplicate target", (p: ColumnMapperProps) => ({ ...p, targets: [...p.targets, p.targets[0]] })],
    ["duplicate source", (p: ColumnMapperProps) => ({ ...p, sourceColumns: [...p.sourceColumns, p.sourceColumns[0]] })],
  ] as const)("rejects undeclared and duplicate identities: %s", (_name, change) => {
    expect(() => render(<ColumnMapper {...change(props()) as ColumnMapperProps} />)).toThrow(TypeError);
  });
});
