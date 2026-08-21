import { useId, type CSSProperties, type ReactNode } from "react";
import { cx } from "./internal/cx.js";

/**
 * The ARIA wiring a `Field`-wrapped control must apply to itself. Handed to
 * `children` as a render prop rather than pushed on via `React.cloneElement`:
 * an arbitrary consumer-supplied control (a third-party date picker, a
 * `<canvas>`-based signature pad, anything this package doesn't ship an atom
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
  /** The control this field wraps. Receives the generated id and ARIA wiring — see `FieldRenderProps`. */
  children: (fieldProps: FieldRenderProps) => ReactNode;
  /** Merged onto the outer field wrapper. */
  className?: string;
  /** Merged onto the outer field wrapper's inline style. */
  style?: CSSProperties;
}

/**
 * A label/description/error wrapper for a control this package doesn't ship
 * an atom for. `TextField` bundles this exact same label/description/error
 * surface with its own `<input>` for the text-entry case; `Field` is the
 * general form, for everything else — a third-party rich-text editor, a
 * `<canvas>`-based signature pad, a date-range picker, or any future control
 * this package hasn't built a dedicated atom for yet. Unlike `TextField`/
 * `Select`/`Textarea`/`RadioGroup`, this component renders no
 * react-aria-components primitive of its own: the whole point is that the
 * wrapped control isn't one either (a control that IS one already gets this
 * exact wiring automatically from react-aria-components' own `Label`/
 * `Text`/`FieldError` context, the way this package's other field atoms
 * do — reach for `Field` only when that context doesn't apply).
 *
 * Id generation uses React's own `useId()` (SSR-safe, collision-free even
 * with multiple `Field`s on one page) rather than a module-level counter or
 * a random string — the same guarantee react-aria-components' internal id
 * generation already gives every OTHER field atom in this package; `Field`
 * needs its own because it isn't built on any react-aria-components
 * primitive that would supply one for free.
 */
export function Field({
  label,
  description,
  errorMessage,
  isInvalid = false,
  isRequired = false,
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
    <div className={cx("flex flex-col gap-xs", className)} style={style}>
      <label htmlFor={fieldId} className="text-body-s text-ink-secondary font-body">
        {label}
      </label>
      {children({
        id: fieldId,
        "aria-describedby": describedBy,
        ...(isInvalid ? { "aria-invalid": true as const } : {}),
        ...(isRequired ? { "aria-required": true as const } : {}),
      })}
      {description ? (
        <p id={descriptionId} className="text-caption text-ink-muted">
          {description}
        </p>
      ) : null}
      {showError ? (
        <p id={errorId} className="text-caption text-status-danger-text">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
