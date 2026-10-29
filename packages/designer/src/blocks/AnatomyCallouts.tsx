import type { CSSProperties, ReactNode } from "react";
import { cx } from "../selected-components/internal/cx.js";
import { UI_BORDER_HAIRLINE } from "../selected-components/internal/ui-vars.js";
import { Item } from "./items/Item.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { SpecimenPanel, assertSpecimenMarkerTargets, type SpecimenPanelContent } from "./specimen/SpecimenPanel.js";

const DISC_CLASSES = "anatomy-disc inline-flex shrink-0 items-center justify-center rounded-pill font-body text-caption font-semibold tabular-nums leading-none";
const KEY_DISC_CLASSES: Record<SectionGround, string> = {
  base: "bg-ink-primary text-surface-base",
  sunken: "bg-ink-primary text-surface-sunken",
  inverse: "bg-ink-on-inverse text-surface-inverse",
};

export interface AnatomyCalloutsMarker {
  id: string;
  /** The panel title, a labelled part id, or the footer. */
  target: string;
  heading: ReactNode;
  description: ReactNode;
}
export interface AnatomyCalloutsProps {
  /** Unique caller instance id; the accessible label and key use its stable suffixes. */
  id: string;
  label: ReactNode;
  panel: SpecimenPanelContent;
  markers: readonly AnatomyCalloutsMarker[];
  /** @default "end" */
  legendSide?: "end" | "below";
  sample?: ReactNode;
  keyLabel: ReactNode;
  /** @default 3 */
  headingLevel?: 3 | 4;
  /** @default "base" */
  ground?: SectionGround;
  className?: string;
  style?: CSSProperties;
}
function hasContent(node: ReactNode): boolean {
  if (node === undefined || node === null || typeof node === "boolean") return false;
  if (typeof node === "string") return node.trim().length > 0;
  if (Array.isArray(node)) return node.some(hasContent);
  return true;
}
function assertIds(ids: readonly string[]): void {
  if (ids.some(id => typeof id !== "string" || !id || /\s/.test(id)) || new Set(ids).size !== ids.length) throw new TypeError("AnatomyCallouts: ids must be nonempty, unique and contain no whitespace.");
}

/** One static specimen panel and its ordered key. Markers follow existing label lines, without hooks or controls. */
export function AnatomyCallouts({ id, label, panel, markers, legendSide = "end", sample, keyLabel, headingLevel = 3, ground = "base", className, style }: AnatomyCalloutsProps) {
  if (markers.length < 3 || markers.length > 5) throw new RangeError("AnatomyCallouts: requires 3 to 5 markers.");
  assertIds([id]);
  assertIds(markers.map(marker => marker.id));
  const targets = markers.map(marker => marker.target);
  if (new Set(targets).size !== targets.length) throw new TypeError("AnatomyCallouts: marker targets must be unique.");
  const order = assertSpecimenMarkerTargets(panel, targets);
  let previous = -1;
  for (const target of targets) {
    const position = order.indexOf(target);
    if (position <= previous) throw new TypeError("AnatomyCallouts: markers must follow panel reading order.");
    previous = position;
  }
  if (!hasContent(label) || !hasContent(keyLabel)) throw new TypeError("AnatomyCallouts: label and keyLabel require caller content.");
  const keyAtEnd = legendSide === "end";
  const labelId = `${id}-label`;
  const keyId = `${id}-key`;
  const keyNameId = `${id}-key-name`;
  const numbers = Object.fromEntries(markers.map((marker, index) => [marker.target, index + 1]));
  const colors = SECTION_GROUND_CLASSES[ground];
  return <div data-anatomy-callouts="" data-legend-side={legendSide} className={cx("grid min-w-0 grid-cols-1 gap-2xl", keyAtEnd ? "tablet-lg:anatomy-columns tablet-lg:gap-x-3xl tablet-lg:items-start" : undefined, className)} style={style}>
    <figure aria-labelledby={labelId} aria-describedby={keyId} className="m-0 min-w-0">
      <p id={labelId} className="sr-only">{label}</p>
      <SpecimenPanel {...panel} markers={numbers} />
      {hasContent(sample) ? <figcaption className={cx("m-0 mt-sm text-caption", colors.secondary)}>{sample}</figcaption> : null}
    </figure>
    <div className={cx("min-w-0 anatomy-key-measure", keyAtEnd ? "tablet-lg:max-w-none" : undefined)}>
    <p id={keyNameId} className="sr-only">{keyLabel}</p>
    <ol id={keyId} aria-labelledby={keyNameId} className="m-0 min-w-0 list-none p-0 flex flex-col">
      {markers.map((marker, index) => <li key={marker.id} className={cx("grid anatomy-key-row min-w-0 wrap-anywhere gap-x-md gap-y-xs py-lg", index > 0 ? cx("border-t", colors.border) : "pt-0")} style={index > 0 ? { borderBlockStartWidth: UI_BORDER_HAIRLINE } : undefined}>
        <span data-anatomy-key-number="" aria-hidden="true" className={cx(DISC_CLASSES, KEY_DISC_CLASSES[ground])}>{index + 1}</span>
        <Item id={marker.id} heading={marker.heading} description={marker.description} treatment="plain" size="standard" ground={ground} headingLevel={headingLevel} />
      </li>)}
    </ol>
    </div>
  </div>;
}
