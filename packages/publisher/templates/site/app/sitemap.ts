import type { MetadataRoute } from "next";

const ROUTES = ["/", "/about", "/contact", "/privacy", "/terms"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.com";
  return ROUTES.map((path) => ({ url: `${base}${path}`, lastModified: new Date() }));
}
