import type { MetadataRoute } from "next";
import { siteOrigin, siteTarget } from "./site-records";
import { siteRobots } from "./site-wiring";

// Only `production` may be crawled, and only there is the sitemap named; the
// rule and the origin live in `site-wiring.ts` and `site-records.ts`.
export default function robots(): MetadataRoute.Robots {
  return siteRobots(siteTarget(), siteOrigin());
}
