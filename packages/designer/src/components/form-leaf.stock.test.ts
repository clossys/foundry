import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as components from "./index.js";
import * as root from "../index.js";
import { Checkbox } from "./preview-runtime/components/checkbox/checkbox.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./preview-runtime/components/select/select.js";
import { Switch } from "./preview-runtime/components/switch/switch.js";
import { RadioGroup, RadioGroupItem } from "./preview-runtime/components/radio-group/radio-group.js";
import { Calendar, RangeCalendar } from "./preview-runtime/components/calendar/calendar.js";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "./preview-runtime/components/combo-box/combobox.js";
import { Slider } from "./preview-runtime/components/slider/slider.js";
import shadcnComboBox from "../catalog/fills/shadcn@aria/components.combo-box.json" with { type: "json" };

// R2F-33 D1: the checkbox and select leaves are the stock shadcn@aria parts.
describe("components.checkbox and components.select leaf sources", () => {
  it("exports the stock Checkbox and Select anatomy and no Foundry SelectOption", () => {
    expect([components.Checkbox, root.Checkbox]).toEqual([Checkbox, Checkbox]);
    expect([components.Select, components.SelectTrigger, components.SelectValue, components.SelectContent, components.SelectItem]).toEqual([Select, SelectTrigger, SelectValue, SelectContent, SelectItem]);
    expect([root.Select, root.SelectItem]).toEqual([Select, SelectItem]);
    expect("SelectOption" in components).toBe(false);
    expect("SelectOption" in root).toBe(false);
  });

  it("leaves no Foundry Checkbox or Select module behind", () => {
    for (const file of ["./Checkbox.tsx", "./Select.tsx"]) expect(existsSync(new URL(file, import.meta.url)), file).toBe(false);
  });
});

// R2F-33 D2: the switch, radio-group and calendar leaves are the stock shadcn@aria parts.
describe("components.switch, components.radio-group and components.calendar leaf sources", () => {
  it("exports the stock Switch, RadioGroup/RadioGroupItem and Calendar/RangeCalendar", () => {
    expect([components.Switch, root.Switch]).toEqual([Switch, Switch]);
    expect([components.RadioGroup, components.RadioGroupItem, root.RadioGroup, root.RadioGroupItem]).toEqual([RadioGroup, RadioGroupItem, RadioGroup, RadioGroupItem]);
    expect([components.Calendar, components.RangeCalendar]).toEqual([Calendar, RangeCalendar]);
    expect("Radio" in RadioGroup).toBe(false);
  });

  it("leaves no Foundry Switch, RadioGroup or Calendar module behind", () => {
    for (const file of ["./Switch.tsx", "./RadioGroup.tsx", "./Calendar.tsx"]) expect(existsSync(new URL(file, import.meta.url)), file).toBe(false);
  });
});

// R2F-33c: the combo-box leaf is the stock shadcn@aria combobox; its anatomy is the fill's approved secondary exports.
describe("components.combo-box leaf source", () => {
  it("exports the stock Combobox anatomy the fill approves", () => {
    expect([components.ComboBox, components.ComboboxInput, components.ComboboxContent, components.ComboboxList, components.ComboboxItem]).toEqual([Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem]);
    expect([root.ComboBox, root.ComboboxItem]).toEqual([Combobox, ComboboxItem]);
    expect(shadcnComboBox.components["combo-box"].secondaryExports.map(row => row.name)).toEqual(["ComboboxContent", "ComboboxInput", "ComboboxItem", "ComboboxList"]);
  });

  it("leaves no Foundry ComboBox module behind", () => {
    expect(existsSync(new URL("./ComboBox.tsx", import.meta.url))).toBe(false);
  });
});

// R2F-33c: the slider leaf is the stock shadcn@aria slider; its value text is the stock Intl format.
describe("components.slider leaf source", () => {
  it("exports the stock Slider and no Foundry SliderValue copy", () => {
    expect(components.Slider).toBe(Slider);
    expect("SliderValue" in components).toBe(false);
    expect(existsSync(new URL("./Slider.tsx", import.meta.url))).toBe(false);
  });
});
