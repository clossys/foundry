import { componentLeaf } from "../runtime/component-leaf.js";
import { useId, type ComponentType, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { SECTION_GROUND_CLASSES, type SectionGround } from "./section-ground.js";
import type { SectionHeaderLevel } from "./SectionHeader.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");
const Card = componentLeaf<ComponentType<HTMLAttributes<HTMLDivElement>>>("components.card");
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

/** A closing band with caller-owned copy and actions, composed from the consumer's selected component leaves. */
export function CallToAction({ title, eyebrow, description, primaryAction, secondaryAction, ground = "sunken", headingLevel = 2, className, ...rest }: CallToActionProps) {
  const titleId = useId(), descriptionId = useId();
  const heading: `h${SectionHeaderLevel}` = `h${headingLevel}`;
  return (
    <SemanticContent as="section"
      {...SECTION_STAMP} {...rest}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      data-ground={ground}
      className={cx("min-w-0 w-full", SECTION_GROUND_CLASSES[ground].surface, className)}
    >
      <Card className="items-center gap-lg px-lg py-3xl text-center">
        <SemanticContent as="div" className="flex min-w-0 w-full max-w-prose flex-col items-center gap-sm">
          {eyebrow ? <SemanticContent as="p" className="text-caption uppercase tracking-label text-muted-foreground">{eyebrow}</SemanticContent> : null}
          <SemanticContent as={heading} id={titleId} className="text-h2 font-display text-balance">{title}</SemanticContent>
          {description ? <SemanticContent as="p" id={descriptionId} className="text-body text-pretty text-muted-foreground">{description}</SemanticContent> : null}
        </SemanticContent>
        <SemanticContent as="div" className="flex w-full min-w-0 flex-col items-stretch justify-center gap-sm tablet:w-auto tablet:flex-row tablet:flex-wrap tablet:items-center">
          {primaryAction}
          {secondaryAction}
        </SemanticContent>
      </Card>
    </SemanticContent>
  );
}
