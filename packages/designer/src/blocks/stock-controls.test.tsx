import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { MatrixChoices } from "./matrix/choices.js";
import { StockSwitch } from "./stock-switch.js";

afterEach(cleanup);

// R2F-33 D2: callers of the stock switch and radio group name them, since neither stock part has a label.
describe("stock switch and radio group callers", () => {
  it("names the stock switch by the label beside its track and toggles it", async () => {
    const user = userEvent.setup();
    const { container } = render(<StockSwitch defaultSelected={false}>Weekly summary</StockSwitch>);
    const control = screen.getByRole("switch", { name: "Weekly summary" });
    const track = control.closest('[data-slot="switch"]')!;
    // The label sits beside the track, never inside it.
    expect(track).not.toHaveTextContent("Weekly summary");
    expect(container).toHaveTextContent("Weekly summary");
    expect(control).not.toBeChecked();
    await user.click(control);
    expect(control).toBeChecked();
  });

  it("names each matrix choices row group by its row name", () => {
    const radio = (value: string) => <span>{value}</span>;
    render(<MatrixChoices arrangement="choices" aria-label="Choices" columns={[{ id: "a", label: "A" }, { id: "b", label: "B" }]}
      rows={[{ id: "first", label: "First", name: "First leaf", selected: "a", cells: { a: radio("a"), b: radio("b") } },
        { id: "second", label: "Second", name: "Second leaf", selected: null, cells: { a: radio("a"), b: radio("b") } }]}
      onChange={() => {}} />);
    const groups = screen.getAllByRole("radiogroup");
    expect(groups.map(group => group.getAttribute("aria-labelledby") && document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent)).toEqual(["First leaf", "Second leaf"]);
    expect(screen.getByRole("radiogroup", { name: "Second leaf" })).toBe(groups[1]);
    expect(within(groups[0]!).getByText("a")).toBeInTheDocument();
  });
});
