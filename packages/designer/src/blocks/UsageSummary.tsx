import type { HTMLAttributes } from "react";
import { cx } from "../components/internal/cx.js";
import { EmptyState, type EmptyStateProps } from "./EmptyState.js";
import { UsageMeter, type UsageMeterProps } from "./UsageMeter.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.usage", "foundry/sections.usage");

/** One meter record; `id` is the meter's DOM id and React key, unique on the page. */
export type UsageSummaryMeter = UsageMeterProps & { id: string };

export interface UsageSummaryProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  "aria-label": string;
  /** Usage records, each drawn by UsageMeter in authored order. */
  meters: readonly UsageSummaryMeter[];
  /** Shown instead of the list when there are no meters; required for an empty list. */
  emptyState?: EmptyStateProps;
}

/** Usage for several limits at once: a responsive list of UsageMeter records. */
export function UsageSummary({ meters, emptyState, className, ...rest }: UsageSummaryProps) {
  if (meters.length === 0 && !emptyState) throw new RangeError("UsageSummary: meters is empty and no emptyState was supplied.");
  return (
    <SemanticContent as="section" {...SECTION_STAMP} {...rest} className={cx("flex min-w-0 flex-col gap-md font-body", className)}>
      {meters.length === 0 && emptyState ? <EmptyState {...emptyState} /> : (
        <SemanticContent as="ul" className="grid grid-cols-1 gap-lg tablet:grid-cols-2">
          {meters.map(meter => <SemanticContent as="li" key={meter.id} className="min-w-0"><UsageMeter {...meter} /></SemanticContent>)}
        </SemanticContent>
      )}
    </SemanticContent>
  );
}
