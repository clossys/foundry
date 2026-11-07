"use client";

import type { Key } from "react";

import { componentLeaf } from "../runtime/component-leaf.js";
import { StockField, type StockFieldText } from "./stock-field.js";

/**
 * Stock shadcn@aria select anatomy for the data blocks, resolved through the consumer's selected
 * component leaves (E2). Every leaf is typed by the stock export the selection binds, so a
 * Foundry-only prop (label, options, description, errorMessage) is a type error rather than a
 * silently dropped field. The stock select has no label part, so the visible label, description
 * and error are selected SemanticContent text wired to the stock trigger by id.
 */
type StockSelectModule = typeof import("../components/preview-runtime/components/select/select.js");
const Select = componentLeaf<StockSelectModule["Select"]>("components.select");
const SelectTrigger = componentLeaf<StockSelectModule["SelectTrigger"]>("components.select", "SelectTrigger");
const SelectValue = componentLeaf<StockSelectModule["SelectValue"]>("components.select", "SelectValue");
const SelectContent = componentLeaf<StockSelectModule["SelectContent"]>("components.select", "SelectContent");
const SelectItem = componentLeaf<StockSelectModule["SelectItem"]>("components.select", "SelectItem");

export interface StockSelectOption { readonly id: string; readonly label: string; readonly isDisabled?: boolean }

export interface StockSelectProps extends StockFieldText {
  readonly options: readonly StockSelectOption[];
  /** Controlled selection; omit both for an uncontrolled select seeded by `defaultSelectedKey`. */
  readonly selectedKey?: string | null;
  readonly defaultSelectedKey?: string;
  readonly onSelectionChange?: (key: Key | null) => void;
  /** Applied to the stock select (its trigger is the focus target) and its form field name. */
  readonly id?: string;
  readonly name?: string;
  readonly isDisabled?: boolean;
  readonly onBlur?: () => void;
  /** The selected select's size axis (size.sm / size.md / size.lg). */
  readonly size?: "sm" | "md" | "lg";
  readonly placeholder?: string;
  readonly isRequired?: boolean;
}

/** One labelled stock select: Select + SelectTrigger/SelectValue + SelectContent/SelectItem. */
export function StockSelect({ options, selectedKey, defaultSelectedKey, onSelectionChange, id, name, isDisabled, onBlur, size, placeholder, isRequired = false, ...text }: StockSelectProps) {
  return <StockField {...text}>{aria =>
    <Select {...aria} {...(size ? { size } : {})} className="w-full" placeholder={placeholder}
      {...(selectedKey !== undefined ? { selectedKey } : {})} {...(defaultSelectedKey !== undefined ? { defaultSelectedKey } : {})} onSelectionChange={onSelectionChange}
      id={id} name={name} isDisabled={isDisabled} onBlur={onBlur} isInvalid={text.isInvalid ?? false} isRequired={isRequired} validationBehavior="aria">
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(option => <SelectItem key={option.id} id={option.id} textValue={option.label} isDisabled={option.isDisabled}>{option.label}</SelectItem>)}</SelectContent>
    </Select>}
  </StockField>;
}
