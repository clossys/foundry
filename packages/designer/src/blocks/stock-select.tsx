"use client";

import { useId, type Key, type ReactNode } from "react";

import { cx } from "../components/internal/cx.js";
import { componentLeaf } from "../runtime/component-leaf.js";

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
const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

export interface StockSelectOption { readonly id: string; readonly label: string; readonly isDisabled?: boolean }

export interface StockSelectProps {
  /** Visible field label; also the trigger's accessible name. */
  readonly label: ReactNode;
  readonly options: readonly StockSelectOption[];
  readonly selectedKey: string | null;
  readonly onSelectionChange: (key: Key | null) => void;
  /** The selected select's size axis (size.sm / size.md / size.lg). */
  readonly size?: "sm" | "md" | "lg";
  readonly placeholder?: string;
  /** Helper text read with the trigger through aria-describedby. */
  readonly description?: ReactNode;
  /** Rendered and described only while `isInvalid`. */
  readonly errorMessage?: ReactNode;
  readonly isInvalid?: boolean;
  readonly isRequired?: boolean;
  /** Merged onto the field wrapper. */
  readonly className?: string;
}

/** One labelled stock select: Select + SelectTrigger/SelectValue + SelectContent/SelectItem. */
export function StockSelect({ label, options, selectedKey, onSelectionChange, size, placeholder, description, errorMessage, isInvalid = false, isRequired = false, className }: StockSelectProps) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = isInvalid && errorMessage ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  return <SemanticContent as="div" className={cx("flex min-w-0 flex-col gap-xs", className)}>
    <SemanticContent as="span" id={labelId} className="text-body-s text-ink-secondary">{label}</SemanticContent>
    <Select aria-labelledby={labelId} aria-describedby={describedBy} {...(size ? { size } : {})} className="w-full" placeholder={placeholder}
      selectedKey={selectedKey} onSelectionChange={onSelectionChange} isInvalid={isInvalid} isRequired={isRequired} validationBehavior="aria">
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(option => <SelectItem key={option.id} id={option.id} textValue={option.label} isDisabled={option.isDisabled}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
    {description ? <SemanticContent as="span" id={descriptionId} className="text-caption text-ink-muted">{description}</SemanticContent> : null}
    {errorId ? <SemanticContent as="span" id={errorId} className="text-caption text-status-danger-text">{errorMessage}</SemanticContent> : null}
  </SemanticContent>;
}
