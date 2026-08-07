import { useId, type CSSProperties, type FieldsetHTMLAttributes, type ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";

export type FieldGroupLayout = "single" | "multi";

const LAYOUT_CLASSES: Record<FieldGroupLayout, string> = {
  single: "grid-cols-1",
  multi: "grid-cols-1 tablet:grid-cols-2",
};

export interface FieldGroupProps
  extends Omit<FieldsetHTMLAttributes<HTMLFieldSetElement>, "children"> {
  /**
   * Required. Rendered as a real `<legend>` — the group's own label. See
   * the component doc comment for why `<fieldset>`/`<legend>` was chosen
   * over `role="group"`/`aria-labelledby` here.
   */
  legend: ReactNode;
  /** Helper text under the legend, describing the group as a whole — not any one field's own description (each field renders its own via `Field`/`TextField`'s own `description`). */
  description?: ReactNode;
  /**
   * Single or multi-column layout for the fields region. The region set —
   * legend, description, fields — is identical either way; only the
   * fields' own grid layout changes, which is what makes this a legitimate
   * prop rather than two separate components under this package's variant
   * rule (see the README).
   * @default "single"
   */
  layout?: FieldGroupLayout;
  /** The fields in this group — any mix of this package's own field atoms (`TextField`, `Select`, `Textarea`, `RadioGroup`, `Field`, ...). */
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * A related set of fields under a shared legend — a shipping address's
 * street/city/zip, a payment method's card fields, grouped distinctly from
 * the rest of the form they sit in. Three regions that differ in kind (the
 * legend, an optional description, the fields themselves), and a single
 * `Form` routinely holds more than one `FieldGroup` (billing address AND
 * shipping address on the same checkout form), which is what makes this a
 * block rather than a view.
 *
 * **Renders a real `<fieldset>`/`<legend>` pair, not `role="group"` +
 * `aria-labelledby`.** `<fieldset>` is the native HTML mechanism built for
 * exactly this: grouping a set of form controls under one shared,
 * programmatically-associated label. Every mainstream screen reader already
 * announces the legend as context the moment focus lands on ANY control
 * inside the fieldset — automatically, from the parent/child relationship
 * alone, with no id to generate and wire up by hand the way
 * `aria-labelledby` would need. `role="group"` is the right tool when the
 * grouped content ISN'T form controls (a `<fieldset>` may only contain form
 * controls and phrasing content) — that restriction doesn't cost anything
 * here, since every `FieldGroup` child is a field by definition. The one
 * native `<fieldset>` cost — browser default chrome (a border, extra
 * padding, and a shrink-to-fit `min-width` that can overflow a flex/grid
 * ancestor) — is reset to zero below, so this renders as plain layout, not
 * a visible box of its own.
 */
export function FieldGroup({
  legend,
  description,
  layout = "single",
  children,
  className,
  style,
  ...rest
}: FieldGroupProps) {
  const groupId = useId();
  const descriptionId = description ? `${groupId}-description` : undefined;

  return (
    <fieldset
      {...rest}
      aria-describedby={descriptionId}
      className={cx("m-0 min-w-0 flex flex-col gap-sm border-0 p-0", className)}
      style={style}
    >
      <legend className="w-full p-0 text-body-s text-ink-secondary font-body">{legend}</legend>
      {description ? (
        <p id={descriptionId} className="text-caption text-ink-muted">
          {description}
        </p>
      ) : null}
      <div className={cx("grid gap-md", LAYOUT_CLASSES[layout])}>{children}</div>
    </fieldset>
  );
}
