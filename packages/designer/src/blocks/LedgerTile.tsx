import type { ReactNode } from "react";
import { cx } from "../atoms/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { assertNoNestedInteractive } from "./stretched-link.js";
import { LedgerRows } from "./ledger-rows.js";
import { hasLedgerContent, assertLedgerRows, type LedgerRowData } from "./internal/ledger-data.js";

export interface LedgerTileProps {
  caption: ReactNode;
  /** Two to five static rows. */
  rows: readonly LedgerRowData[];
  /** Show the first three rows below tablet; show every row from tablet. */
  mobileRows?: 3;
  /** Required when a row is flagged: the caller's visually hidden lead-in. */
  flagLabel?: ReactNode;
  ground?: SectionGround;
  className?: string;
}
const PLATE_CLASSES: Record<SectionGround, string> = { base: "bg-surface-sunken", sunken: "bg-surface-base", inverse: "bg-surface-inverse-raised" };

/** A static captioned row group, suitable as a rule card's visual. Server-safe. */
export function LedgerTile({ caption, rows, mobileRows, flagLabel, ground = "base", className }: LedgerTileProps) {
  if (!hasLedgerContent(caption)) throw new TypeError("LedgerTile: caption requires visible content.");
  assertLedgerRows(rows, flagLabel, 2, 5);
  if (mobileRows !== undefined && mobileRows !== 3) throw new RangeError("LedgerTile: mobileRows must be 3 when provided.");
  // CardGrid cannot inspect opaque component props; this static visual checks its own nodes.
  assertNoNestedInteractive("LedgerTile", "visual", [caption, flagLabel, ...rows.flatMap(row => [row.label, row.detail, row.status?.label])]);
  return <figure data-ledger-tile="" data-mobile-rows={mobileRows} className={cx("m-0 min-w-0 rounded-panel px-lg py-md", PLATE_CLASSES[ground], className)}>
    <figcaption className={cx("m-0 wrap-anywhere mb-xs font-mono text-caption uppercase tracking-label", SECTION_GROUND_CLASSES[ground].secondary)}>{caption}</figcaption>
    <LedgerRows rows={rows} flagLabel={flagLabel} ground={ground} mobileRows={mobileRows} tile />
  </figure>;
}
