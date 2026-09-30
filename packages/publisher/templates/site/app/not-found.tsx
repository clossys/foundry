import { ERROR_COPY_IDS, errorCopyIds, requireCopy } from "./site-copy";
import { SiteErrorView } from "./site-error-view";
import { createSiteCopyResolver, siteTarget } from "./site-records";

export default function NotFound() {
  const copy = requireCopy(createSiteCopyResolver(siteTarget()), errorCopyIds());
  return <SiteErrorView status={404} copy={copy} ids={ERROR_COPY_IDS.notFound} />;
}
