"use client";

import { useId, type ReactNode } from "react";

import { cx } from "../components/internal/cx.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** The field text a stock control has no part for: selected SemanticContent wired to the control by id. */
export interface StockFieldText {
  /** Visible field label; also the control's accessible name. */
  readonly label: ReactNode;
  /** Helper text read with the control through aria-describedby. */
  readonly description?: ReactNode;
  /** Rendered and described only while `isInvalid`. */
  readonly errorMessage?: ReactNode;
  readonly isInvalid?: boolean;
  /** Merged onto the field wrapper. */
  readonly className?: string;
}

export interface StockFieldAria { readonly "aria-labelledby": string; readonly "aria-describedby"?: string }

/** One labelled stock control: label, the control (given its aria wiring), description and error. */
export function StockField({ label, description, errorMessage, isInvalid = false, className, children }: StockFieldText & { readonly children: (aria: StockFieldAria) => ReactNode }) {
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = isInvalid && errorMessage ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ");
  return <SemanticContent as="div" className={cx("flex min-w-0 flex-col gap-xs", className)}>
    <SemanticContent as="span" id={labelId} className="text-body-s text-ink-secondary">{label}</SemanticContent>
    {children({ "aria-labelledby": labelId, ...(describedBy ? { "aria-describedby": describedBy } : {}) })}
    {description ? <SemanticContent as="span" id={descriptionId} className="text-caption text-ink-muted">{description}</SemanticContent> : null}
    {errorId ? <SemanticContent as="span" id={errorId} className="text-caption text-status-danger-text">{errorMessage}</SemanticContent> : null}
  </SemanticContent>;
}
