import { describe, expect, it } from "vitest";
import { OG_SHARE_CARD_SPEC } from "../templates/channelSpecs.js";
import {
  SiteMetadataError,
  buildSiteMetadata,
  type SiteIdentityInput,
  type SitePageInput,
  type SitePageKind,
} from "./siteMetadata.js";

const SEP = "·";

function site(overrides: Partial<SiteIdentityInput> = {}): SiteIdentityInput {
  return {
    name: "Example Studio",
    tagline: "Small tools, well made",
    origin: "https://example.com",
    themeColor: "#112233",
    locale: "en_US",
    shareCard: {
      url: "https://example.com/share.png",
      alt: "Example Studio share card",
      width: OG_SHARE_CARD_SPEC.widthPx,
      height: OG_SHARE_CARD_SPEC.heightPx,
    },
    ...overrides,
  };
}

function page(overrides: Partial<SitePageInput> = {}): SitePageInput {
  return { kind: "custom", label: "Pricing", description: "What it costs.", path: "/pricing", ...overrides };
}

function build(s: SiteIdentityInput = site(), p: SitePageInput = page()) {
  return buildSiteMetadata({ site: s, page: p });
}

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof SiteMetadataError) return error.reason;
    throw error;
  }
  return undefined;
}

describe("buildSiteMetadata titles", () => {
  it("builds a home title from name and tagline with U+00B7 and single spaces", () => {
    const meta = build(site(), page({ kind: "home", label: "Home", path: "/" }));
    expect(meta.title).toBe(`Example Studio ${SEP} Small tools, well made`);
    expect(meta.title).toBe("Example Studio · Small tools, well made");
  });

  it("builds a custom title as label then name", () => {
    expect(build().title).toBe("Pricing · Example Studio");
  });

  it.each<[SitePageKind, string]>([
    ["contact", "Contact"],
    ["legal", "Terms"],
    ["notFound", "Page not found"],
    ["custom", "Pricing"],
  ])("builds a %s title as label then name", (kind, label) => {
    const meta = build(site(), page({ kind, label }));
    expect(meta.title).toBe(`${label} ${SEP} Example Studio`);
  });

  it("outputs values verbatim without trimming", () => {
    const meta = build(site({ name: "Example  Studio" }), page({ label: "A  B" }));
    expect(meta.title).toBe(`A  B ${SEP} Example  Studio`);
  });
});

describe("buildSiteMetadata fields", () => {
  it("mirrors title, description, url and site name into Open Graph", () => {
    const meta = build();
    expect(meta.description).toBe("What it costs.");
    expect(meta.canonical).toBe("https://example.com/pricing");
    expect(meta.metadataBase).toBe("https://example.com");
    expect(meta.themeColor).toBe("#112233");
    expect(meta.locale).toBe("en_US");
    expect(meta.openGraph.url).toBe(meta.canonical);
    expect(meta.openGraph.title).toBe(meta.title);
    expect(meta.openGraph.description).toBe(meta.description);
    expect(meta.openGraph.siteName).toBe("Example Studio");
    expect(meta.openGraph.type).toBe("website");
    expect(meta.openGraph.locale).toBe("en_US");
    expect(meta.openGraph.image).toEqual({
      url: "https://example.com/share.png",
      alt: "Example Studio share card",
      width: 1200,
      height: 630,
    });
  });

  it("mirrors title, description and the share card into Twitter", () => {
    const meta = build();
    expect(meta.twitter).toEqual({
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      image: "https://example.com/share.png",
      imageAlt: "Example Studio share card",
    });
  });

  it("resolves a root-relative share card against the origin", () => {
    const meta = build(site({ shareCard: { url: "/og/share.png", alt: "Card", width: 1200, height: 630 } }));
    expect(meta.openGraph.image.url).toBe("https://example.com/og/share.png");
    expect(meta.twitter.image).toBe("https://example.com/og/share.png");
  });

  it("keeps an absolute share card url as given", () => {
    const meta = build(site({ shareCard: { url: "http://cdn.example.net/a.png", alt: "Card", width: 1200, height: 630 } }));
    expect(meta.openGraph.image.url).toBe("http://cdn.example.net/a.png");
  });

  it("supports an origin with a port", () => {
    const meta = build(site({ origin: "http://localhost:3000" }), page({ path: "/x" }));
    expect(meta.canonical).toBe("http://localhost:3000/x");
    expect(meta.metadataBase).toBe("http://localhost:3000");
  });
});

describe("buildSiteMetadata robots", () => {
  it("marks notFound noindex", () => {
    expect(build(site(), page({ kind: "notFound", label: "Not found", path: "/404" })).robots).toBe("noindex, nofollow");
  });

  it("marks a draft legal page noindex", () => {
    expect(build(site(), page({ kind: "legal", label: "Terms", path: "/terms", status: "draft" })).robots).toBe("noindex, nofollow");
  });

  it("treats a legal page with no status as a draft", () => {
    expect(build(site(), page({ kind: "legal", label: "Terms", path: "/terms" })).robots).toBe("noindex, nofollow");
  });

  it("marks a counsel-reviewed legal page indexable", () => {
    expect(build(site(), page({ kind: "legal", label: "Terms", path: "/terms", status: "counsel-reviewed" })).robots).toBe("index, follow");
  });

  it.each<SitePageKind>(["home", "contact", "custom"])("marks %s indexable", (kind) => {
    expect(build(site(), page({ kind })).robots).toBe("index, follow");
  });
});

describe("buildSiteMetadata refusals", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "x"],
    ["a number", 7],
    ["an array", []],
  ])("refuses %s as the whole input", (_label, value) => {
    expect(reasonOf(() => buildSiteMetadata(value as never))).toBe("invalid-input");
  });

  it("refuses a missing site or page", () => {
    expect(reasonOf(() => buildSiteMetadata({ site: site() } as never))).toBe("invalid-input");
    expect(reasonOf(() => buildSiteMetadata({ page: page() } as never))).toBe("invalid-input");
  });

  it.each(["name", "tagline", "themeColor", "locale"] as const)("refuses a blank site %s", (key) => {
    expect(reasonOf(() => build(site({ [key]: "   " })))).toBe("invalid-input");
    expect(reasonOf(() => build(site({ [key]: "" })))).toBe("invalid-input");
    expect(reasonOf(() => build(site({ [key]: 5 as never })))).toBe("invalid-input");
  });

  it.each(["label", "description"] as const)("refuses a blank page %s", (key) => {
    expect(reasonOf(() => build(site(), page({ [key]: " \t" })))).toBe("invalid-input");
    expect(reasonOf(() => build(site(), page({ [key]: undefined as never })))).toBe("invalid-input");
  });

  it.each(["Acme ", " Acme", "Ac\nme", "Ac\r\nme", "Ac\u2028me", "\tAcme", "Acme\n"])("refuses the name, tagline or label %j", (text) => {
    expect(reasonOf(() => build(site({ name: text })))).toBe("invalid-input");
    expect(reasonOf(() => build(site({ tagline: text })))).toBe("invalid-input");
    expect(reasonOf(() => build(site(), page({ label: text })))).toBe("invalid-input");
  });

  it("keeps a name, tagline and label with single inner spaces", () => {
    const meta = build(site({ name: "Acme Tools", tagline: "Fast, small" }), page({ label: "Our prices" }));
    expect(meta.title).toBe(`Our prices ${SEP} Acme Tools`);
  });

  it("refuses a blank share card alt", () => {
    expect(reasonOf(() => build(site({ shareCard: { url: "/a.png", alt: " ", width: 1200, height: 630 } })))).toBe("invalid-input");
  });

  it.each([
    ["trailing slash", "https://example.com/"],
    ["a path", "https://example.com/app"],
    ["a query", "https://example.com?x=1"],
    ["a hash", "https://example.com#top"],
    ["credentials", "https://user:pw@example.com"],
    ["no scheme", "example.com"],
    ["a non-http scheme", "ftp://example.com"],
    ["a blank string", ""],
    ["uppercase host that normalizes", "https://EXAMPLE.com"],
    ["a default port that normalizes", "https://example.com:443"],
  ])("refuses an origin with %s", (_label, origin) => {
    expect(reasonOf(() => build(site({ origin })))).toBe("invalid-origin");
  });

  it("refuses a non-string origin", () => {
    expect(reasonOf(() => build(site({ origin: undefined as never })))).toBe("invalid-origin");
  });

  it.each([
    "pricing",
    "//x",
    "",
    "/a?b=1",
    "/a#b",
    "/a b",
    "/a\tb",
    "/a/../b",
    "/..",
    "/a/..",
    "https://example.com/a",
    "/a//b",
    "/a/./b",
    "/a/%2e%2e/b",
    "/a/%2E%2E/b",
    "/a/.",
    "/a//",
    "//",
    "/é",
  ])("refuses the path %j", (path) => {
    expect(reasonOf(() => build(site(), page({ path })))).toBe("invalid-path");
  });

  it("refuses a non-string path", () => {
    expect(reasonOf(() => build(site(), page({ path: 3 as never })))).toBe("invalid-path");
  });

  it("accepts a trailing slash and an encoded segment that stays put", () => {
    expect(build(site(), page({ path: "/a/b/" })).canonical).toBe("https://example.com/a/b/");
    expect(build(site(), page({ path: "/a%20b" })).canonical).toBe("https://example.com/a%20b");
  });

  it("accepts the root path and a nested path", () => {
    expect(build(site(), page({ kind: "home", path: "/" })).canonical).toBe("https://example.com/");
    expect(build(site(), page({ path: "/a/b-c/d" })).canonical).toBe("https://example.com/a/b-c/d");
  });

  it("refuses an unknown page kind", () => {
    expect(reasonOf(() => build(site(), page({ kind: "blog" as never })))).toBe("invalid-kind");
    expect(reasonOf(() => build(site(), page({ kind: undefined as never })))).toBe("invalid-kind");
  });

  it("refuses a status on a non-legal kind", () => {
    for (const kind of ["home", "contact", "notFound", "custom"] as const) {
      expect(reasonOf(() => build(site(), page({ kind, status: "counsel-reviewed" })))).toBe("invalid-status");
      expect(reasonOf(() => build(site(), page({ kind, status: "draft" })))).toBe("invalid-status");
    }
  });

  it("refuses an unknown status on a legal page", () => {
    expect(reasonOf(() => build(site(), page({ kind: "legal", status: "approved" as never })))).toBe("invalid-status");
    expect(reasonOf(() => build(site(), page({ kind: "legal", status: null as never })))).toBe("invalid-status");
  });

  it.each([
    ["1200x600", 1200, 600],
    ["630x1200 swapped", 630, 1200],
    ["zero width", 0, 630],
    ["zero height", 1200, 0],
    ["fractional width", 1200.5, 630],
    ["NaN", Number.NaN, 630],
    ["Infinity", Number.POSITIVE_INFINITY, 630],
    ["string width", "1200" as unknown as number, 630],
    ["string height", 1200, "630" as unknown as number],
    ["negative", -1200, -630],
    ["1x", 600, 315],
  ])("refuses a share card sized %s", (_label, width, height) => {
    expect(reasonOf(() => build(site({ shareCard: { url: "/a.png", alt: "Card", width, height } })))).toBe("share-card-size");
  });

  it.each([
    "share.png",
    "//cdn.example.net/a.png",
    "ftp://example.com/a.png",
    "",
    "data:image/png;base64,AAAA",
    "/a b.png",
    "https:foo.png",
    "https:/foo.png",
    "https://EXAMPLE.com/a.png",
    "https://example.com:443/a.png",
    "https://example.com/a/../b.png",
    "https://example.com",
    "/a/%2e%2e/b.png",
    "/a/./b.png",
  ])("refuses the share card url %j", (url) => {
    expect(reasonOf(() => build(site({ shareCard: { url, alt: "Card", width: 1200, height: 630 } })))).toBe("invalid-share-card");
  });

  it("refuses a missing share card", () => {
    expect(reasonOf(() => build(site({ shareCard: undefined as never })))).toBe("invalid-share-card");
    expect(reasonOf(() => build(site({ shareCard: null as never })))).toBe("invalid-share-card");
  });

  it("throws a SiteMetadataError that is an Error and names its reason", () => {
    let caught: unknown;
    try {
      build(site({ origin: "nope" }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SiteMetadataError);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as SiteMetadataError).name).toBe("SiteMetadataError");
    expect((caught as SiteMetadataError).reason).toBe("invalid-origin");
    expect((caught as SiteMetadataError).message.length).toBeGreaterThan(0);
  });
});

describe("buildSiteMetadata determinism", () => {
  it("returns deep-equal output for the same input and fresh objects each call", () => {
    const input = { site: site(), page: page() };
    const a = buildSiteMetadata(input);
    const b = buildSiteMetadata(input);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.openGraph).not.toBe(b.openGraph);
    expect(a.openGraph.image).not.toBe(b.openGraph.image);
    expect(a.twitter).not.toBe(b.twitter);
  });

  it("does not mutate its input and does not alias the share card object", () => {
    const input = { site: site(), page: page({ kind: "legal", status: "counsel-reviewed" }) };
    const snapshot = structuredClone(input);
    const out = buildSiteMetadata(input);
    expect(input).toEqual(snapshot);
    expect(out.openGraph.image).not.toBe(input.site.shareCard);
  });

  it("yields the same complete key set for every page kind with no undefined values", () => {
    const kinds: SitePageKind[] = ["home", "contact", "legal", "notFound", "custom"];
    const shapes = kinds.map((kind) => {
      const meta = build(site(), page({ kind, path: kind === "home" ? "/" : `/${kind}` }));
      const walk = (value: unknown, prefix: string): string[] => {
        if (value !== null && typeof value === "object") {
          return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
            expect(child).not.toBeUndefined();
            return walk(child, `${prefix}.${key}`);
          });
        }
        return [prefix];
      };
      return walk(meta, "").sort();
    });
    for (const shape of shapes) expect(shape).toEqual(shapes[0]);
    expect(shapes[0]).toEqual(
      [
        ".title",
        ".description",
        ".canonical",
        ".robots",
        ".themeColor",
        ".metadataBase",
        ".locale",
        ".openGraph.title",
        ".openGraph.description",
        ".openGraph.url",
        ".openGraph.siteName",
        ".openGraph.type",
        ".openGraph.locale",
        ".openGraph.image.url",
        ".openGraph.image.alt",
        ".openGraph.image.width",
        ".openGraph.image.height",
        ".twitter.card",
        ".twitter.title",
        ".twitter.description",
        ".twitter.image",
        ".twitter.imageAlt",
      ].sort(),
    );
  });
});
