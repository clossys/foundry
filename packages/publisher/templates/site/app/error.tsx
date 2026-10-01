"use client";

import { ERROR_COPY_IDS } from "./site-copy";
import { useSiteCopy } from "./site-copy-context";
import { SiteErrorView } from "./site-error-view";

// The boundary for a failure while rendering a page. The error itself is not
// shown: a visitor needs a way forward, not a stack trace. It sits inside the
// root layout, which provides the copy; a failure in the layout itself is
// outside it (see this template's README).
export default function SiteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const copy = useSiteCopy();
  return <SiteErrorView status={500} copy={copy} ids={ERROR_COPY_IDS.failed} onRetry={reset} />;
}
