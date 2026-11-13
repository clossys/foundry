"use client";

import type { Key, ReactNode } from "react";

import { cx } from "../components/internal/cx.js";
import { componentLeaf } from "../runtime/component-leaf.js";

/**
 * Stock shadcn@aria select anatomy for the data blocks, resolved through the consumer's selected
 * component leaves (E2). Every leaf is typed by the stock export the selection binds, so a
 * Foundry-only prop (label, options, description, errorMessage) is a type error rather than a
 * silently dropped field. The select renders through the composed stock field (its label,
 * description and error parts), which react-aria-components wires to the trigger itself.
 */
type StockSelectModule = typeof import("../components/preview-runtime/components/select/select.js");
const Select = componentLeaf<StockSelectModule["Select"]>("components.select");
const SelectTrigger = componentLeaf<StockSelectModule["SelectTrigger"]>("components.select", "SelectTrigger");
const SelectValue = componentLeaf<StockSelectModule["SelectValue"]>("components.select", "SelectValue");
const SelectContent = componentLeaf<StockSelectModule["SelectContent"]>("components.select", "SelectContent");
const SelectItem = componentLeaf<StockSelectModule["SelectItem"]>("components.select", "SelectItem");
type FieldModule = typeof import("../components/preview-runtime/components/field/field.js");
const Field = componentLeaf<FieldModule["Field"]>("components.field");
const FieldLabel = componentLeaf<FieldModule["FieldLabel"]>("components.field", "FieldLabel");
const FieldDescription = componentLeaf<FieldModule["FieldDescription"]>("components.field", "FieldDescription");
const FieldError = componentLeaf<FieldModule["FieldError"]>("components.field", "FieldError");

/** The field text a stock control carries through the composed stock field parts. */
export interface StockFieldText {
  /** Visible field label (the stock label part); also the control's accessible name. */
  readonly label: ReactNode;
  /** Helper text, the stock description part, read with the control. */
  readonly description?: ReactNode;
  /**
   * The stock error part's text while invalid. Omit it inside a validating `Form`:
   * the error then comes from the form's `validationErrors` by `name`.
   */
  readonly errorMessage?: ReactNode;
  /** Controlled invalid state; omit it to let the form's `validationErrors` decide. */
  readonly isInvalid?: boolean;
  /** Merged onto the field root. */
  readonly className?: string;
}

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
export function StockSelect({ options, selectedKey, defaultSelectedKey, onSelectionChange, id, name, isDisabled, onBlur, size, placeholder, isRequired = false, label, description, errorMessage, isInvalid, className }: StockSelectProps) {
  return <Select {...(size ? { size } : {})} className={cx("w-full", className)} placeholder={placeholder}
    {...(selectedKey !== undefined ? { selectedKey } : {})} {...(defaultSelectedKey !== undefined ? { defaultSelectedKey } : {})} onSelectionChange={onSelectionChange}
    id={id} name={name} isDisabled={isDisabled} onBlur={onBlur} isInvalid={isInvalid} isRequired={isRequired} validationBehavior="aria"
    render={domProps => <Field {...domProps} />}>
    <FieldLabel>{label}</FieldLabel>
    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
    {description ? <FieldDescription>{description}</FieldDescription> : null}
    <FieldError>{errorMessage}</FieldError>
    <SelectContent>{options.map(option => <SelectItem key={option.id} id={option.id} textValue={option.label} isDisabled={option.isDisabled}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}
