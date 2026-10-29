import { SectionHeader } from "./SectionHeader.js";
import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cx } from "../selected-components/internal/cx.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { TOKENS } from "../tokens/tokens.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.record-detail", "foundry/sections.record-detail");

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
  /** Host-composed menu replacing actions in a container narrower than the tablet token. */
  compactActions?: ReactNode;
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
export function DetailView({ title, fields, actions, compactActions, className, style, ...rest }: DetailViewProps) {
  const hasHeader = title !== undefined || actions !== undefined || compactActions !== undefined;
  const responsiveActions = compactActions !== undefined ? <>
    <span data-detail-actions-wide="" className="flex flex-wrap items-center gap-sm">{actions}</span>
    <span data-detail-actions-compact="">{compactActions}</span>
  </> : actions;
  return (
    <section {...SECTION_STAMP} {...rest} data-record-detail="" className={cx("flex min-w-0 max-w-full flex-col gap-md", className)} style={{ containerType: "inline-size", overflowWrap: "anywhere", ...style }}>
      {hasHeader ? (
        <SectionHeader data-detail-header="" density="standard" level={2}
          {...(title !== undefined ? { title } : {})}
          actions={responsiveActions !== undefined ? <>{responsiveActions}</> : undefined}
        />
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
      <style>{`
        [data-detail-header] > div > div { min-inline-size: 0; max-inline-size: 100%; }
        [data-detail-header] > div > div:last-child { flex-wrap: wrap; }
        [data-detail-actions-compact] { display: none; }
        @container (width < ${TOKENS["--breakpoint-tablet"]!.value}) {
          [data-detail-actions-wide] { display: none; }
          [data-detail-actions-compact] { display: inline-flex; }
        }
      `}</style>
    </section>
  );
}
