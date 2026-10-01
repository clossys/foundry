import type { MetadataRoute } from "next";
import manifest from "../web-route-manifest.json" with { type: "json" };
import { loadLegalSitemapStates, siteCrawlTarget, siteOrigin } from "./site-records";
import { siteSitemap } from "./site-wiring";

// The routes are the manifest's, so a route added there is listed here and a
// route that is not in it never is. A legal route is listed only once its
// document is counsel-reviewed, with that document's own last-updated date.
export default function sitemap(): MetadataRoute.Sitemap {
  return siteSitemap({
    target: siteCrawlTarget(),
    origin: siteOrigin(),
    routes: manifest.routes,
    legal: loadLegalSitemapStates(),
  });
}
