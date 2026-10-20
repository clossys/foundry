"use client";

import { ERROR_COPY_IDS } from "./site-copy";
import { useSiteCopy, useSiteFrameFacts } from "./site-copy-context";
import { SiteErrorView } from "./site-error-view";

// The boundary for a failure while rendering a page. The error itself is not
// shown: a visitor needs a way forward, not a stack trace. It sits inside the
// root layout, which provides the copy and the brand facts; a failure in the
// layout itself is outside it (see this template's README).
export default function SiteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <SiteErrorView copy={useSiteCopy()} facts={useSiteFrameFacts()} ids={ERROR_COPY_IDS.failed} onRetry={reset} />;
}
