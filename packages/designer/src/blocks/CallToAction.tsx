import { useId, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import { SectionHeader, type SectionHeaderLevel } from "./SectionHeader.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.call-to-action", "foundry/sections.call-to-action");

export interface CallToActionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** The ask, as the section heading. Header region, with `eyebrow` and `description`. */
  title: ReactNode;
  /** Short label above the heading. */
  eyebrow?: ReactNode;
  /** One line of supporting copy. */
  description?: ReactNode;
  /** The one primary action, typically a `Link` or `Button`. */
  primaryAction: ReactNode;
  /** At most one secondary action. Two actions is the contract ceiling; there is no third slot. */
  secondaryAction?: ReactNode;
  /** The ground the band sits on. @default "sunken" */
  ground?: SectionGround;
  /** @default 2 */
  headingLevel?: SectionHeaderLevel;
}

/**
 * A closing band that asks the reader to do one thing: a centred
 * `SectionHeader` (eyebrow, title, description) and an actions row of one
 * primary and at most one secondary action. A labelled `<section>` on a
 * section ground; the host supplies the actions, so no destination or
 * analytics is assumed.
 */
export function CallToAction({ title, eyebrow, description, primaryAction, secondaryAction, ground = "sunken", headingLevel = 2, className, ...rest }: CallToActionProps) {
  const titleId = useId();
  return (
    <section
      {...SECTION_STAMP} {...rest}
      aria-labelledby={titleId}
      data-ground={ground}
      className={cx("flex flex-col items-center gap-lg rounded-panel px-lg py-3xl text-center", SECTION_GROUND_CLASSES[ground].surface, className)}
    >
      <SectionHeader
        density="standard"
        align="center"
        ground={ground}
        level={headingLevel}
        eyebrow={eyebrow}
        title={<span id={titleId}>{title}</span>}
        description={description}
      />
      <div className="flex flex-wrap items-center justify-center gap-sm">
        {primaryAction}
        {secondaryAction}
      </div>
    </section>
  );
}
