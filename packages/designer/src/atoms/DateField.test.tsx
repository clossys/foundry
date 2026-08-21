import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarDate } from "@internationalized/date";
import { DateField } from "./DateField.js";

describe("DateField", () => {
  it("renders a labeled group of editable segments", () => {
    render(<DateField label="Start date" defaultValue={new CalendarDate(2024, 1, 15)} />);
    expect(screen.getByText("Start date")).toBeInTheDocument();
    const group = screen.getByRole("group", { name: /Start date/ });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("spinbutton")).toHaveLength(3);
  });

  it("increments the focused segment with ArrowUp and reports the new date via onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DateField label="Start date" defaultValue={new CalendarDate(2024, 1, 15)} onChange={onChange} />,
    );
    const day = screen.getByRole("spinbutton", { name: /day/ });
    day.focus();
    await user.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenCalledWith(new CalendarDate(2024, 1, 16));
  });

  it("typing a complete segment auto-advances focus to the next one", async () => {
    const user = userEvent.setup();
    render(<DateField label="Start date" defaultValue={new CalendarDate(2024, 1, 1)} />);
    const month = screen.getByRole("spinbutton", { name: /month/ });
    month.focus();
    await user.keyboard("03");
    const day = screen.getByRole("spinbutton", { name: /day/ });
    expect(day).toHaveFocus();
  });

  it("renders a description and links it to the segment group via aria-describedby", () => {
    render(
      <DateField
        label="Start date"
        defaultValue={new CalendarDate(2024, 1, 15)}
        description="Use your local time zone."
      />,
    );
    const group = screen.getByRole("group", { name: /Start date/ });
    const description = screen.getByText("Use your local time zone.");
    expect(group.getAttribute("aria-describedby")).toContain(description.id);
  });

  it("announces a validation error, linked via aria-describedby, only while invalid", () => {
    render(
      <DateField
        label="Start date"
        defaultValue={new CalendarDate(2024, 1, 15)}
        isInvalid
        errorMessage="A start date is required."
      />,
    );
    const group = screen.getByRole("group", { name: /Start date/ });
    const error = screen.getByText("A start date is required.");
    expect(group.getAttribute("aria-describedby")).toContain(error.id);
  });

  it("forwards className onto the outer wrapper, and the consumer's conflicting class wins the merge", () => {
    render(
      <DateField label="Start date" defaultValue={new CalendarDate(2024, 1, 15)} className="gap-lg" />,
    );
    const wrapper = screen.getByText("Start date").closest("div") as HTMLElement;
    expect(wrapper.className).toContain("gap-lg");
    expect(wrapper.className).not.toContain("gap-xs");
  });

  it("disabled: every segment reports its disabled state and does not accept ArrowUp changes", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <DateField
        label="Start date"
        defaultValue={new CalendarDate(2024, 1, 15)}
        onChange={onChange}
        isDisabled
      />,
    );
    const day = screen.getByRole("spinbutton", { name: /day/ });
    expect(day).toHaveAttribute("aria-disabled", "true");
    day.focus();
    await user.keyboard("{ArrowUp}");
    expect(onChange).not.toHaveBeenCalled();
  });
});
