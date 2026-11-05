"use client";

import { buttonLinkClassName } from "@clossys/designer/components";
import { SiteFrame, StatusView } from "@clossys/publisher/web";
import { siteText } from "./site-copy";
import type { SiteCopyMap, SiteErrorCopyIds } from "./site-copy";
import { siteFrameInput } from "./site-frame";
import type { SiteFrameFacts } from "./site-frame";

export interface SiteErrorViewProps {
  /** Resolved copy, holding every id in `ids` and every id `siteFrameCopyIds()` lists. */
  copy: SiteCopyMap;
  /** The banner's name and the legal row's entity, from the brand-facts record. */
  facts: SiteFrameFacts;
  ids: SiteErrorCopyIds;
  /** When given, the action retries; otherwise it returns to the home page. */
  onRetry?: () => void;
}

const PRIMARY_ACTION = buttonLinkClassName("primary", "md");

/**
 * The site's error page: `SiteFrame` (skip link, banner, the page's one
 * `<main>`, contentinfo) around `StatusView`. Every visible word is read from
 * `copy` by id: the title is the page's one `<h1>`, the description its one
 * line, and the recovery action its one primary action.
 */
export function SiteErrorView({ copy, facts, ids, onRetry }: SiteErrorViewProps) {
  const actionLabel = siteText(copy, ids.action);
  return (
    <SiteFrame {...siteFrameInput(copy, facts)}>
      <StatusView
        status={siteText(copy, ids.title)}
        subtitle={siteText(copy, ids.description)}
        action={
          onRetry === undefined ? (
            <a href="/" className={PRIMARY_ACTION}>
              {actionLabel}
            </a>
          ) : (
            <button type="button" className={PRIMARY_ACTION} onClick={onRetry}>
              {actionLabel}
            </button>
          )
        }
      />
    </SiteFrame>
  );
}
