"use client";

import type { Key } from "react";

import { componentLeaf } from "../runtime/component-leaf.js";
import { StockField, type StockFieldText } from "./stock-field.js";

/**
 * Stock shadcn@aria combobox anatomy, resolved through the consumer's selected component leaves.
 * The stock combobox has no label part, so the visible label, description and error are the
 * selected SemanticContent text wired to it by id (StockField), the same composition as StockSelect.
 */
type StockComboboxModule = typeof import("../components/preview-runtime/components/combo-box/combobox.js");
const Combobox = componentLeaf<StockComboboxModule["Combobox"]>("components.combo-box");
const ComboboxInput = componentLeaf<StockComboboxModule["ComboboxInput"]>("components.combo-box", "ComboboxInput");
const ComboboxContent = componentLeaf<StockComboboxModule["ComboboxContent"]>("components.combo-box", "ComboboxContent");
const ComboboxList = componentLeaf<StockComboboxModule["ComboboxList"]>("components.combo-box", "ComboboxList");
const ComboboxItem = componentLeaf<StockComboboxModule["ComboboxItem"]>("components.combo-box", "ComboboxItem");

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
export function StockCombobox({ options, selectedKey, defaultSelectedKey, onSelectionChange, inputValue, onInputChange, allowsCustomValue, id, name, isDisabled, isRequired = false, placeholder, ...text }: StockComboboxProps) {
  return <StockField {...text}>{aria =>
    <Combobox {...aria} defaultItems={options} className="w-full" allowsCustomValue={allowsCustomValue}
      {...(selectedKey !== undefined ? { selectedKey } : {})} {...(defaultSelectedKey !== undefined ? { defaultSelectedKey } : {})} onSelectionChange={onSelectionChange}
      {...(inputValue !== undefined ? { inputValue } : {})} onInputChange={onInputChange}
      id={id} name={name} isDisabled={isDisabled} isInvalid={text.isInvalid ?? false} isRequired={isRequired} validationBehavior="aria">
      <ComboboxInput placeholder={placeholder} className="w-full" />
      <ComboboxContent><ComboboxList>{(option: StockComboboxOption) => <ComboboxItem id={option.id} textValue={option.label} isDisabled={option.isDisabled}>{option.label}</ComboboxItem>}</ComboboxList></ComboboxContent>
    </Combobox>}
  </StockField>;
}
