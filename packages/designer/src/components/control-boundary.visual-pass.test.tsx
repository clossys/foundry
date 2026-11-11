import { render, screen } from "@testing-library/react";
import { CalendarDate } from "@internationalized/date";
import { DatePicker, Group } from "react-aria-components";
import { describe, expect, it } from "vitest";
import { buttonClassName } from "./button-classes.js";
import { Checkbox } from "./preview-runtime/components/checkbox/checkbox.js";
import { DateField } from "./DateField.js";
import { RadioGroup, RadioGroupItem } from "./preview-runtime/components/radio-group/radio-group.js";
import { SearchField, SearchInput } from "./intent/search-field.js";
import { Label } from "./intent/field.js";
import { StockSelect } from "../blocks/stock-select.js";
import { StockCombobox } from "../blocks/stock-combobox.js";
import { Switch } from "./preview-runtime/components/switch/switch.js";
import { Textarea } from "./preview-runtime/components/text-field/text-field.js";
import { TextField } from "./preview-runtime/components/text-field/text-field.js";
import { Toggle } from "./preview-runtime/components/toggle-button/toggle.js";

/*
 * Visual pass (VF-8): a control's RESTING boundary is drawn with
 * `--color-line-control` (the `border-line-control` utility), the line role
 * that clears 3:1 against every surface a control sits on (WCAG 1.4.11),
 * so `--color-line-base` can stay a decorative hairline. Selected, invalid
 * and disabled states keep their own treatment.
 */
const OPTIONS = [{ id: "apple", label: "Apple" }, { id: "pear", label: "Pear" }];
const classes = (el: Element | null | undefined): string[] => (el?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);

type Mount = () => Element | null | undefined;
const fields: Array<[string, Mount, Mount]> = [
  ["DateField", () => { render(<DateField label="Start" defaultValue={new CalendarDate(2024, 1, 15)} />); return screen.getByRole("group", { name: /Start/ }); }, () => { render(<DateField label="Start" defaultValue={new CalendarDate(2024, 1, 15)} isInvalid />); return screen.getByRole("group", { name: /Start/ }); }],
  ["SearchField", () => { render(<SearchField><Label>Search</Label><SearchInput /></SearchField>); return screen.getByRole("searchbox"); }, () => { render(<SearchField isInvalid><Label>Search</Label><SearchInput /></SearchField>); return screen.getByRole("searchbox"); }],
];

describe("control boundary line (VF-8)", () => {
  // R2F-51: the Intent UI date and search fields draw the resting boundary with the theme input line (`border-input`,
  // `--color-input`) and carry the invalid state as a data attribute that switches to the destructive border.
  it.each(fields)("%s: resting boundary uses the input line role; invalid switches to the destructive border", (_name, rest, invalid) => {
    const { unmount } = { unmount: () => document.body.replaceChildren() };
    const resting = rest();
    expect(classes(resting)).toContain("border-input");
    expect(classes(resting)).not.toContain("border-line-base");
    expect(resting).not.toHaveAttribute("data-invalid");
    unmount();
    const el = invalid();
    expect(classes(el)).toContain("invalid:border-destructive/70");
    expect(el).toHaveAttribute("data-invalid", "true");
  });

  it.each([
    ["Select", (isInvalid: boolean) => { render(<StockSelect label="Fruit" options={OPTIONS} isInvalid={isInvalid} errorMessage="Pick a fruit" />); return screen.getByRole("button", { name: /Fruit/ }); }],
    ["ComboBox", (isInvalid: boolean) => { render(<StockCombobox label="Fruit" options={OPTIONS} isInvalid={isInvalid} errorMessage="Pick a fruit" />); return screen.getByRole("combobox", { name: /Fruit/ }); }],
  ] as const)("%s: the stock control is named by its field label and carries the invalid state with its error", (_name, mount) => {
    const rest = mount(false);
    expect(rest).toHaveAccessibleName(/Fruit/);
    expect(rest.closest("[data-invalid]")).toBeNull();
    document.body.replaceChildren();
    const invalid = mount(true);
    expect(invalid.closest("[data-invalid]")).not.toBeNull();
    expect(invalid).toHaveAccessibleDescription("Pick a fruit");
  });

  it("DateField: the picker trigger button rests on the same input line as the date input", () => {
    render(<DatePicker defaultValue={new CalendarDate(2024, 1, 15)} aria-label="When">
      <Group><DateField label="When" pickerTrigger={{ label: "Choose date", children: <span /> }} /></Group>
    </DatePicker>);
    const trigger = screen.getByRole("button", { name: /^Choose date/ });
    expect(classes(trigger)).toEqual(expect.arrayContaining(["border", "border-input"]));
    expect(classes(trigger)).not.toContain("border-line-base");
  });

  it("Checkbox: the stock box rests on the strong line and binds selected and invalid to the action and danger edges", () => {
    const { rerender } = render(<Checkbox>Accept</Checkbox>);
    const box = () => screen.getByRole("checkbox").closest('[data-slot="checkbox"]');
    expect(classes(box())).toEqual(expect.arrayContaining(["border-(--color-line-strong)", "data-selected:border-(--color-action)", "data-invalid:border-(--color-status-danger)"]));
    expect(box()).not.toHaveAttribute("data-selected");
    rerender(<Checkbox isSelected>Accept</Checkbox>);
    expect(box()).toHaveAttribute("data-selected", "true");
    rerender(<Checkbox isInvalid>Accept</Checkbox>);
    expect(box()).toHaveAttribute("data-invalid", "true");
  });

  it("Radio: the stock item rests on the strong line and binds selected and invalid to the action and danger edges", () => {
    const { rerender } = render(<RadioGroup aria-label="Speed" defaultValue="a"><RadioGroupItem value="a">A</RadioGroupItem><RadioGroupItem value="b">B</RadioGroupItem></RadioGroup>);
    const item = (name: string) => screen.getByRole("radio", { name }).closest('[data-slot="radio-group-item"]');
    expect(screen.getByRole("radiogroup")).toHaveAccessibleName("Speed");
    expect(classes(item("B"))).toEqual(expect.arrayContaining(["border-(--color-line-strong)", "data-selected:border-(--color-action)", "data-invalid:border-(--color-status-danger)"]));
    expect(item("A")).toHaveAttribute("data-selected", "true");
    expect(item("B")).not.toHaveAttribute("data-selected");
    rerender(<RadioGroup aria-label="Speed" isInvalid><RadioGroupItem value="a">A</RadioGroupItem></RadioGroup>);
    expect(item("A")).toHaveAttribute("data-invalid", "true");
  });

  it("Switch: the stock track rests on the strong line off and fills with the action colour on", () => {
    const { rerender } = render(<Switch aria-label="Alerts" />);
    const track = () => screen.getByRole("switch", { name: "Alerts" }).closest('[data-slot="switch"]');
    expect(classes(track())).toEqual(expect.arrayContaining(["not-data-selected:bg-(--color-line-strong)", "data-selected:bg-(--color-action)"]));
    expect(track()).not.toHaveAttribute("data-selected");
    rerender(<Switch aria-label="Alerts" isSelected />);
    expect(track()).toHaveAttribute("data-selected", "true");
  });

  // R2F-33d1: TextField and Textarea are the stock shadcn@aria input and textarea; stock wins over the Foundry control line.
  it.each([
    ["TextField", (props: { isInvalid?: boolean; isDisabled?: boolean }) => render(<TextField label="Name" {...props} />)],
    ["Textarea", (props: { isInvalid?: boolean; isDisabled?: boolean }) => render(<Textarea label="Name" {...props} />)],
  ] as const)("%s: the stock control rests on the strong line, marks invalid through aria-invalid and stays disabled", (_name, mount) => {
    mount({});
    const rest = screen.getByRole("textbox", { name: "Name" });
    expect(classes(rest)).toEqual(expect.arrayContaining(["border-(--color-line-strong)", "aria-invalid:border-(--color-status-danger)"]));
    expect(rest).not.toHaveAttribute("aria-invalid");
    document.body.replaceChildren();
    mount({ isInvalid: true });
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute("aria-invalid", "true");
    document.body.replaceChildren();
    mount({ isDisabled: true });
    const disabled = screen.getByRole("textbox", { name: "Name" });
    expect(disabled).toBeDisabled();
    expect(classes(disabled)).toContain("disabled:opacity-(--ui-alpha-disabled,50%)");
  });

  it("Button: the outlined (secondary) look rests on the control line; the outline variant keeps its ink ring", () => {
    expect(buttonClassName("secondary", "md").split(" ")).toContain("border-line-control");
    expect(buttonClassName("secondary", "md").split(" ")).not.toContain("border-line-base");
    expect(buttonClassName("outline", "md").split(" ")).toEqual(expect.arrayContaining(["ring-current", "ring-1", "hover:ring-2"]));
    render(<Toggle variant="outline">Bold</Toggle>);
    const toggle = screen.getByRole("button", { name: "Bold" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(classes(toggle)).toContain("border-(--color-line-strong)");
  });
});
