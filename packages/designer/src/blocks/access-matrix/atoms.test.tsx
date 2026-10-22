import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Checkbox } from "../../atoms/Checkbox.js";
import { Select } from "../../atoms/Select.js";
import { Tooltip } from "../../atoms/Tooltip.js";

describe("AccessMatrix and ColumnMapper main atom integration", () => {
  it("opens a reason Tooltip from the focusable read-only Checkbox and preserves its persistent description", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<>
      <Tooltip delay={0} closeDelay={0} trigger={
        <Checkbox isReadOnly isSelected aria-describedby="inherited-reason" onChange={changed}>
          <span className="sr-only">Editor: Export reports</span>
        </Checkbox>
      }>Included with Viewer access to reports.</Tooltip>
      <span id="inherited-reason" className="sr-only">Included with Viewer access to reports.</span>
    </>);
    const checkbox = screen.getByRole("checkbox", { name: "Editor: Export reports" });
    await user.tab();
    expect(checkbox).toHaveFocus();
    expect(checkbox).not.toBeDisabled();
    expect(checkbox).toHaveAccessibleDescription(/Included with Viewer access to reports/);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Included with Viewer access to reports.");
    await user.keyboard(" ");
    expect(changed).not.toHaveBeenCalled();
    expect(checkbox).toBeChecked();
  });

  it("accepts the prescribed empty internal Select option and reports it unchanged", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<Select label="Email" placeholder="Not mapped" selectedKey="email" onSelectionChange={changed}
      options={[{ id: "", label: "Not mapped" }, { id: "email", label: "E-mail address" }]} />);
    await user.click(screen.getByRole("button", { name: /Email/ }));
    await user.click(screen.getByRole("option", { name: "Not mapped" }));
    expect(changed).toHaveBeenCalledWith("");
  });
});
