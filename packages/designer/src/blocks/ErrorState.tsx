import { useId, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "../components/internal/cx.js";

import { SectionHeader, type SectionHeaderLevel } from "./SectionHeader.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.error-state", "foundry/sections.error-state");

/** What went wrong: the four failure kinds a page shows in place of its content. */
export type ErrorStateKind = "not-found" | "failure" | "forbidden" | "offline";

export interface ErrorStateProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** The failure kind. It is data the host chose, rendered as `data-error-kind`; copy stays host-authored. */
  kind: ErrorStateKind;
  /** Heading that names the region. */
  title: ReactNode;
  /** One line explaining what happened and what the reader can do. */
  description?: ReactNode;
  /** A short reference the reader can quote ("404", "Request 8f2c"). Rendered above the title. */
  code?: ReactNode;
  /** Recovery action, typically a `Button` that retries. */
  retry?: ReactNode;
  /** Secondary action, typically a `Link` to report the problem or get help. */
  report?: ReactNode;
  /** @default 2 */
  headingLevel?: SectionHeaderLevel;
}

/**
 * Shown in place of a page or a region whose content failed to load, was not
 * found, is not permitted, or is unreachable offline. A labelled `<section>`
 * that composes the shared `SectionHeader` (code as eyebrow, title,
 * description) and an actions row of at most the two host-supplied actions:
 * `retry` first, then `report`. It owns no request, timer or retry logic, and
 * it is not a live region: a page that replaces its content with this state
 * moves focus or announces the change itself.
 */
export function ErrorState({ kind, title, description, code, retry, report, headingLevel = 2, className, ...rest }: ErrorStateProps) {
  const titleId = useId();
  const actions = retry || report ? <>{retry}{report}</> : undefined;
  return (
    <SemanticContent as="section"
      {...SECTION_STAMP} {...rest}
      aria-labelledby={titleId}
      data-error-kind={kind}
      className={cx("flex flex-col items-center gap-sm p-2xl text-center", className)}
    >
      <SectionHeader
        density="standard"
        align="center"
        level={headingLevel}
        eyebrow={code}
        title={<SemanticContent as="span" id={titleId}>{title}</SemanticContent>}
        description={description}
        actions={actions}
      />
    </SemanticContent>
  );
}
