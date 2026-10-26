import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CalendarDate, CalendarDateTime } from "@internationalized/date";
import { DateField } from "./DateField.js";
import { DatePicker, DateRangePicker, Group } from "react-aria-components";
import { createRef } from "react";
import { UI_RING_FOCUS } from "./internal/ui-vars.js";

describe("DateField", () => {
  it("takes its input and picker-trigger height from the md control-size token, not from block padding", () => {
    render(<DateField label="Start date" defaultValue={new CalendarDate(2024, 1, 15)} pickerTrigger={{ label: "Open calendar", children: "+" }} />);
    const input = screen.getAllByRole("spinbutton")[0]!.parentElement!;
    const trigger = screen.getByRole("button", { name: "Open calendar" });
    for (const element of [input, trigger]) {
      expect(element.className.split(/\s+/)).toContain("control-h-md");
      expect(element.className).not.toMatch(/(?:^|\s)py-/);
    }
    // control-h-md lays a positioned tap-target ::before over the input; positioned segments stay above it and keep pointer hits.
    for (const segment of screen.getAllByRole("spinbutton")) expect(segment.className.split(/\s+/)).toContain("relative");
  });

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

describe("W2 source-local optional pickerTrigger", () => {
  it("omitting pickerTrigger preserves the standalone field with no button", () => {
    const { container } = render(<DateField label="Date" defaultValue={new CalendarDate(2024, 1, 15)} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getAllByRole("spinbutton")).toHaveLength(3);
    expect(container.firstElementChild?.children).toHaveLength(3);
    expect(screen.getByRole("group", { name: /Date/ })).toHaveClass("bg-surface-raised");
  });

  it("single: pickerTrigger names one child-owned button after the date input and consumes picker context", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<DatePicker defaultValue={new CalendarDate(2024, 1, 15)} onOpenChange={onOpenChange} aria-label="Appointment">
      <Group><DateField label="Appointment" pickerTrigger={{ label: "Choose appointment date", children: <span data-testid="date-glyph" /> }} /></Group>
    </DatePicker>);
    const trigger = screen.getByRole("button", { name: /^Choose appointment date/ });
    expect(trigger).toContainElement(screen.getByTestId("date-glyph"));
    expect(trigger.parentElement?.firstElementChild).toHaveClass("bg-surface-raised");
    expect(trigger).toHaveClass("rounded-control", "text-ink-primary");
    await user.click(trigger);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it("range: only the end field receives pickerTrigger; start/end slots retain one parent value", async () => {
    const user = userEvent.setup(); const onChange = vi.fn(); const onOpenChange = vi.fn();
    const { container } = render(<DateRangePicker aria-label="Stay" defaultValue={{ start: new CalendarDate(2024, 1, 15), end: new CalendarDate(2024, 1, 20) }} onChange={onChange} onOpenChange={onOpenChange}>
      <Group>
        <DateField label="Arrival" slot="start" />
        <DateField label="Departure" slot="end" pickerTrigger={{ label: "Choose stay dates", children: <span /> }} />
      </Group>
    </DateRangePicker>);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    const endDay = container.querySelector<HTMLElement>('[slot="end"] [data-type="day"]')!;
    endDay.focus(); await user.keyboard("{ArrowUp}");
    expect(onChange).toHaveBeenLastCalledWith({ start: new CalendarDate(2024, 1, 15), end: new CalendarDate(2024, 1, 21) });
    await user.click(screen.getByRole("button", { name: /^Choose stay dates/ }));
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it.each(["isDisabled", "isReadOnly"] as const)("pickerTrigger respects parent %s context without opening", async flag => {
    const onOpenChange = vi.fn(); const user = userEvent.setup();
    render(<DatePicker aria-label="Appointment" {...{ [flag]: true }} onOpenChange={onOpenChange}>
      <Group><DateField label="Date" pickerTrigger={{ label: "Choose date", children: <span /> }} /></Group>
    </DatePicker>);
    const trigger = screen.getByRole("button", { name: /^Choose date/ });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("pickerTrigger owns its keyboard focus indicator through the existing field token", async () => {
    const user = userEvent.setup();
    render(<DatePicker aria-label="Appointment"><Group><DateField label="Date" pickerTrigger={{ label: "Choose date", children: <span /> }} /></Group></DatePicker>);
    screen.getByRole("spinbutton", { name: /year/ }).focus();
    await user.tab();
    const trigger = screen.getByRole("button", { name: /^Choose date/ });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("data-focus-visible", "true");
    expect(trigger.style.boxShadow).toBe(UI_RING_FOCUS);
  });

  it("forwards the field ref and function className/style without adding a trigger by default", () => {
    const ref = createRef<HTMLDivElement>();
    render(<DateField label="Date" ref={ref} isInvalid className={state => state.isInvalid ? "invalid-field" : "valid-field"} style={state => ({ opacity: state.isInvalid ? 0.8 : 1 })} />);
    expect(ref.current).toHaveClass("invalid-field");
    expect(ref.current).toHaveStyle({ opacity: "0.8" });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

 it("SEL2 retains minute and second granularity and edits time through RAC", async () => {
  const onChange = vi.fn(); const user = userEvent.setup();
  const {rerender} = render(<DateField label="Start" defaultValue={new CalendarDateTime(2024,1,15,13,20,30)} granularity="second" onChange={onChange} />);
  const second = screen.getByRole("spinbutton", {name: /second/});
  second.focus(); await user.keyboard("{ArrowUp}");
  expect(onChange).toHaveBeenLastCalledWith(new CalendarDateTime(2024,1,15,13,20,31));
  rerender(<DateField label="Start" defaultValue={new CalendarDateTime(2024,1,15,13,20,30)} granularity="minute" />);
  expect(screen.queryByRole("spinbutton", {name: /second/})).not.toBeInTheDocument();
  expect(screen.getByRole("spinbutton", {name: /minute/})).toBeInTheDocument();
 });
