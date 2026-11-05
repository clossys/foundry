import type { ReactNode } from "react";
import { StatusMark } from "../components/StatusMark.js";
import { cx } from "../components/internal/cx.js";
import { UI_BORDER_HAIRLINE, UI_BORDER_RULE } from "../components/internal/ui-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { hasLedgerContent, type LedgerRowData } from "./internal/ledger-data.js";

const FLAG_CLASSES: Record<SectionGround, string> = { base: "border-s-accent", sunken: "border-s-accent", inverse: "border-s-accent-on-inverse" };
const LIST_CLASSES = "m-0 list-none p-0 flex flex-col";
const ROW_CLASSES = "grid min-w-0 ledger-row-grid items-start gap-x-lg text-body-s";

/** Ledger-only inverse label ink. StatusMark's glyph and global defaults stay intact. */
export function LedgerStatus({ status, ground, className }: { status: LedgerRowData["status"]; ground: SectionGround; className?: string }) {
  return status ? <StatusMark tone={status.tone} className={className}><span className={ground === "inverse" ? "text-ink-on-inverse" : undefined}>{status.label}</span></StatusMark> : null;
}

/** Shared static rows for the record and tile. The mobile cap only applies below tablet. */
export function LedgerRows({ rows, ground, flagLabel, tile = false, mobileRows }: { rows: readonly LedgerRowData[]; ground: SectionGround; flagLabel?: ReactNode; tile?: boolean; mobileRows?: 3 }) {
  const colors = SECTION_GROUND_CLASSES[ground];
  return <ul className={LIST_CLASSES}>{rows.map((row, index) => <li
    key={row.id} data-ledger-row="" data-flag={row.flag ? "" : undefined}
    className={cx(ROW_CLASSES, tile ? "py-xs" : "py-sm", index > 0 ? cx("border-t", colors.border) : undefined, row.flag ? cx("border-s ps-md", FLAG_CLASSES[ground]) : undefined, mobileRows !== undefined && index >= mobileRows ? "max-tablet:hidden" : undefined)}
    style={{ borderBlockStartWidth: index > 0 ? UI_BORDER_HAIRLINE : undefined, borderInlineStartWidth: row.flag ? UI_BORDER_RULE : undefined }}
  >
    <div className="min-w-0 wrap-anywhere flex flex-col">
      <span className={cx("font-medium", colors.primary)}>{row.flag ? <span className="sr-only">{flagLabel} </span> : null}{row.label}</span>
      {hasLedgerContent(row.detail) ? <span className={cx("tabular-nums", colors.secondary)}>{row.detail}</span> : null}
    </div>
    <LedgerStatus status={row.status} ground={ground} className="justify-self-end" />
  </li>)}</ul>;
}
