import type { CSSProperties, ReactNode } from "react";
import { assertNoNestedInteractive } from "../stretched-link.js";
import { Meter } from "../../selected-components/Meter.server.js";
import type { MeterDirection } from "../../components/Meter.js";
import { StatusMark, type StatusMarkTone } from "../../selected-components/StatusMark.js";
import { cx } from "../../selected-components/internal/cx.js";
import { UI_BORDER_HAIRLINE } from "../../selected-components/internal/ui-vars.js";

// Class records first: the compiled-CSS scan reads string literals in file
// order, so every class lives here, above any code.

/**
 * Field grids. Columns follow the PANEL's width, not the viewport's (the
 * panel is a size container, see `SpecimenPanel`): never more than two
 * columns until `@lg:grid-cols-4` applies at a panel width of 32rem, so a panel in a
 * third-width card or at 390px stays readable.
 */
const FIELDS_COLUMN_CLASSES: Record<1 | 2 | 4, string> = {
  1: "m-0 grid grid-cols-1 gap-y-md",
  2: "m-0 grid grid-cols-2 gap-x-lg gap-y-md",
  4: "m-0 grid grid-cols-2 gap-x-lg gap-y-md @lg:grid-cols-4",
};

/**
 * Panel type sits one step above the old caption scale: body text at
 * `text-body`, secondary lines at `text-body-s`, and a part label in
 * sentence case at `text-body-s` medium, never a 12px tracked caption.
 */
const PART_LABEL_CLASSES = "m-0 text-body-s font-medium text-ink-secondary";
const ROW_CLASSES = "flex flex-wrap items-start justify-between gap-x-md gap-y-xs";
const ROW_TEXT_CLASSES = "flex min-w-0 flex-col gap-xs";
const PRIMARY_TEXT = "text-body text-ink-primary";
const SECONDARY_CAPTION = "text-body-s text-ink-secondary";
const DIVIDED_ROW = "border-t border-line-base pt-md";
/**
 * Lists, definition lists, paragraphs, table cells and the figure reset their
 * own user-agent margin and padding, so a specimen renders the same with or
 * without a consumer CSS reset. Markers need no reset: every row is a flex box.
 */
const LIST_RESET_CLASSES = "m-0 flex flex-col p-0";

/**
 * Table classes. Until `@md:table` applies at a panel width of 28rem
 * (measured on the panel's own size container, not the viewport)
 * each row reflows into a stacked record: the row header on its own line,
 * then one label/value pair per cell, with the column headers kept for
 * assistive technology only (`sr-only`). From `@md:table` it is an ordinary
 * table. So a table in a third-width card stacks at every viewport instead
 * of wrapping each cell over two lines.
 */
const TABLE_CLASSES = {
  table: "grid w-full grid-cols-1 text-body @md:table @md:border-collapse",
  caption: "sr-only",
  head: "sr-only @md:not-sr-only @md:table-header-group",
  headRow: "@md:table-row",
  columnHeader: "p-0 pb-sm text-start align-bottom text-body-s font-normal text-ink-secondary @md:pe-md",
  body: "flex flex-col @md:table-row-group",
  row: "flex flex-col gap-xs border-t border-line-base py-md @md:table-row",
  rowHeader: "block p-0 text-start font-medium text-ink-primary @md:table-cell @md:py-md @md:pe-md @md:align-top",
  cell: "flex items-baseline p-0 justify-between gap-md @md:table-cell @md:py-md @md:pe-md @md:align-top",
  cellLabel: "text-body-s text-ink-secondary @md:hidden",
  cellValue: "min-w-0 text-end text-ink-primary tabular-nums @md:text-start",
} as const;

const SCHEDULE_CLASSES = {
  list: "m-0 flex flex-col gap-lg border-s border-line-strong ps-lg",
  item: "flex flex-wrap items-start justify-between gap-x-md gap-y-xs",
  trailing: "flex flex-col items-end gap-xs",
  amount: "text-body font-medium text-ink-primary tabular-nums",
} as const;

const FILE_FORMAT_CLASSES =
  "inline-flex shrink-0 rounded-subtle border border-line-base px-xs font-mono text-body-s uppercase text-ink-secondary";

const HAIRLINE_BLOCK_START: CSSProperties = { borderBlockStartWidth: UI_BORDER_HAIRLINE };
const HAIRLINE_INLINE_START: CSSProperties = { borderInlineStartWidth: UI_BORDER_HAIRLINE };
const HAIRLINE_ALL: CSSProperties = { borderWidth: UI_BORDER_HAIRLINE };

/** The closed data tones a specimen shows: the product's own states, never availability or roadmap. */
export type SpecimenTone = StatusMarkTone;

/** A state shown as words with a toned dot. The words carry the meaning. */
export interface SpecimenStatus {
  tone: SpecimenTone;
  label: ReactNode;
}

export interface SpecimenField {
  id: string;
  label: ReactNode;
  value: ReactNode;
}

/** Key-value pairs in a `<dl>`. */
export interface SpecimenFieldsPart {
  id: string;
  type: "fields";
  /** Optional caption above the part. */
  label?: ReactNode;
  /** @default 2 */
  columns?: 1 | 2 | 4;
  /** 1 to 6 fields. */
  items: readonly SpecimenField[];
}

export interface SpecimenStatusRow {
  id: string;
  label: ReactNode;
  detail?: ReactNode;
  status: SpecimenStatus;
}

/** Rows of a label, an optional detail and a state, in a `<ul>`. */
export interface SpecimenStatusRowsPart {
  /** Retain all rows; show only the first three below tablet when supplied. */
  mobileRows?: 3;
  id: string;
  type: "status-rows";
  label?: ReactNode;
  /** 1 to 6 rows. */
  items: readonly SpecimenStatusRow[];
}

/** One measured value against an optional limit, drawn with the `Meter` component. */
export interface SpecimenMeterPart {
  id: string;
  type: "meter";
  /** What is measured. */
  label: ReactNode;
  value: number;
  scaleMax: number;
  limit?: number;
  /** @default "max" */
  direction?: MeterDirection;
  tone: SpecimenTone;
  /** The value as visible text; the bar is decoration. */
  valueText: string;
  limitText?: string;
  previous?: number;
  previousText?: string;
  status?: SpecimenStatus;
  /** One short line under the bar (the headroom, say). */
  note?: ReactNode;
}

export interface SpecimenTableColumn {
  id: string;
  label: ReactNode;
}

/** One table cell: text, or a state. */
export type SpecimenTableCell = { text: ReactNode; status?: never } | { status: SpecimenStatus; text?: never };

export interface SpecimenTableRow {
  id: string;
  /** One cell per column, in column order. The first cell is the row header. */
  cells: readonly SpecimenTableCell[];
}

/** A small real table: 1 to 4 columns and 1 to 5 rows. */
export interface SpecimenTablePart {
  id: string;
  type: "table";
  label?: ReactNode;
  /** Names the table for assistive technology (a visually hidden `<caption>`). */
  caption: ReactNode;
  columns: readonly SpecimenTableColumn[];
  rows: readonly SpecimenTableRow[];
}

export interface SpecimenScheduleItem {
  id: string;
  date: ReactNode;
  label: ReactNode;
  amount?: ReactNode;
  status?: SpecimenStatus;
}

/** Dated rows on a hairline rail, in an `<ol>`. */
export interface SpecimenSchedulePart {
  id: string;
  type: "schedule";
  label?: ReactNode;
  /** 1 to 6 rows. */
  items: readonly SpecimenScheduleItem[];
}

/** One share: a percentage from 0 to 100 with its visible text. */
export interface SpecimenShare {
  id: string;
  name: ReactNode;
  share: number;
  shareText: string;
  status?: SpecimenStatus;
}

/**
 * Names with a percentage bar each (ownership, allocation), in a `<ul>`.
 * A bar fills in the brand accent; a share with a `status` fills in that
 * status's tone instead, so the bar repeats the mark beside its name.
 */
export interface SpecimenSharesPart {
  id: string;
  type: "shares";
  label?: ReactNode;
  /** 1 to 6 shares. */
  items: readonly SpecimenShare[];
}

export interface SpecimenFile {
  id: string;
  /** Short file-type tag, such as a three-letter extension. */
  format: ReactNode;
  name: ReactNode;
  /** Where the file lives. */
  source?: ReactNode;
}

/** A list of files with a type tag, a name and a source, in a `<ul>`. */
export interface SpecimenFilesPart {
  id: string;
  type: "files";
  label?: ReactNode;
  /** 1 to 6 files. */
  items: readonly SpecimenFile[];
}

/** One part of a specimen panel. */
export type SpecimenPart =
  | SpecimenFieldsPart
  | SpecimenStatusRowsPart
  | SpecimenMeterPart
  | SpecimenTablePart
  | SpecimenSchedulePart
  | SpecimenSharesPart
  | SpecimenFilesPart;

export type SpecimenPartType = SpecimenPart["type"];

/** Rows one part may hold. */
export const SPECIMEN_PART_MAX_ROWS = 6;
/** Rows and columns a table part may hold. */
export const SPECIMEN_TABLE_MAX_ROWS = 5;
export const SPECIMEN_TABLE_MAX_COLUMNS = 4;

function assertCount(what: string, count: number, max: number): void {
  if (count < 1 || count > max) {
    throw new RangeError("Specimen: " + what + " must hold 1 to " + max + ", got " + count + ".");
  }
}

/**
 * Throws a `RangeError` when a part breaks its budget: 1 to 6 rows (a table
 * 1 to 4 columns and 1 to 5 rows, one cell per column), shares from 0 to
 * 100. Budgets are validated, not advisory: a crowded specimen is a data
 * error, not a layout to draw.
 */
export function assertSpecimenPart(part: SpecimenPart): void {
  const where = "the " + part.type + ' part "' + part.id + '"';
  if (part.type === "status-rows" && part.mobileRows !== undefined && part.mobileRows !== 3) throw new TypeError("Specimen: mobileRows must be 3 when supplied.");
  if (part.type === "meter") return; // One value; the Meter component validates its numbers.
  if (part.type === "table") {
    assertCount(where + " columns", part.columns.length, SPECIMEN_TABLE_MAX_COLUMNS);
    assertCount(where + " rows", part.rows.length, SPECIMEN_TABLE_MAX_ROWS);
    for (const row of part.rows) {
      if (row.cells.length !== part.columns.length) {
        throw new RangeError(
          "Specimen: " + where + ' row "' + row.id + '" must hold one cell per column (' + part.columns.length + "), got " + row.cells.length + ".",
        );
      }
    }
    return;
  }
  assertCount(where, part.items.length, SPECIMEN_PART_MAX_ROWS);
  if (part.type === "status-rows") assertNoNestedInteractive("Specimen", part.id, [part.label, ...part.items.flatMap(row => [row.label, row.detail, row.status.label])]);
  if (part.type === "shares") {
    for (const item of part.items) {
      if (!Number.isFinite(item.share) || item.share < 0 || item.share > 100) {
        throw new RangeError("Specimen: " + where + ' share "' + item.id + '" must be a number from 0 to 100, got ' + String(item.share) + ".");
      }
    }
  }
}

/** Row separators inside a list part: a hairline above every row but the first, padding between. */
function dividedRow(index: number, count: number): { className: string | undefined; style: CSSProperties | undefined } {
  return {
    className: cx(index > 0 ? DIVIDED_ROW : undefined, index < count - 1 ? "pb-sm" : undefined) || undefined,
    style: index > 0 ? HAIRLINE_BLOCK_START : undefined,
  };
}

function Status({ status }: { status: SpecimenStatus | undefined }) {
  return status ? <StatusMark tone={status.tone}>{status.label}</StatusMark> : null;
}

/** Decorative number; the enclosing key list carries the accessible ordinal. */
export function AnatomyMarker({ number }: { number: number | undefined }) {
  return number === undefined ? null : <span data-anatomy-marker="" aria-hidden="true" className="anatomy-disc inline-flex shrink-0 items-center justify-center rounded-pill bg-ink-primary text-surface-raised font-body text-caption font-semibold tabular-nums leading-none">{number}</span>;
}

function PartLabel({ children, marker }: { children: ReactNode; marker?: number }) {
  if (children === undefined || children === null || children === false) return null;
  return (
    <p data-specimen-part-label="" className={cx(PART_LABEL_CLASSES, marker !== undefined ? "flex items-center gap-sm" : undefined)}>
      <AnatomyMarker number={marker} />
      {children}
    </p>
  );
}

function FieldsBody({ part }: { part: SpecimenFieldsPart }) {
  return (
    <dl className={FIELDS_COLUMN_CLASSES[part.columns ?? 2]}>
      {part.items.map((field) => (
        <div key={field.id} className={ROW_TEXT_CLASSES}>
          <dt className={SECONDARY_CAPTION}>{field.label}</dt>
          <dd className={cx(PRIMARY_TEXT, "m-0 tabular-nums")}>{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatusRowsBody({ part }: { part: SpecimenStatusRowsPart }) {
  return (
    <ul className={LIST_RESET_CLASSES}>
      {part.items.map((row, index) => {
        const divided = dividedRow(index, part.items.length);
        return (
          <li key={row.id} className={cx(ROW_CLASSES, divided.className, part.mobileRows === 3 && index >= 3 ? "max-tablet:hidden" : undefined)} style={divided.style}>
            <div className={ROW_TEXT_CLASSES}>
              <span className={PRIMARY_TEXT}>{row.label}</span>
              {row.detail ? <span className={cx(SECONDARY_CAPTION, "tabular-nums")}>{row.detail}</span> : null}
            </div>
            <Status status={row.status} />
          </li>
        );
      })}
    </ul>
  );
}

function MeterBody({ part, marker }: { part: SpecimenMeterPart; marker?: number }) {
  return (
    <div className="flex flex-col gap-sm">
      <div className={ROW_CLASSES}>
        <span className={cx(PRIMARY_TEXT, marker !== undefined ? "flex items-center gap-sm" : undefined)}><AnatomyMarker number={marker} />{part.label}</span>
        <Status status={part.status} />
      </div>
      <Meter
        value={part.value}
        scaleMax={part.scaleMax}
        limit={part.limit}
        direction={part.direction}
        tone={part.tone}
        valueText={part.valueText}
        limitText={part.limitText}
        previous={part.previous}
        previousText={part.previousText}
        emphasis="figure"
      />
      {part.note ? <p className={cx(SECONDARY_CAPTION, "m-0")}>{part.note}</p> : null}
    </div>
  );
}

function CellContent({ cell }: { cell: SpecimenTableCell }) {
  if (cell.status) return <StatusMark tone={cell.status.tone}>{cell.status.label}</StatusMark>;
  return <>{cell.text}</>;
}

/**
 * Explicit table roles: a table whose display changes below `tablet` keeps
 * its table semantics only when the roles are stated (some engines drop
 * them with the display change).
 */
function TableBody({ part }: { part: SpecimenTablePart }) {
  return (
    <table role="table" className={TABLE_CLASSES.table}>
      <caption className={TABLE_CLASSES.caption}>{part.caption}</caption>
      <thead role="rowgroup" className={TABLE_CLASSES.head}>
        <tr role="row" className={TABLE_CLASSES.headRow}>
          {part.columns.map((column) => (
            <th key={column.id} role="columnheader" scope="col" className={TABLE_CLASSES.columnHeader}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody role="rowgroup" className={TABLE_CLASSES.body}>
        {part.rows.map((row) => (
          <tr key={row.id} role="row" className={TABLE_CLASSES.row} style={HAIRLINE_BLOCK_START}>
            {row.cells.map((cell, index) => {
              const column = part.columns[index];
              if (index === 0) {
                return (
                  <th key={column?.id ?? index} role="rowheader" scope="row" className={TABLE_CLASSES.rowHeader}>
                    <CellContent cell={cell} />
                  </th>
                );
              }
              return (
                <td key={column?.id ?? index} role="cell" className={TABLE_CLASSES.cell}>
                  <span aria-hidden="true" className={TABLE_CLASSES.cellLabel}>
                    {column?.label}
                  </span>
                  <span className={TABLE_CLASSES.cellValue}>
                    <CellContent cell={cell} />
                  </span>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ScheduleBody({ part }: { part: SpecimenSchedulePart }) {
  return (
    <ol className={SCHEDULE_CLASSES.list} style={HAIRLINE_INLINE_START}>
      {part.items.map((item) => (
        <li key={item.id} className={SCHEDULE_CLASSES.item}>
          <div className={ROW_TEXT_CLASSES}>
            <span className={cx(SECONDARY_CAPTION, "tabular-nums")}>{item.date}</span>
            <span className={PRIMARY_TEXT}>{item.label}</span>
          </div>
          {item.amount || item.status ? (
            <div className={SCHEDULE_CLASSES.trailing}>
              {item.amount ? <span className={SCHEDULE_CLASSES.amount}>{item.amount}</span> : null}
              <Status status={item.status} />
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function SharesBody({ part }: { part: SpecimenSharesPart }) {
  return (
    <ul className="m-0 flex flex-col gap-md p-0">
      {part.items.map((item) => (
        <li key={item.id} className="flex flex-col gap-xs">
          <div className={ROW_CLASSES}>
            <span className={cx(PRIMARY_TEXT, "min-w-0")}>{item.name}</span>
            <Status status={item.status} />
          </div>
          {/* A share with no status is a plain quantity, so its bar takes the brand accent. */}
          <Meter value={item.share} scaleMax={100} tone={item.status ? item.status.tone : "accent"} valueText={item.shareText} />
        </li>
      ))}
    </ul>
  );
}

function FilesBody({ part }: { part: SpecimenFilesPart }) {
  return (
    <ul className={LIST_RESET_CLASSES}>
      {part.items.map((file, index) => {
        const divided = dividedRow(index, part.items.length);
        return (
          <li key={file.id} className={cx("flex flex-wrap items-baseline gap-x-md gap-y-xs", divided.className)} style={divided.style}>
            <span className={FILE_FORMAT_CLASSES} style={HAIRLINE_ALL}>
              {file.format}
            </span>
            <span className={cx(PRIMARY_TEXT, "min-w-0 flex-1")}>{file.name}</span>
            {file.source ? <span className={SECONDARY_CAPTION}>{file.source}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function PartBody({ part, marker }: { part: SpecimenPart; marker?: number }) {
  switch (part.type) {
    case "fields":
      return <FieldsBody part={part} />;
    case "status-rows":
      return <StatusRowsBody part={part} />;
    case "meter":
      return <MeterBody part={part} marker={marker} />;
    case "table":
      return <TableBody part={part} />;
    case "schedule":
      return <ScheduleBody part={part} />;
    case "shares":
      return <SharesBody part={part} />;
    case "files":
      return <FilesBody part={part} />;
  }
}

/**
 * One specimen part: an optional caption label (except a meter, whose
 * `label` names the measure) and its body. Internal to `SpecimenPanel`.
 */
export function SpecimenPartView({ part, marker }: { part: SpecimenPart; marker?: number }) {
  assertSpecimenPart(part);
  return (
    <div data-specimen-part={part.type} className="flex min-w-0 flex-col gap-sm">
      {part.type === "meter" ? null : <PartLabel marker={marker}>{part.label}</PartLabel>}
      <PartBody part={part} marker={marker} />
    </div>
  );
}
