import type { ContentMap, ContentMapNode } from "./contract.js";
import { checkedContentMap, contentMapOrigin, contentMapPath } from "./check.js";

export interface ContentMapRobotsOptions {
  readonly origin: string;
  /** Explicit crawler permission. This is independent of page indexing metadata. */
  readonly crawl: "allow" | "disallow";
}

/** Framework-neutral data assignable to a Next MetadataRoute.Robots record. */
export interface ContentMapRobots {
  readonly rules: { readonly userAgent: "*"; readonly allow: string[]; readonly disallow: string[] };
  readonly sitemap: string;
}

/** Projects advisory crawler rules for local map pages. An allow list does not
 * deny unmapped URLs, and robots rules are not access control. A noindex page
 * stays crawlable so its indexing metadata can be read; noindex is not a
 * robots disallow instruction. External destinations never become local rules. */
export function projectRobots(map: ContentMap, options: ContentMapRobotsOptions): ContentMapRobots {
  checkedContentMap(map);
  if (map.format !== "web.page.responsive") throw new TypeError("Robots projection requires a web.page.responsive map");
  const origin = contentMapOrigin(options.origin);
  if (options.crawl !== "allow" && options.crawl !== "disallow") throw new TypeError("An explicit allow or disallow crawl permission is required");
  const ordered = (parentId?: string): ContentMapNode[] => map.entries
    .filter(entry => entry.parentId === parentId)
    .slice().sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .flatMap(entry => [entry, ...ordered(entry.id)]);
  const allow = options.crawl === "allow" ? ordered().filter(entry => entry.kind === "page").map(entry => {
    // Percent-encode robots pattern metacharacters when they are literal path bytes.
    return contentMapPath(entry).replace(/\*/g, "%2A").replace(/\$/g, "%24");
  }) : [];
  return { rules: { userAgent: "*", allow, disallow: options.crawl === "disallow" ? ["/"] : [] }, sitemap: new URL("/sitemap.xml", origin).href };
}
