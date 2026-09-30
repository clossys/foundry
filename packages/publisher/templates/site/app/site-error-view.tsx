"use client";

import { ErrorView } from "@clossys/publisher/web";
import { siteText } from "./site-copy";
import type { SiteCopyMap, SiteErrorCopyIds } from "./site-copy";

export interface SiteErrorViewProps {
  status: number;
  /** Resolved copy, holding every id in `ids`. */
  copy: SiteCopyMap;
  ids: SiteErrorCopyIds;
  /** When given, the action retries; otherwise it returns to the home page. */
  onRetry?: () => void;
}

/**
 * The site's full-page error state. Every visible word is read from `copy` by
 * id: the title, the description and the recovery action.
 */
export function SiteErrorView({ status, copy, ids, onRetry }: SiteErrorViewProps) {
  const actionLabel = siteText(copy, ids.action);
  return (
    <ErrorView
      status={status}
      title={siteText(copy, ids.title)}
      description={siteText(copy, ids.description)}
      action={
        onRetry === undefined ? (
          <a href="/">{actionLabel}</a>
        ) : (
          <button type="button" onClick={onRetry}>
            {actionLabel}
          </button>
        )
      }
    />
  );
}
