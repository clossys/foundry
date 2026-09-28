import { describe, expect, it } from "vitest";
import { OG_SHARE_CARD_SPEC } from "../templates/channelSpecs.js";
import { buildSiteMetadata, type SiteMetadata } from "./siteMetadata.js";
import { SITE_METADATA_REQUIRED_TAGS, lintSiteMetadataHtml } from "./siteMetadataLint.js";

// ---------------------------------------------------------------------------
// Test-local serializer. The package deliberately ships no public HTML
// serializer for SiteMetadata; this one exists only to build fixtures.
// ---------------------------------------------------------------------------

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

interface Part {
  key: string;
  render: (value: string, raw?: boolean) => string;
  value: string;
}

function parts(meta: SiteMetadata): Part[] {
  const metaName = (key: string, value: string): Part => ({
    key,
    value,
    render: (v, raw = false) => `<meta name="${key}" content="${raw ? v : esc(v)}">`,
  });
  const metaProp = (key: string, value: string): Part => ({
    key,
    value,
    render: (v, raw = false) => `<meta property="${key}" content="${raw ? v : esc(v)}">`,
  });
  return [
    { key: "title", value: meta.title, render: (v, raw = false) => `<title>${raw ? v : esc(v)}</title>` },
    metaName("description", meta.description),
    metaName("robots", meta.robots),
    metaName("theme-color", meta.themeColor),
    { key: "canonical", value: meta.canonical, render: (v, raw = false) => `<link rel="canonical" href="${raw ? v : esc(v)}">` },
    metaProp("og:title", meta.openGraph.title),
    metaProp("og:description", meta.openGraph.description),
    metaProp("og:url", meta.openGraph.url),
    metaProp("og:site_name", meta.openGraph.siteName),
    metaProp("og:type", meta.openGraph.type),
    metaProp("og:locale", meta.openGraph.locale),
    metaProp("og:image", meta.openGraph.image.url),
    metaProp("og:image:alt", meta.openGraph.image.alt),
    metaProp("og:image:width", String(meta.openGraph.image.width)),
    metaProp("og:image:height", String(meta.openGraph.image.height)),
    metaName("twitter:card", meta.twitter.card),
    metaName("twitter:title", meta.twitter.title),
    metaName("twitter:description", meta.twitter.description),
    metaName("twitter:image", meta.twitter.image),
    metaName("twitter:image:alt", meta.twitter.imageAlt),
  ];
}

const META = buildSiteMetadata({
  site: {
    name: "Example Studio",
    tagline: "Small tools, well made",
    origin: "https://example.com",
    themeColor: "#112233",
    locale: "en_US",
    shareCard: {
      url: "/share.png",
      alt: "Example Studio share card",
      width: OG_SHARE_CARD_SPEC.widthPx,
      height: OG_SHARE_CARD_SPEC.heightPx,
    },
  },
  page: { kind: "custom", label: "Pricing", description: "What it costs & why.", path: "/pricing" },
});

interface HeadOptions {
  /** key -> replacement value; `null` removes the tag. */
  override?: Record<string, string | null>;
  /** keys rendered twice. */
  duplicate?: string[];
  /** raw markup appended inside the head after the tags. */
  extraHead?: string;
  /** raw markup placed before the head. */
  beforeHead?: string;
}

function headHtml(options: HeadOptions = {}): string {
  const override = options.override ?? {};
  const duplicate = new Set(options.duplicate ?? []);
  const body = parts(META)
    .map((part) => {
      const value = override[part.key];
      if (value === null) return "";
      const html = part.render(value ?? part.value);
      return duplicate.has(part.key) ? html + html : html;
    })
    .join("");
  return `<meta charset="utf-8"><meta name="viewport" content="width=device-width">${body}${options.extraHead ?? ""}`;
}

/** A document that ends exactly at `</head>`, so every proper prefix is cut inside or before the head. */
function fixture(options: HeadOptions = {}): string {
  return `<!doctype html>${options.beforeHead ?? ""}<html lang="en"><head>${headHtml(options)}</head>`;
}

function fullDocument(options: HeadOptions = {}): string {
  return `${fixture(options)}<body><h1>Hello</h1></body></html>`;
}

function rulesAndTags(html: unknown): Array<[string, string]> {
  return lintSiteMetadataHtml(html).findings.map((finding) => [finding.rule, finding.tag]);
}

describe("SITE_METADATA_REQUIRED_TAGS", () => {
  it("declares the required set by key and selector", () => {
    expect(SITE_METADATA_REQUIRED_TAGS.map((entry) => `${entry.selector}:${entry.key}`)).toEqual([
      "title:title",
      "meta-name:description",
      "meta-name:robots",
      "meta-name:theme-color",
      "link-rel:canonical",
      "meta-property:og:title",
      "meta-property:og:description",
      "meta-property:og:url",
      "meta-property:og:site_name",
      "meta-property:og:type",
      "meta-property:og:locale",
      "meta-property:og:image",
      "meta-property:og:image:alt",
      "meta-property:og:image:width",
      "meta-property:og:image:height",
      "meta-name:twitter:card",
      "meta-name:twitter:title",
      "meta-name:twitter:description",
      "meta-name:twitter:image",
      "meta-name:twitter:image:alt",
    ]);
  });

  it("names the value attribute for meta and link entries and omits it for title", () => {
    for (const entry of SITE_METADATA_REQUIRED_TAGS) {
      if (entry.selector === "title") expect(entry.attr).toBeUndefined();
      else if (entry.selector === "link-rel") expect(entry.attr).toBe("href");
      else expect(entry.attr).toBe("content");
    }
  });

  it("has keys unique within the set", () => {
    const keys = SITE_METADATA_REQUIRED_TAGS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("matches the head set built by buildSiteMetadata's serializer fixture", () => {
    expect(parts(META).map((part) => part.key)).toEqual(SITE_METADATA_REQUIRED_TAGS.map((entry) => entry.key));
  });
});

describe("lintSiteMetadataHtml complete heads", () => {
  it("passes a complete head built from buildSiteMetadata output", () => {
    expect(lintSiteMetadataHtml(fixture())).toEqual({ complete: true, findings: [] });
  });

  it("passes the same head inside a full document with a body", () => {
    expect(lintSiteMetadataHtml(fullDocument())).toEqual({ complete: true, findings: [] });
  });

  it("returns a fresh result object each call", () => {
    const html = fixture();
    const a = lintSiteMetadataHtml(html);
    const b = lintSiteMetadataHtml(html);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a.findings).not.toBe(b.findings);
  });

  it("accepts single-quoted, unquoted, and upper-case attribute forms", () => {
    const html = fixture({
      override: { description: null, robots: null, "twitter:card": null, canonical: null },
      extraHead:
        `<meta name='description' content='single'>` +
        `<META NAME=robots CONTENT=index>` +
        `<meta name="Twitter:Card" content="summary_large_image">` +
        `<LINK REL="Canonical" HREF="https://example.com/x">`,
    });
    expect(lintSiteMetadataHtml(html)).toEqual({ complete: true, findings: [] });
  });

  it("accepts a link rel token list that includes canonical", () => {
    const html = fixture({
      override: { canonical: null },
      extraHead: `<link rel="canonical nofollow" href="https://example.com/x">`,
    });
    expect(lintSiteMetadataHtml(html).complete).toBe(true);
  });

  it("accepts a title with embedded markup-like text as raw text", () => {
    const html = fixture({ override: { title: null }, extraHead: `<title>A <b> and <meta name="robots"></title>` });
    // the robots tag inside the title text is not counted; the real one is still present once.
    expect(lintSiteMetadataHtml(html)).toEqual({ complete: true, findings: [] });
  });

  it("treats a value that decodes to text as non-empty", () => {
    const html = fixture({ override: { description: null }, extraHead: `<meta name="description" content="&amp;">` });
    expect(lintSiteMetadataHtml(html).complete).toBe(true);
  });
});

describe("lintSiteMetadataHtml missing tags", () => {
  it.each(SITE_METADATA_REQUIRED_TAGS.map((entry) => [entry.key] as const))("flags a deleted %s as missing and only that", (key) => {
    const result = lintSiteMetadataHtml(fixture({ override: { [key]: null } }));
    expect(result.complete).toBe(false);
    expect(result.findings).toEqual([{ rule: "missing", tag: key, message: expect.any(String) }]);
    expect(result.findings[0]?.message.length).toBeGreaterThan(0);
  });

  it("does not read og:* tags from name or non-og tags from property", () => {
    const html = fixture({
      override: { "og:title": null, description: null },
      extraHead: `<meta name="og:title" content="x"><meta property="description" content="y">`,
    });
    expect(rulesAndTags(html)).toEqual([
      ["missing", "description"],
      ["missing", "og:title"],
    ]);
  });

  it("does not let entity decoding change tag identity", () => {
    const html = fixture({ override: { robots: null }, extraHead: `<meta name="rob&#111;ts" content="x">` });
    expect(rulesAndTags(html)).toEqual([["missing", "robots"]]);
  });

  it("does not count a link without rel=canonical", () => {
    const html = fixture({ override: { canonical: null }, extraHead: `<link rel="alternate" href="https://example.com/x">` });
    expect(rulesAndTags(html)).toEqual([["missing", "canonical"]]);
  });
});

describe("lintSiteMetadataHtml empty values", () => {
  const blanks = ["", "   ", "\n\t", "&#32;", "&#x20;&#160;"];

  it.each(SITE_METADATA_REQUIRED_TAGS.map((entry) => [entry.key] as const))("flags a blank %s as empty and only that", (key) => {
    for (const blank of blanks) {
      const part = parts(META).find((candidate) => candidate.key === key)!;
      const rawHtml = part.render(blank, true);
      const html = fixture({ override: { [key]: null }, extraHead: rawHtml });
      const result = lintSiteMetadataHtml(html);
      expect(result.complete).toBe(false);
      expect(result.findings.map((finding) => [finding.rule, finding.tag])).toEqual([["empty", key]]);
    }
  });

  it("flags a meta with no content attribute and a canonical with no href as empty", () => {
    const html = fixture({
      override: { description: null, canonical: null },
      extraHead: `<meta name="description"><link rel="canonical">`,
    });
    expect(rulesAndTags(html)).toEqual([
      ["empty", "description"],
      ["empty", "canonical"],
    ]);
  });
});

describe("lintSiteMetadataHtml duplicates", () => {
  it.each(SITE_METADATA_REQUIRED_TAGS.map((entry) => [entry.key] as const))("flags a duplicated %s once", (key) => {
    const result = lintSiteMetadataHtml(fixture({ duplicate: [key] }));
    expect(result.complete).toBe(false);
    expect(result.findings.map((finding) => [finding.rule, finding.tag])).toEqual([["duplicate", key]]);
  });

  it("flags one duplicate finding even when a tag appears three times", () => {
    const html = fixture({ extraHead: `<meta name="robots" content="a"><meta name="robots" content="b">` });
    expect(rulesAndTags(html)).toEqual([["duplicate", "robots"]]);
  });

  it("reports both empty and duplicate when a duplicated tag has a blank copy", () => {
    const html = fixture({ extraHead: `<meta name="robots" content=" ">` });
    expect(rulesAndTags(html)).toEqual([
      ["empty", "robots"],
      ["duplicate", "robots"],
    ]);
  });
});

describe("lintSiteMetadataHtml reports every problem in one pass", () => {
  it("lists missing, empty, and duplicate findings together in declared order", () => {
    const html = fixture({
      override: { robots: null, description: "" },
      duplicate: ["og:title", "twitter:card"],
    });
    const result = lintSiteMetadataHtml(html);
    expect(result.complete).toBe(false);
    expect(result.findings.map((finding) => [finding.rule, finding.tag])).toEqual([
      ["empty", "description"],
      ["missing", "robots"],
      ["duplicate", "og:title"],
      ["duplicate", "twitter:card"],
    ]);
  });

  it("reports every tag missing for a head that has none of the set", () => {
    const result = lintSiteMetadataHtml("<html><head><meta charset=utf-8></head></html>");
    expect(result.complete).toBe(false);
    expect(result.findings).toHaveLength(SITE_METADATA_REQUIRED_TAGS.length);
    expect(result.findings.every((finding) => finding.rule === "missing")).toBe(true);
  });
});

describe("lintSiteMetadataHtml regions that do not count", () => {
  const robots = `<meta name="robots" content="index, follow">`;

  it("does not count a tag inside an HTML comment", () => {
    const html = fixture({ override: { robots: null }, extraHead: `<!-- ${robots} -->` });
    expect(rulesAndTags(html)).toEqual([["missing", "robots"]]);
  });

  it("does not count a tag inside a script", () => {
    const html = fixture({ override: { robots: null }, extraHead: `<script>document.write('${robots}')</script>` });
    expect(rulesAndTags(html)).toEqual([["missing", "robots"]]);
  });

  it("does not count a tag inside a style or textarea", () => {
    const html = fixture({
      override: { robots: null },
      extraHead: `<style>/* ${robots} */</style><textarea>${robots}</textarea>`,
    });
    expect(rulesAndTags(html)).toEqual([["missing", "robots"]]);
  });

  it("does not count a tag inside noscript or template", () => {
    const html = fixture({
      override: { robots: null },
      extraHead: `<noscript>${robots}</noscript><template>${robots}</template>`,
    });
    expect(rulesAndTags(html)).toEqual([["missing", "robots"]]);
  });

  it("does not count a duplicate that sits only inside noscript", () => {
    const html = fixture({ extraHead: `<noscript>${robots}</noscript>` });
    expect(lintSiteMetadataHtml(html)).toEqual({ complete: true, findings: [] });
  });

  it("does not count a tag in the body", () => {
    const html = `${fixture({ override: { robots: null } })}<body>${robots}</body></html>`;
    expect(rulesAndTags(html)).toEqual([["missing", "robots"]]);
  });

  it("does not add a body duplicate to a tag already in the head", () => {
    const html = `${fixture()}<body>${robots}</body></html>`;
    expect(lintSiteMetadataHtml(html)).toEqual({ complete: true, findings: [] });
  });

  it("does not let </head> inside a script or comment close the head early", () => {
    const html = fixture({ extraHead: `<script>var s = "</head>";</script><!-- </head> -->` });
    expect(lintSiteMetadataHtml(html)).toEqual({ complete: true, findings: [] });
  });

  it("does not treat a <head> inside a comment as the head or a second head", () => {
    const html = fixture({ beforeHead: `<!-- <head></head> -->` });
    expect(lintSiteMetadataHtml(html)).toEqual({ complete: true, findings: [] });
  });

  it("does not confuse <header> with <head>", () => {
    const html = `${fixture()}<body><header>Hi</header></body></html>`;
    expect(lintSiteMetadataHtml(html)).toEqual({ complete: true, findings: [] });
  });
});

describe("lintSiteMetadataHtml unreadable input", () => {
  const cases: Array<[string, unknown]> = [
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["an object", { html: "<head></head>" }],
    ["an array", ["<head></head>"]],
    ["an empty string", ""],
    ["a blank string", "   "],
    ["markup with no head", "<html><body><p>hi</p></body></html>"],
    ["an unterminated head", `<html><head>${headHtml()}`],
    ["an unterminated comment in the head", `<html><head>${headHtml()}<!-- never closed`],
    ["an unterminated comment before the head", `<html><!-- never closed <head>${headHtml()}</head>`],
    ["an unterminated tag", `<html><head>${headHtml()}<meta name="robots" content="x"`],
    ["an unterminated attribute quote", `<html><head>${headHtml()}<meta name="robots" content="x></head>`],
    ["two head elements", `<html><head>${headHtml()}</head><head></head></html>`],
    ["two head open tags", `<html><head>${headHtml()}<head></head></html>`],
    ["an unterminated title", `<html><head>${headHtml({ override: { title: null } })}<title>abc</head>`],
    ["an unterminated script", `<html><head>${headHtml()}<script>var x = 1;</head>`],
    ["an unterminated style", `<html><head>${headHtml()}<style>a{}</head>`],
    ["an unterminated textarea", `<html><head>${headHtml()}<textarea>x</head>`],
    ["a body opened inside an unclosed head", `<html><head>${headHtml()}<body>${headHtml()}</head>`],
  ];

  it.each(cases)("reports %s as unreadable and incomplete", (_label, input) => {
    const result = lintSiteMetadataHtml(input);
    expect(result.complete).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings.every((finding) => finding.rule === "unreadable")).toBe(true);
    for (const finding of result.findings) {
      expect(finding.tag.length).toBeGreaterThan(0);
      expect(finding.message.length).toBeGreaterThan(0);
    }
  });

  it("does not add missing-tag findings when the head cannot be read", () => {
    const result = lintSiteMetadataHtml(`<html><head><meta name="robots" content="x"`);
    expect(result.findings.map((finding) => finding.rule)).toEqual(["unreadable"]);
  });

  it("does not report an unterminated comment after the head as a finding", () => {
    expect(lintSiteMetadataHtml(`${fixture()}<body><!-- trailing`)).toEqual({ complete: true, findings: [] });
  });
});

describe("lintSiteMetadataHtml fuzz-style properties", () => {
  it("never reports complete:true for any proper prefix of a complete head", () => {
    const html = fixture();
    expect(lintSiteMetadataHtml(html).complete).toBe(true);
    for (let cut = 0; cut < html.length; cut += 1) {
      const result = lintSiteMetadataHtml(html.slice(0, cut));
      expect(result.complete, `prefix cut at ${cut}: ${JSON.stringify(html.slice(Math.max(0, cut - 20), cut))}`).toBe(false);
      expect(result.findings.length).toBeGreaterThan(0);
    }
  });

  it("never reports complete:true for any suffix that drops the opening of the head", () => {
    const html = fixture();
    const headStart = html.indexOf("<head>");
    for (let cut = headStart + 1; cut < html.indexOf("</head>"); cut += 7) {
      expect(lintSiteMetadataHtml(html.slice(cut)).complete).toBe(false);
    }
  });

  it("returns a well-formed result and does not throw for arbitrary input", () => {
    const inputs: unknown[] = [
      null,
      undefined,
      {},
      [],
      0,
      Number.NaN,
      true,
      () => "<head></head>",
      Object.create(null),
      Symbol("x"),
      10n,
      "\0",
      "<",
      "<<<<",
      "<!",
      "<!--",
      "<!-->",
      "<!--->",
      "<head",
      "<head>",
      "</head>",
      "<head></head",
      "<head></head>",
      "<head><",
      "<head><meta",
      "<head><meta name=",
      '<head><meta name="',
      "<head><title>",
      "<head><script>",
      "<head>&#99999999999;</head>",
      "<head><meta name=description content=&#xD800;></head>",
      "\ud800",
      "<head>İİİ<script></SCRIPT></head>",
      "<İead>",
    ];
    for (let i = 0; i < 300; i += 1) {
      const alphabet = ["<", ">", "/", "!", "-", '"', "'", "=", " ", "head", "meta", "title", "script", "name", "content", "&#", "x", "\n"];
      let s = "";
      let seed = i * 7919 + 13;
      for (let j = 0; j < 40; j += 1) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        s += alphabet[seed % alphabet.length];
      }
      inputs.push(s);
    }
    for (const input of inputs) {
      const result = lintSiteMetadataHtml(input);
      expect(typeof result.complete).toBe("boolean");
      expect(Array.isArray(result.findings)).toBe(true);
      expect(result.complete).toBe(result.findings.length === 0);
      for (const finding of result.findings) {
        expect(["missing", "empty", "duplicate", "unreadable"]).toContain(finding.rule);
        expect(typeof finding.tag).toBe("string");
        expect(typeof finding.message).toBe("string");
      }
    }
  });

  it("agrees with itself on repeated calls", () => {
    const html = fixture({ override: { robots: null }, duplicate: ["og:url"] });
    expect(lintSiteMetadataHtml(html)).toEqual(lintSiteMetadataHtml(html));
  });
});
