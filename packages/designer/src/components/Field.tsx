import { useId, type CSSProperties, type ReactNode } from "react";
import { FieldError, Label, Text, TextField as AriaTextField } from "react-aria-components";
import { UI_ALPHA_DISABLED } from "./internal/ui-vars.js";
import { cx } from "./internal/cx.js";

/**
 * The ARIA wiring a `Field`-wrapped control must apply to itself. Handed to
 * `children` as a render prop rather than pushed on via `React.cloneElement`:
 * an arbitrary consumer-supplied control (a third-party date picker, a
 * `<canvas>`-based signature pad, anything this package doesn't ship an component
 * for) has no guaranteed prop shape `cloneElement` could safely merge into —
 * a blind clone risks silently overwriting a prop the control already sets
 * for its own reasons. A render prop instead hands the control's author
 * exactly the values to spread, in their own code, onto whichever element of
 * their own component tree is the one that actually needs them (which isn't
 * always the outermost one — a composite control might need `id` on an
 * inner `<input>` two levels down). The same shape `Dialog`'s function-form
 * `children` and `Table.Body`'s `renderEmptyState` already use in this
 * package.
 */
export interface FieldRenderProps {
  /** Native disabled state for a control that accepts it. */
  disabled?: true;
  "aria-disabled"?: true;
  /** The generated id — associate the control with `Field`'s own `<label>` via this. */
  id: string;
  /**
   * Space-separated ids of the description and (while `isInvalid`) error
   * text this `Field` renders — `undefined` when neither is present, never
   * an empty string (an empty `aria-describedby` is worse than an absent
   * one: some assistive tech treats it as "describe this with nothing"
   * rather than "no description exists").
   */
  "aria-describedby"?: string;
  /** Present (and `true`) only while `isInvalid` — absent, not `false`, otherwise. */
  "aria-invalid"?: true;
  /** Present (and `true`) only while `isRequired` — absent, not `false`, otherwise. */
  "aria-required"?: true;
}

export interface FieldProps {
  /**
   * Required. Rendered as a real `<label>`, associated with the control via
   * `htmlFor`/`id` — the accessible-name path a screen reader announces.
   */
  label: ReactNode;
  /** Helper text below the control, read by assistive tech via `aria-describedby`. */
  description?: ReactNode;
  /**
   * Validation error text. Rendered — and folded into `aria-describedby` —
   * only while `isInvalid`; ignored while `isInvalid` is false, the same
   * convention `TextField`'s and `Select`'s own `errorMessage` follow (see
   * this package's README).
   */
  errorMessage?: ReactNode;
  /**
   * Marks the control invalid: renders `errorMessage` (if given) and passes
   * `aria-invalid` through the render prop.
   * @default false
   */
  isInvalid?: boolean;
  /**
   * Marks the control required: passes `aria-required` through the render
   * prop. Purely an ARIA/semantic signal — this component renders no visual
   * asterisk or "(required)" text of its own, since where that belongs
   * (on the label, after it, as a separate legend) varies enough by product
   * that baking in one answer would be the same "this component now decides
   * something the consumer should" failure the README's variant rule warns
   * against, just for a single glyph instead of a whole region.
   * @default false
   */
  isRequired?: boolean;
  /** Disables the control and marks the field visually. */
  isDisabled?: boolean;
  /** The control this field wraps. Receives the generated id and ARIA wiring — see `FieldRenderProps`. */
  children: (fieldProps: FieldRenderProps) => ReactNode;
  /** Merged onto the outer field wrapper. */
  className?: string;
  /** Merged onto the outer field wrapper's inline style. */
  style?: CSSProperties;
}

/** Label, description and validation parts shared with RAC controls, with a render-prop bridge for arbitrary controls. */
export function Field({
  label,
  description,
  errorMessage,
  isInvalid = false,
  isRequired = false,
  isDisabled = false,
  children,
  className,
  style,
}: FieldProps) {
  const fieldId = useId();
  const descriptionId = description ? `${fieldId}-description` : undefined;
  const showError = isInvalid && Boolean(errorMessage);
  const errorId = showError ? `${fieldId}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <AriaTextField id={fieldId} isInvalid={isInvalid} isRequired={isRequired} isDisabled={isDisabled} validationBehavior="aria"
      className={cx("flex flex-col gap-xs", className)} style={{ opacity: isDisabled ? UI_ALPHA_DISABLED : undefined, ...style }}>
      <Label htmlFor={fieldId} className="text-body-s text-ink-secondary font-body">
        {label}
      </Label>
      {children({
        id: fieldId,
        ...(isDisabled ? { disabled: true as const, "aria-disabled": true as const } : {}),
        "aria-describedby": describedBy,
        ...(isInvalid ? { "aria-invalid": true as const } : {}),
        ...(isRequired ? { "aria-required": true as const } : {}),
      })}
      {description ? (
        <Text slot="description" id={descriptionId} className="text-caption text-ink-muted">
          {description}
        </Text>
      ) : null}
      {showError ? (
        <FieldError id={errorId} className="text-caption text-status-danger-text">
          {errorMessage}
        </FieldError>
      ) : null}
    </AriaTextField>
  );
}
