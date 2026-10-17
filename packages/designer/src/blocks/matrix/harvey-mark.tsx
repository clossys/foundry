import { cx } from "../../atoms/internal/cx.js";
import { UI_BORDER_HAIRLINE } from "../../atoms/internal/ui-vars.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "../section-ground.js";

// Clockwise quarters in a 16-unit drawing box; color repeats the geometry.
const QUARTERS = [
  "M8 8V1a7 7 0 0 1 7 7Z",
  "M8 8h7a7 7 0 0 1-7 7Z",
  "M8 8v7a7 7 0 0 1-7-7Z",
  "M8 8H1a7 7 0 0 1 7-7Z",
] as const;

/** Internal decorative coverage mark. Its caller supplies the authored words. */
export function HarveyMark({ value, ground }: { value: 0 | 1 | 2 | 3 | 4; ground: SectionGround }) {
  const colors = SECTION_GROUND_CLASSES[ground];
  return <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" className="inline-block size-lg shrink-0">
    {QUARTERS.slice(0, value).map(d => <path key={d} d={d} className={cx("fill-current", colors.primary)} />)}
    <circle cx="8" cy="8" r="7" fill="none" className={cx("stroke-current", colors.secondary)} style={{ strokeWidth: UI_BORDER_HAIRLINE }} />
  </svg>;
}
