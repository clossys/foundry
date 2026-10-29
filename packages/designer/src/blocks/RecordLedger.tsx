import type { ReactNode } from "react";
import { cx } from "../selected-components/internal/cx.js";
import { UI_BORDER_HAIRLINE, UI_BORDER_RULE } from "../selected-components/internal/ui-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { LedgerRows, LedgerStatus } from "./ledger-rows.js";
import { ledgerDomIds } from "./internal/ledger-ids.js";
import { assertLedgerIds, assertLedgerRows, hasLedgerContent, type LedgerGroupData, type LedgerRowData } from "./internal/ledger-data.js";
export type { LedgerGroupData, LedgerRowData } from "./internal/ledger-data.js";

interface LedgerCommonProps { ground?: SectionGround; headingLevel?: 3 | 4; className?: string }
export interface RecordLedgerProps extends LedgerCommonProps {
  form: "record";
  /** Unique caller instance seed; generated DOM IDs name the figure and groups. */
  id: string;
  head: { title: ReactNode; meta?: ReactNode; status?: LedgerRowData["status"] };
  columns?: 1 | 2 | 3;
  groups: readonly LedgerGroupData[];
  caption: ReactNode;
  flagLabel?: ReactNode;
}
const TOP_RULE_CLASSES: Record<SectionGround, string> = { base: "border-ink-primary", sunken: "border-ink-primary", inverse: "border-ink-on-inverse" };
const PLATE_CLASSES: Record<SectionGround, string> = { base: "bg-surface-sunken", sunken: "bg-surface-base", inverse: "bg-surface-inverse-raised" };
const OWNER_COLUMN_CLASSES = "ledger-owner-columns";
const LABEL_CLASSES = "m-0 font-mono text-caption uppercase tracking-label";
const COLUMN_CLASSES: Record<1 | 2 | 3, string> = { 1: "grid grid-cols-1", 2: "grid ledger-columns-two", 3: "grid ledger-columns-three" };

/** A record on rules, without a panel. Static and server-safe. */
export function RecordLedger(props: RecordLedgerProps) {
  if (props.form !== "record") throw new TypeError("RecordLedger: only record form is supported.");
  const { ground = "base", headingLevel = 3, className } = props;
  const colors = SECTION_GROUND_CLASSES[ground];
  const Heading = headingLevel === 4 ? "h4" : "h3";
  if (!hasLedgerContent(props.head.title) || !hasLedgerContent(props.caption)) throw new TypeError("RecordLedger: record title and caption require visible content.");
  const columns = props.columns ?? 1;
  assertLedgerIds("RecordLedger instance", [props.id]);
  if (![1, 2, 3].includes(columns) || props.groups.length < 1 || props.groups.length > 3 || (columns > 1 && props.groups.length !== columns)) throw new RangeError("RecordLedger: requires 1 to 3 groups matching columns when columns exceeds 1.");
  assertLedgerIds("Ledger groups", props.groups.map(group => group.id));
  let flags = 0;
  for (const [index, group] of props.groups.entries()) {
    if ((group.rows === undefined) === (group.owner === undefined) || (group.owner !== undefined && index !== props.groups.length - 1) || (group.note !== undefined && group.owner === undefined)) throw new TypeError("RecordLedger: groups contain either rows or an owner; the owner is last and exclusively owns the group note.");
    if (group.rows) { assertLedgerRows(group.rows, props.flagLabel); flags += group.rows.filter(row => row.flag).length; }
  }
  if (flags > 1) throw new TypeError("RecordLedger: at most one flagged row per record.");
  const ids = ledgerDomIds(props.id);
  const namedGroups = props.groups.map(group => ({ group, headingId: ids.groupId(group.id) }));
  const compactOwner = columns === 3 && props.groups[2]?.owner !== undefined;
  return <figure id={ids.figureId} data-record-ledger="" data-form="record" data-columns={columns} aria-labelledby={ids.headId} className={cx("m-0 min-w-0 border-t", TOP_RULE_CLASSES[ground], className)} style={{ borderBlockStartWidth: UI_BORDER_RULE }}>
    <div className={cx("flex flex-wrap items-start justify-between gap-x-lg gap-y-sm border-b py-lg", colors.border)} style={{ borderBlockEndWidth: UI_BORDER_HAIRLINE }}>
      <div className="min-w-0 flex flex-col gap-xs"><p id={ids.headId} className={cx("m-0 text-body-l font-semibold leading-heading", colors.primary)}>{props.head.title}</p>{hasLedgerContent(props.head.meta) ? <p className={cx("m-0 text-body-s tabular-nums", colors.secondary)}>{props.head.meta}</p> : null}</div>
      <LedgerStatus status={props.head.status} ground={ground} />
    </div>
    <div className={cx(COLUMN_CLASSES[columns], compactOwner ? OWNER_COLUMN_CLASSES : undefined)}>{namedGroups.map(({ group, headingId }, index) => <section key={group.id} data-ledger-group="" aria-labelledby={headingId} className={cx("min-w-0 py-lg", index > 0 ? cx("ledger-group-divided", colors.border) : undefined)}>
      <Heading id={headingId} className={cx(LABEL_CLASSES, "mb-sm", colors.secondary)}>{group.label}</Heading>
      {group.rows ? <LedgerRows rows={group.rows} flagLabel={props.flagLabel} ground={ground} /> : group.owner ? <>
        <div className="flex items-center gap-sm text-body-s"><span aria-hidden="true" className={cx("ledger-owner-disc inline-flex shrink-0 items-center justify-center rounded-pill text-caption font-semibold", PLATE_CLASSES[ground], colors.primary)}>{group.owner.initials}</span><div className={cx("min-w-0", colors.primary)}>{group.owner.name}{hasLedgerContent(group.owner.note) ? <span> · {group.owner.note}</span> : null}</div></div>
        {hasLedgerContent(group.note) ? <p className={cx("m-0 mt-md text-body-s text-pretty", colors.secondary)}>{group.note}</p> : null}
      </> : null}
    </section>)}</div>
    <figcaption className={cx("m-0 wrap-anywhere mt-sm text-caption", colors.secondary)}>{props.caption}</figcaption>
  </figure>;
}
