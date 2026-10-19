import { ERROR_COPY_IDS, errorCopyIds, requireCopy, siteFrameCopyIds } from "./site-copy";
import { SiteErrorView } from "./site-error-view";
import { createSiteCopyResolver, loadBrandFacts, siteTarget } from "./site-records";

// The 404 page. It renders inside the root layout (which sets `lang`), and
// reads only the registry and the brand facts: no request, header or cookie.
export default function NotFound() {
  const copy = requireCopy(createSiteCopyResolver(siteTarget()), [...errorCopyIds(), ...siteFrameCopyIds()]);
  const { brandLabel, entity } = loadBrandFacts();
  return <SiteErrorView copy={copy} facts={{ brandLabel, entity }} ids={ERROR_COPY_IDS.notFound} />;
}
