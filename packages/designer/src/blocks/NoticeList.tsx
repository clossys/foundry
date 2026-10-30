import type { HTMLAttributes, ReactNode } from "react";
import type { BannerVariant } from "../components/Banner.js";

import { SECTION_CONTENT_STYLE } from "./internal/section-content-gutter.js";
import { cx } from "../components/internal/cx.js";
import { dsAttrs } from "../catalog-core/provenance-attrs.js";
import { componentLeaf } from "../runtime/component-leaf.js";

const Banner = componentLeaf<typeof import("../components/Banner.js").Banner>("components.banner");
const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");

/** Section root provenance (D1): the selected Foundry fill this block is. */
const SECTION_STAMP = dsAttrs("sections", "sections.notices", "foundry/sections.notices");

export interface NoticeListItem {
  /** Stable key, passed back to `onDismiss`. */
  id: string;
  /** Severity; drives the `Banner` tone and its live-region politeness. @default "info" */
  tone?: BannerVariant;
  /** Short lead-in, rendered in the strong weight before the message. */
  title?: ReactNode;
  /** The notice itself. */
  message: ReactNode;
  /** Optional follow-up, typically a `Link` ("Review billing"). */
  action?: ReactNode;
  /** Whether this notice can be dismissed; needs `onDismiss` on the list. @default true */
  dismissible?: boolean;
}
export interface NoticeListProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  /** The notices, most important first. Each renders one `Banner`. */
  notices: readonly NoticeListItem[];
  /** Accessible name of the notices region ("Account notices"). */
  label: string;
  /** Called with a notice's id when its dismiss control is pressed. The host removes it. */
  onDismiss?: (id: string) => void;
  /** Accessible label for each dismiss control; omitted means resolve Banner's shell CopyRef. */
  dismissLabel?: string;
}

/**
 * A stack of page-level notices: a labelled region holding a list of Foundry
 * `Banner`s, one per notice, each with its own tone and live-region role. It
 * owns no queue, timer or storage: the host supplies the notices, decides
 * their order and removes one when `onDismiss` reports it.
 */
export function NoticeList({ notices, label, onDismiss, dismissLabel, className, style, ...rest }: NoticeListProps) {
  return (
    <SemanticContent as="section" {...SECTION_STAMP} {...rest} aria-label={label} className={cx("flex min-w-0 flex-col", className)} style={{ ...SECTION_CONTENT_STYLE, ...style }}>
      <SemanticContent as="ul" role="list" className="m-0 flex list-none flex-col gap-sm p-0">
        {notices.map(notice => (
          <SemanticContent as="li" key={notice.id}>
            <Banner
              variant={notice.tone ?? "info"}
              dismissLabel={dismissLabel}
              onDismiss={onDismiss && notice.dismissible !== false ? () => onDismiss(notice.id) : undefined}
            >
              <SemanticContent as="span" className="flex flex-wrap items-baseline gap-x-sm gap-y-xs">
                {notice.title ? <SemanticContent as="strong" className="font-medium">{notice.title}</SemanticContent> : null}
                <SemanticContent as="span">{notice.message}</SemanticContent>
                {notice.action ?? null}
              </SemanticContent>
            </Banner>
          </SemanticContent>
        ))}
      </SemanticContent>
    </SemanticContent>
  );
}
