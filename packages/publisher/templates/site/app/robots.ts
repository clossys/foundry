import type { MetadataRoute } from "next";
import { siteCrawlTarget, siteOrigin } from "./site-records";
import { siteRobots } from "./site-wiring";

// Only an explicit `SITE_TARGET=production` may be crawled, and only there is
// the sitemap named; the rule and the origin live in `site-wiring.ts` and
// `site-records.ts`.
export default function robots(): MetadataRoute.Robots {
  return siteRobots(siteCrawlTarget(), siteOrigin());
}
