import { SettingsSection } from "../../blocks/SettingsSection.js";
import type { SettingsSectionGroup } from "../../blocks/SettingsSection.js";
import { Button } from "../../selected-components/Button.js";
import { Select } from "../../selected-components/Select.js";
import { Switch } from "../../selected-components/Switch.js";
import { anatomyOf, noop, recordsOf, refuseUnmapped, requiredAnatomy, requireSlot, slotValue, stringField, textOf, type RuntimeObject, type SectionInputs, type SectionRenderer } from "./group-c-content.js";

const LEAF = "sections.settings";

/**
 * groups -> SettingsSection.groups (each control a registered Switch or Select); dirty -> SettingsSection.dirty
 * (group ids); save-bar -> SettingsSection.saveBar (discard and save Buttons) and its labels. The section heading
 * is anatomy copy no contract slot carries.
 */
export const settingsInputs: SectionInputs = { slots: ["groups", "dirty", "save-bar"], members: [] };

function control(group: string, row: RuntimeObject, index: number) {
  const id = stringField(row, "id") ?? `${group}-${index}`, label = stringField(row, "label"), kind = stringField(row, "kind") ?? "switch";
  if (!label) throw new TypeError(`${LEAF}: group ${group} control ${index} needs a label`);
  if (kind === "switch") return <Switch key={id} id={id} defaultSelected={row.selected === true}>{label}</Switch>;
  if (kind === "select") {
    const options = recordsOf(LEAF, "groups", row.options ?? []).map(option => ({ id: stringField(option, "id") ?? "", label: stringField(option, "label") ?? "" }));
    if (!options.length || options.some(option => !option.id || !option.label)) throw new TypeError(`${LEAF}: select ${id} needs options with an id and a label`);
    return <Select key={id} id={id} label={label} placeholder={stringField(row, "placeholder")} options={options} defaultSelectedKey={stringField(row, "selected")} />;
  }
  throw new TypeError(`${LEAF}: control kind ${kind} has no component the contract allows`);
}

export const renderSettings: SectionRenderer = input => {
  refuseUnmapped(input, settingsInputs);
  const heading = requiredAnatomy(input, LEAF, "heading");
  const { description } = anatomyOf(input);
  const groups = recordsOf(LEAF, "groups", requireSlot(input, LEAF, "groups")).map((row, index): SettingsSectionGroup => {
    const id = stringField(row, "id"), legend = stringField(row, "legend");
    if (!id || !legend) throw new TypeError(`${LEAF}: group ${index} needs an id and a legend`);
    const groupDescription = stringField(row, "description");
    return { id, legend, ...(groupDescription ? { description: groupDescription } : {}), children: recordsOf(LEAF, "groups", row.controls ?? []).map((item, at) => control(id, item, at)) };
  });
  const dirtyValue = slotValue(input, "dirty");
  const dirty = (Array.isArray(dirtyValue) ? dirtyValue : dirtyValue === undefined ? [] : [dirtyValue]).map(row => textOf(row) ?? stringField(row, "id"));
  if (dirty.some(id => !id)) throw new TypeError(`${LEAF}: dirty lists group ids`);
  const bar = slotValue(input, "save-bar");
  const save = stringField(bar, "save"), discard = stringField(bar, "discard"), unsaved = stringField(bar, "unsaved"), barLabel = stringField(bar, "label");
  if (bar !== undefined && (!save || !barLabel)) throw new TypeError(`${LEAF}: save-bar needs a label and a save label`);
  if (dirty.length && !unsaved) throw new TypeError(`${LEAF}: dirty groups need the save-bar's unsaved label`);
  return (
    <SettingsSection
      heading={heading}
      description={description}
      groups={groups}
      dirty={dirty as string[]}
      saveBar={save ? [
        discard ? <Button key="discard" variant="secondary" onPress={noop}>{discard}</Button> : null,
        <Button key="save" variant="primary" onPress={noop}>{save}</Button>,
      ] : undefined}
      labels={{ unsaved: unsaved ?? "", saveBar: barLabel ?? "" }}
    />
  );
};
