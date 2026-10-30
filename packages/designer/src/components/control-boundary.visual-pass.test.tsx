import { render, screen } from "@testing-library/react";
import { CalendarDate } from "@internationalized/date";
import { DatePicker, Group, Label } from "react-aria-components";
import { describe, expect, it } from "vitest";
import { buttonClassName } from "./button-classes.js";
import { Checkbox } from "./Checkbox.js";
import { ComboBox } from "./ComboBox.js";
import { DateField } from "./DateField.js";
import { NumberField } from "./NumberField.js";
import { RadioGroup, RadioGroupItem } from "./preview-runtime/components/radio-group/radio-group.js";
import { SearchField } from "./SearchField.js";
import { Select } from "./Select.js";
import { Switch } from "./Switch.js";
import { Textarea } from "./Textarea.js";
import { TextField } from "./TextField.js";
import { ToggleButton } from "./ToggleButton.js";

/*
 * Visual pass (VF-8): a control's RESTING boundary is drawn with
 * `--color-line-control` (the `border-line-control` utility), the line role
 * that clears 3:1 against every surface a control sits on (WCAG 1.4.11),
 * so `--color-line-base` can stay a decorative hairline. Selected, invalid
 * and disabled states keep their own treatment.
 */
const OPTIONS = [{ id: "apple", label: "Apple" }, { id: "pear", label: "Pear" }];
const names = { incrementLabel: "Increase", decrementLabel: "Decrease" };
const classes = (el: Element | null | undefined): string[] => (el?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

function expectControlLine(el: Element | null | undefined): void {
  expect(classes(el)).toContain("border-line-control");
  expect(classes(el)).not.toContain("border-line-base");
}

type Mount = () => Element | null | undefined;
const fields: Array<[string, Mount, Mount]> = [
  ["TextField", () => { render(<TextField label="Name" />); return screen.getByRole("textbox"); }, () => { render(<TextField label="Name" isInvalid />); return screen.getByRole("textbox"); }],
  ["Textarea", () => { render(<Textarea label="Notes" />); return screen.getByRole("textbox"); }, () => { render(<Textarea label="Notes" isInvalid />); return screen.getByRole("textbox"); }],
  ["SearchField", () => { render(<SearchField label="Search" />); return screen.getByRole("searchbox"); }, () => { render(<SearchField label="Search" isInvalid />); return screen.getByRole("searchbox"); }],
  ["Select", () => { render(<Select label="Fruit" options={OPTIONS} />); return screen.getByRole("button"); }, () => { render(<Select label="Fruit" options={OPTIONS} isInvalid />); return screen.getByRole("button"); }],
  ["ComboBox", () => { render(<ComboBox label="Fruit" options={OPTIONS} />); return screen.getByRole("combobox").parentElement; }, () => { render(<ComboBox label="Fruit" options={OPTIONS} isInvalid />); return screen.getByRole("combobox").parentElement; }],
  ["NumberField", () => { render(<NumberField {...names} label="Qty" />); return screen.getByRole("textbox").closest("[role=group]"); }, () => { render(<NumberField {...names} label="Qty" isInvalid />); return screen.getByRole("textbox").closest("[role=group]"); }],
  ["DateField", () => { render(<DateField label="Start" defaultValue={new CalendarDate(2024, 1, 15)} />); return screen.getByRole("group", { name: /Start/ }); }, () => { render(<DateField label="Start" defaultValue={new CalendarDate(2024, 1, 15)} isInvalid />); return screen.getByRole("group", { name: /Start/ }); }],
];

describe("control boundary line (VF-8)", () => {
  it.each(fields)("%s: resting boundary uses border-line-control; invalid keeps the danger border", (_name, rest, invalid) => {
    const { unmount } = { unmount: () => document.body.replaceChildren() };
    expectControlLine(rest());
    unmount();
    const el = invalid();
    expect(classes(el)).toContain("border-status-danger");
    expect(classes(el)).not.toContain("border-line-control");
  });

  it("DateField: the picker trigger button rests on the control line", () => {
    render(<DatePicker defaultValue={new CalendarDate(2024, 1, 15)} aria-label="When">
      <Group><DateField label="When" pickerTrigger={{ label: "Choose date", children: <span /> }} /></Group>
    </DatePicker>);
    expectControlLine(screen.getByRole("button", { name: /^Choose date/ }));
  });

  it("Checkbox: unchecked mark rests on the control line; checked keeps the action edge; invalid keeps danger", () => {
    const { rerender, container } = render(<Checkbox>Accept</Checkbox>);
    const mark = () => container.querySelector('[data-part="control-mark"]');
    expectControlLine(mark());
    rerender(<Checkbox isSelected>Accept</Checkbox>);
    expect(classes(mark())).toContain("border-action");
    expect(classes(mark())).not.toContain("border-line-control");
    rerender(<Checkbox isInvalid>Accept</Checkbox>);
    expect(classes(mark())).toContain("border-status-danger");
    expect(classes(mark())).not.toContain("border-line-control");
  });

  it("Radio retains pinned native state hooks and caller-owned naming", () => {
    const { rerender } = render(<RadioGroup defaultValue="a"><Label>Speed</Label><RadioGroupItem value="a">A</RadioGroupItem><RadioGroupItem value="b">B</RadioGroupItem></RadioGroup>);
    const option = (name: string) => screen.getByRole("radio", { name }).closest("label");
    expect(option("A")).toHaveClass("cn-radio-group-item", "cn-radio-group-item-aria");
    expect(option("A")).toHaveAttribute("data-selected");
    expect(option("B")).not.toHaveAttribute("data-selected");
    rerender(<RadioGroup isInvalid><Label>Speed</Label><RadioGroupItem value="a">A</RadioGroupItem></RadioGroup>);
    expect(screen.getByRole("radiogroup", { name: "Speed" })).toHaveAttribute("aria-invalid", "true");
  });

  it("Switch: off track rests on the control line; on keeps the action edge", () => {
    const { rerender, container } = render(<Switch>Alerts</Switch>);
    const track = () => container.querySelector('[data-part="switch-track"]');
    expectControlLine(track());
    rerender(<Switch isSelected>Alerts</Switch>);
    expect(classes(track())).toContain("border-action");
    expect(classes(track())).not.toContain("border-line-control");
  });

  it("disabled controls keep the disabled alpha on top of the control line", () => {
    render(<TextField label="Name" isDisabled />);
    const input = screen.getByRole("textbox");
    expectControlLine(input);
    expect(input).toBeDisabled();
  });

  it("Button: the outlined (secondary) look rests on the control line; the outline variant keeps its ink ring", () => {
    expect(buttonClassName("secondary", "md").split(" ")).toContain("border-line-control");
    expect(buttonClassName("secondary", "md").split(" ")).not.toContain("border-line-base");
    expect(buttonClassName("outline", "md").split(" ")).toEqual(expect.arrayContaining(["ring-current", "ring-1", "hover:ring-2"]));
    render(<ToggleButton>Bold</ToggleButton>);
    expectControlLine(screen.getByRole("button", { name: "Bold" }));
  });
});
