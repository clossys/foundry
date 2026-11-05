"use client";
import { forwardRef, type ReactNode } from "react";
import { NumberField as AriaNumberField, Group, Input, Label, Text, FieldError, type NumberFieldProps as AriaNumberFieldProps, type ValidationResult } from "react-aria-components";
import { Button } from "./Button.js";
import { Icon } from "./Icon.js";
import { useGlyph } from "./glyph-context.js";
import { cx } from "./internal/cx.js";
import { UI_ALPHA_DISABLED, UI_RING_FOCUS } from "./internal/ui-vars.js";

export interface NumberFieldProps extends Omit<AriaNumberFieldProps, "children" | "className"> {
  label: ReactNode;
  size?: "sm" | "md" | "lg";
  description?: ReactNode;
  errorMessage?: ReactNode | ((validation: ValidationResult) => ReactNode);
  /** Host supplied names remain meaningful when the visible button is only a sign. */
  incrementLabel: string;
  decrementLabel: string;
  className?: string;
}

/** Draft numeric entry with peer-owned locale parsing, bounds and step semantics. */
export const NumberField = forwardRef<HTMLDivElement, NumberFieldProps>(function NumberField({ label, size = "md", description, errorMessage, incrementLabel, decrementLabel, className, ...props }, ref) {
  const incrementGlyph = useGlyph("assets.icon-chevron-up");
  const decrementGlyph = useGlyph("assets.icon-chevron-down");
  if (!incrementLabel.trim() || !decrementLabel.trim()) throw new TypeError("NumberField requires stepper names.");
  return <AriaNumberField {...props} ref={ref} className={cx("flex flex-col gap-xs", className)}>
    <Label className="text-body-s text-ink-secondary font-body">{label}</Label>
    <Group className={({ isInvalid }) => cx("flex items-center rounded-control border bg-surface-raised", isInvalid ? "border-status-danger" : "border-line-control")} style={({ isDisabled, isFocusVisible }) => ({ minBlockSize: `var(--ui-control-h-${size})`, opacity: isDisabled ? UI_ALPHA_DISABLED : undefined, boxShadow: isFocusVisible ? UI_RING_FOCUS : undefined })}>
      <Button slot="decrement" aria-label={decrementLabel} aria-labelledby="" variant="quiet" size={size} style={{ minInlineSize: "var(--ui-layout-tap-target)" }} className="px-md py-sm text-ink-primary outline-none focus-visible:underline forced-colors:outline"><Icon glyph={decrementGlyph} decorative /></Button>
      <Input className="min-w-0 flex-1 bg-transparent px-sm py-sm font-body text-body text-ink-primary tabular-nums outline-none" />
      <Button slot="increment" aria-label={incrementLabel} aria-labelledby="" variant="quiet" size={size} style={{ minInlineSize: "var(--ui-layout-tap-target)" }} className="px-md py-sm text-ink-primary outline-none focus-visible:underline forced-colors:outline"><Icon glyph={incrementGlyph} decorative /></Button>
    </Group>
    {description && <Text slot="description" className="text-caption text-ink-muted">{description}</Text>}
    <FieldError className="text-caption text-status-danger-text">{errorMessage}</FieldError>
  </AriaNumberField>;
});
