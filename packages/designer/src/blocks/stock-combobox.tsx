"use client";

import type { Key } from "react";

import { cx } from "../components/internal/cx.js";
import { componentLeaf } from "../runtime/component-leaf.js";
import type { StockFieldText } from "./stock-select.js";

/**
 * Stock shadcn@aria combobox anatomy, resolved through the consumer's selected component leaves.
 * It renders through the composed stock field (label, description and error parts), the same
 * composition as StockSelect.
 */
type StockComboboxModule = typeof import("../components/preview-runtime/components/combo-box/combobox.js");
const Combobox = componentLeaf<StockComboboxModule["Combobox"]>("components.combo-box");
const ComboboxInput = componentLeaf<StockComboboxModule["ComboboxInput"]>("components.combo-box", "ComboboxInput");
const ComboboxContent = componentLeaf<StockComboboxModule["ComboboxContent"]>("components.combo-box", "ComboboxContent");
const ComboboxList = componentLeaf<StockComboboxModule["ComboboxList"]>("components.combo-box", "ComboboxList");
const ComboboxItem = componentLeaf<StockComboboxModule["ComboboxItem"]>("components.combo-box", "ComboboxItem");
type FieldModule = typeof import("../components/preview-runtime/components/field/field.js");
const Field = componentLeaf<FieldModule["Field"]>("components.field");
const FieldLabel = componentLeaf<FieldModule["FieldLabel"]>("components.field", "FieldLabel");
const FieldDescription = componentLeaf<FieldModule["FieldDescription"]>("components.field", "FieldDescription");
const FieldError = componentLeaf<FieldModule["FieldError"]>("components.field", "FieldError");

export interface StockComboboxOption { readonly id: string; readonly label: string; readonly isDisabled?: boolean }

export interface StockComboboxProps extends StockFieldText {
  readonly options: readonly StockComboboxOption[];
  /** Controlled selection; omit both for an uncontrolled combobox seeded by `defaultSelectedKey`. */
  readonly selectedKey?: string | null;
  readonly defaultSelectedKey?: string;
  readonly onSelectionChange?: (key: Key | null) => void;
  /** Controlled input text; omit for the combobox's own filter text. */
  readonly inputValue?: string;
  readonly onInputChange?: (text: string) => void;
  readonly allowsCustomValue?: boolean;
  readonly id?: string;
  readonly name?: string;
  readonly isDisabled?: boolean;
  readonly isRequired?: boolean;
  readonly placeholder?: string;
}

/** One labelled stock combobox: Combobox + ComboboxInput + ComboboxContent/ComboboxList/ComboboxItem. */
export function StockCombobox({ options, selectedKey, defaultSelectedKey, onSelectionChange, inputValue, onInputChange, allowsCustomValue, id, name, isDisabled, isRequired = false, placeholder, label, description, errorMessage, isInvalid, className }: StockComboboxProps) {
  return <Combobox defaultItems={options} className={cx("w-full", className)} allowsCustomValue={allowsCustomValue}
    {...(selectedKey !== undefined ? { selectedKey } : {})} {...(defaultSelectedKey !== undefined ? { defaultSelectedKey } : {})} onSelectionChange={onSelectionChange}
    {...(inputValue !== undefined ? { inputValue } : {})} onInputChange={onInputChange}
    id={id} name={name} isDisabled={isDisabled} isInvalid={isInvalid} isRequired={isRequired} validationBehavior="aria"
    render={domProps => <Field {...domProps} />}>
    <FieldLabel>{label}</FieldLabel>
    <ComboboxInput placeholder={placeholder} className="w-full" />
    {description ? <FieldDescription>{description}</FieldDescription> : null}
    <FieldError>{errorMessage}</FieldError>
    <ComboboxContent><ComboboxList>{(option: StockComboboxOption) => <ComboboxItem id={option.id} textValue={option.label} isDisabled={option.isDisabled}>{option.label}</ComboboxItem>}</ComboboxList></ComboboxContent>
  </Combobox>;
}
