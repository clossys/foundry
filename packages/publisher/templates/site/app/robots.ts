import type { MetadataRoute } from "next";

// Reads the site's own base URL from an environment variable Launcher sets
// at compose time (#1215) rather than hard-coding a domain in this template.
export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.com";
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${base}/sitemap.xml`,
  };
}
