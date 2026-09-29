import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OG_SHARE_CARD_SPEC } from "../templates/channelSpecs.js";
import { buildShareCard } from "./shareCard.js";
import { buildSiteMetadata, type SiteMetadata, type SitePageInput, type SitePageKind } from "./siteMetadata.js";
import { SITE_METADATA_REQUIRED_TAGS } from "./siteMetadataLint.js";
import { toNextMetadata, toNextViewport } from "../../templates/site/app/site-metadata.js";

const MODULE_PATH = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "templates", "site", "app", "site-metadata.ts");

const SHARE_CARD = buildShareCard({ name: "Example Studio", tagline: "Small tools, well made", alt: "Example Studio share card" }).shareCard;

function meta(page: Partial<SitePageInput> & { kind: SitePageKind }): SiteMetadata {
  return buildSiteMetadata({
    site: {
      name: "Example Studio",
      tagline: "Small tools, well made",
      origin: "https://example.com",
      themeColor: "#112233",
      locale: "en_US",
      shareCard: SHARE_CARD,
    },
    page: { label: "Pricing", description: "What it costs.", path: "/pricing", ...page },
  });
}

const PAGES: ReadonlyArray<[string, SiteMetadata]> = [
  ["home", meta({ kind: "home", path: "/", label: "Home" })],
  ["contact", meta({ kind: "contact", path: "/contact", label: "Contact" })],
  ["legal draft", meta({ kind: "legal", path: "/terms", label: "Terms", status: "draft" })],
  ["legal counsel-reviewed", meta({ kind: "legal", path: "/privacy", label: "Privacy", status: "counsel-reviewed" })],
  ["notFound", meta({ kind: "notFound", path: "/404", label: "Not found" })],
  ["custom", meta({ kind: "custom", path: "/pricing" })],
];

type Loose = Record<string, unknown>;

function at(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Loose)[part];
  }
  return current;
}

/** For each required tag key: where `buildSiteMetadata` holds its value, and where the Next mapping must put it. */
const MAPPED: Record<string, { from: (m: SiteMetadata) => unknown; to: "metadata" | "viewport"; path: string }> = {
  title: { from: (m) => m.title, to: "metadata", path: "title.absolute" },
  description: { from: (m) => m.description, to: "metadata", path: "description" },
  robots: { from: (m) => m.robots, to: "metadata", path: "robots" },
  "theme-color": { from: (m) => m.themeColor, to: "viewport", path: "themeColor" },
  canonical: { from: (m) => m.canonical, to: "metadata", path: "alternates.canonical" },
  "og:title": { from: (m) => m.openGraph.title, to: "metadata", path: "openGraph.title" },
  "og:description": { from: (m) => m.openGraph.description, to: "metadata", path: "openGraph.description" },
  "og:url": { from: (m) => m.openGraph.url, to: "metadata", path: "openGraph.url" },
  "og:site_name": { from: (m) => m.openGraph.siteName, to: "metadata", path: "openGraph.siteName" },
  "og:type": { from: (m) => m.openGraph.type, to: "metadata", path: "openGraph.type" },
  "og:locale": { from: (m) => m.openGraph.locale, to: "metadata", path: "openGraph.locale" },
  "og:image": { from: (m) => m.openGraph.image.url, to: "metadata", path: "openGraph.images.0.url" },
  "og:image:alt": { from: (m) => m.openGraph.image.alt, to: "metadata", path: "openGraph.images.0.alt" },
  "og:image:width": { from: (m) => m.openGraph.image.width, to: "metadata", path: "openGraph.images.0.width" },
  "og:image:height": { from: (m) => m.openGraph.image.height, to: "metadata", path: "openGraph.images.0.height" },
  "twitter:card": { from: (m) => m.twitter.card, to: "metadata", path: "twitter.card" },
  "twitter:title": { from: (m) => m.twitter.title, to: "metadata", path: "twitter.title" },
  "twitter:description": { from: (m) => m.twitter.description, to: "metadata", path: "twitter.description" },
  "twitter:image": { from: (m) => m.twitter.image, to: "metadata", path: "twitter.images.0.url" },
  "twitter:image:alt": { from: (m) => m.twitter.imageAlt, to: "metadata", path: "twitter.images.0.alt" },
};

function leaves(value: unknown, out: string[] = []): string[] {
  if (value instanceof URL) {
    out.push(value.origin);
  } else if (Array.isArray(value)) {
    for (const item of value) leaves(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) leaves(item, out);
  } else if (value !== undefined) {
    out.push(String(value));
  }
  return out;
}

describe("templates/site/app/site-metadata.ts", () => {
  it("maps every SITE_METADATA_REQUIRED_TAGS key, and the test table has no stale key", () => {
    expect(Object.keys(MAPPED).sort()).toEqual(SITE_METADATA_REQUIRED_TAGS.map((tag) => tag.key).sort());
  });

  it.each(PAGES)("puts every required tag value at its mapped path for a %s page", (_name, source) => {
    const targets = { metadata: toNextMetadata(source) as unknown, viewport: toNextViewport(source) as unknown };
    for (const tag of SITE_METADATA_REQUIRED_TAGS) {
      const mapping = MAPPED[tag.key]!;
      const found = at(targets[mapping.to], mapping.path);
      expect(found, `${tag.key} at ${mapping.to}.${mapping.path}`).toBeDefined();
      expect(String(found), tag.key).toBe(String(mapping.from(source)));
    }
  });

  it.each(PAGES)("carries every field of the buildSiteMetadata output for a %s page", (_name, source) => {
    const emitted = new Set([...leaves(toNextMetadata(source)), ...leaves(toNextViewport(source))]);
    for (const value of leaves(source)) expect(emitted.has(value), value).toBe(true);
  });

  it("maps metadataBase to a URL, the title to absolute, and the image size to the spec", () => {
    const source = PAGES[0]![1];
    const metadata = toNextMetadata(source);
    expect(metadata.metadataBase).toBeInstanceOf(URL);
    expect(metadata.metadataBase?.href).toBe("https://example.com/");
    expect(metadata.title).toEqual({ absolute: source.title });
    const image = (metadata.openGraph as unknown as { images: Array<{ width: number; height: number }> }).images[0]!;
    expect(image.width).toBe(OG_SHARE_CARD_SPEC.widthPx);
    expect(image.height).toBe(OG_SHARE_CARD_SPEC.heightPx);
    expect(metadata.robots).toBe("index, follow");
    expect(toNextMetadata(PAGES[4]![1]).robots).toBe("noindex, nofollow");
  });

  it("is pure: same input, same output, and the input is not mutated", () => {
    const source = PAGES[2]![1];
    const snapshot = JSON.stringify(source);
    expect(toNextMetadata(source)).toEqual(toNextMetadata(source));
    expect(toNextViewport(source)).toEqual(toNextViewport(source));
    expect(JSON.stringify(source)).toBe(snapshot);
    expect(toNextMetadata(source)).not.toBe(toNextMetadata(source));
  });

  it("imports only types from next and @clossys/publisher/web", () => {
    const text = readFileSync(MODULE_PATH, "utf8");
    const imports = [...text.matchAll(/^\s*(import|export)\b[^;]*?from\s+["']([^"']+)["']/gms)];
    expect(imports.length).toBeGreaterThan(0);
    for (const match of imports) {
      expect(match[0], match[0]).toMatch(/^\s*import type\b/);
      expect(["next", "@clossys/publisher/web"]).toContain(match[2]);
    }
    expect(text).not.toMatch(/\brequire\(|\bimport\(|process\.env|\bfetch\(/);
  });
});
