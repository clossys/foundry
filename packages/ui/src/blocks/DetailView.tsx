import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";

export interface DetailViewField {
  /** The field's name — rendered in a `<dt>`. */
  label: ReactNode;
  /** The field's value — rendered in a `<dd>`. A `ReactNode`, not a plain string: a consumer renders its own date/currency/badge formatting rather than this block reformatting a string on their behalf. */
  value: ReactNode;
  /**
   * How many columns this field spans in the block's own two-column field
   * grid (from the `tablet` breakpoint up — every field is a single full-
   * width column below it, see "Responsive" below). @default 1
   */
  span?: 1 | 2;
}

export interface DetailViewProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /**
   * The record's own name/identifier. Optional: a consumer already showing
   * it via `PageHeader` (e.g. `PageHeader title="Order #1042"`) can omit
   * this region entirely rather than repeating the same text twice.
   */
  title?: ReactNode;
  /** The fields to display, as data. */
  fields: readonly DetailViewField[];
  /** Slot for the record's own actions (edit, delete, ...), rendered at the trailing edge of the title row. */
  actions?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Label/value presentation of a single record — the read view of a form, a
 * detail panel, a record summary. Three regions that differ in kind (a
 * title, the field list itself, an actions row), and a page can hold two
 * `DetailView`s side by side (e.g. "before"/"after" of the same record, or
 * two related records) — a block, not a view, by this package's own
 * "Placement rules" tests.
 *
 * Renders `fields` as a `<dl>`: a label paired with its value IS a term and
 * its definition, exactly what `<dt>`/`<dd>` mean, so a screen reader can
 * navigate the list pair-by-pair the same way a sighted user scans
 * label/value rows visually — the correct semantics here, not a generic
 * `<div>` grid that carries no relationship between a field's label and its
 * value at all. Each field is its own `<div>` wrapping one `<dt>` + one
 * `<dd>` (HTML explicitly allows grouping `dt`/`dd` pairs this way inside a
 * `<dl>`), which is what lets `span` apply a grid column span to a whole
 * pair at once.
 *
 * Deliberately has no `variant`/`mode` prop — see this package's README,
 * "Placement rules". A consumer needing a different shape (fields grouped
 * under sub-headings, a card wrapper, a single column always) composes
 * that directly around this block's own `title`/`fields`/`actions` slots.
 */
export function DetailView({ title, fields, actions, className, style, ...rest }: DetailViewProps) {
  const hasHeader = title !== undefined || actions !== undefined;
  return (
    <section {...rest} className={cx("flex flex-col gap-md", className)} style={style}>
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-md">
          {title !== undefined ? (
            <h2 className="text-h2 font-display text-ink-primary">{title}</h2>
          ) : null}
          {actions !== undefined ? (
            <div className={cx("flex items-center gap-sm", title === undefined ? "ml-auto" : "")}>
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      {/*
       * Responsive: a single full-width column below the `tablet`
       * breakpoint (every field stacks), two columns from `tablet` up. A
       * plain Tailwind responsive variant generated from this package's
       * own `--breakpoint-tablet` token — no JS breakpoint state, the same
       * pattern `Shell.SideNav` uses for its own responsive collapse.
       */}
      <dl className="grid grid-cols-1 gap-lg tablet:grid-cols-2">
        {fields.map((field, index) => (
          <div
            key={index}
            className={cx("flex flex-col gap-xs", field.span === 2 ? "tablet:col-span-2" : "")}
          >
            <dt className="text-body-s text-ink-secondary">{field.label}</dt>
            <dd className="text-body text-ink-primary">{field.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
