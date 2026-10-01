import { JSDOM, VirtualConsole } from "jsdom";
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
  /** raw markup appended inside the head after the tags (it must stay inside the strict grammar to be readable). */
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

  it("reads a tag's identity the way a parser decodes it, so an encoded name is the tag it names", () => {
    const html = fixture({ override: { robots: null }, extraHead: `<meta name="rob&#111;ts" content="x">` });
    expect(lintSiteMetadataHtml(html)).toEqual({ complete: true, findings: [] });
    expect(rulesAndTags(fixture({ extraHead: `<meta name="rob&#111;ts" content="x">` }))).toEqual([["duplicate", "robots"]]);
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
    const result = lintSiteMetadataHtml("<html><head><meta charset=utf-8></head><body></body></html>");
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

  it("does not count a tag inside a style", () => {
    const html = fixture({ override: { robots: null }, extraHead: `<style>/* ${robots} */</style>` });
    expect(rulesAndTags(html)).toEqual([["missing", "robots"]]);
  });

  it("refuses a textarea, noscript or template in the head instead of guessing what a browser does with it", () => {
    for (const extraHead of [
      `<textarea>${robots}</textarea>`,
      `<noscript>${robots}</noscript>`,
      `<template>${robots}</template>`,
    ]) {
      const result = lintSiteMetadataHtml(fixture({ override: { robots: null }, extraHead }));
      expect(result.complete).toBe(false);
      expect(result.findings.map((finding) => finding.rule)).toEqual(["unreadable"]);
    }
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

// ---------------------------------------------------------------------------
// Strict grammar: inside the head only the fixed element set is accepted, and
// anything else is `unreadable`. Every case below is a class a browser's
// "in head" insertion mode closes the head on, or reads differently.
// ---------------------------------------------------------------------------

type Position = "start" | "middle" | "end";
const POSITIONS: readonly Position[] = ["start", "middle", "end"];

/** A complete fixture with `markup` inserted at one of three places inside the head. */
function withInserted(markup: string, position: Position, base: string = fixture()): string {
  const open = base.indexOf("<head>") + "<head>".length;
  const close = base.indexOf("</head>");
  const at = position === "start" ? open : position === "end" ? close : base.indexOf('<meta property="og:title"');
  return base.slice(0, at) + markup + base.slice(at);
}

function expectUnreadable(html: string, context: string): void {
  const result = lintSiteMetadataHtml(html);
  expect(result.complete, context).toBe(false);
  expect(
    result.findings.map((finding) => finding.rule),
    context,
  ).toEqual(["unreadable"]);
}

describe("lintSiteMetadataHtml strict head grammar", () => {
  const ROBOTS = `<meta name="robots" content="index, follow">`;

  describe.each(POSITIONS)("markup placed at the %s of the head", (position) => {
    const cases: Array<[string, string]> = [
      ["a div", "<div>x</div>"],
      ["an img", "<img src=x>"],
      ["plain text", "hello"],
      ["a lone '<' and a space", "< "],
      ["an svg title", "<svg><title>x</title></svg>"],
      ["a body end tag", "</body>"],
      ["a br end tag", "</br>"],
      ["a noscript", "<noscript></noscript>"],
      ["a template", "<template></template>"],
      ["a noscript that hides a template close", `<noscript></template>${ROBOTS}</noscript>`],
      ["a textarea", "<textarea></textarea>"],
      ["a second html start tag", "<html>"],
      ["a body start tag", "<body>"],
      ["an html end tag", "</html>"],
      ["a processing instruction", "<?xml version='1.0'?>"],
      ["a non-comment declaration", "<!ELEMENT x>"],
      ["a doctype inside the head", "<!doctype html>"],
      ["an empty end tag", "</>"],
      ["a '<' followed by a digit", "<1>"],
      ["a title end tag with no title", "</title>"],
      ["a meta end tag", "</meta>"],
    ];
    it.each(cases)("refuses %s", (label, markup) => {
      expectUnreadable(withInserted(markup, position), `${label} at ${position}`);
    });
  });

  it("refuses text or a div before <head>", () => {
    for (const beforeHead of ["hello", "<div>x</div>", "<p>", "x", "<img src=x>"]) {
      expectUnreadable(fixture({ beforeHead }), `before head: ${beforeHead}`);
    }
    expectUnreadable(`hello${fixture()}`, "text before the doctype");
    expectUnreadable(fixture().replace("<html", "text<html"), "text between the doctype and <html>");
    expectUnreadable(fixture().replace("<head>", "text<head>"), "text between <html> and <head>");
  });

  it("refuses a second doctype, a second html, and a doctype after html", () => {
    expectUnreadable(fixture().replace("<html", "<!doctype html><html"), "two doctypes");
    expectUnreadable(fixture().replace("<head>", "<html><head>"), "two html start tags");
    expectUnreadable(fixture().replace("<head>", "<!doctype html><head>"), "a doctype after html");
  });

  it("refuses <noscript> and <template> that hide a meta from the depth counter", () => {
    const html = fixture({ override: { robots: null }, extraHead: `<noscript></template>${ROBOTS}</noscript>` });
    expectUnreadable(html, "noscript closed by a template end tag");
    expectUnreadable(fixture({ extraHead: "<template><noscript></template></noscript></template>" }), "nested hidden depth");
  });

  it("refuses double-escaped script content", () => {
    const html = fixture({
      override: { robots: null },
      extraHead: `<script><!--<script></script>${ROBOTS}</script>`,
    });
    expectUnreadable(html, "double-escaped script");
    expectUnreadable(fixture({ extraHead: "<script>var a = 1; <!-- x</script>" }), "a script containing a comment opener");
    expectUnreadable(fixture({ extraHead: "<SCRIPT><!--</SCRIPT>" }), "an upper-case script containing a comment opener");
  });

  it("accepts a script or style that merely mentions markup, and a title with markup-like text", () => {
    expect(lintSiteMetadataHtml(fixture({ extraHead: `<script>var s = "<div></div>";</script><style>a > b {}</style>` })).complete).toBe(true);
  });

  it("refuses a comment that a browser closes with --!> before the lint would", () => {
    const html = fixture({ extraHead: `<!-- a --!>${ROBOTS}<!-- b -->` });
    expectUnreadable(html, "a comment closed by --!>");
  });

  it("accepts the empty-comment forms and ordinary comments in the head and before it", () => {
    expect(lintSiteMetadataHtml(fixture({ extraHead: "<!----><!--->" + "<!-- a -- b -->" })).complete).toBe(true);
    expect(lintSiteMetadataHtml(`<!-- top -->${fixture()}`).complete).toBe(true);
  });

  it("accepts whitespace around the head", () => {
    expect(lintSiteMetadataHtml(fixture().replace("<head>", "\n <head>\n\t").replace("</head>", " \r\n</head>")).complete).toBe(true);
  });

  it("refuses a byte order mark, which a parser fed a string reads as text and so closes the head", () => {
    expectUnreadable(`\uFEFF${fixture()}`, "a leading BOM");
    expectUnreadable(` \uFEFF${fixture()}`, "a BOM after whitespace");
    expectUnreadable(withInserted("\uFEFF", "start"), "a BOM inside the head");
  });

  it("refuses a head element name that only starts with an allowed one", () => {
    expectUnreadable(withInserted("<metadata>", "start"), "<metadata>");
    expectUnreadable(withInserted("<links>", "middle"), "<links>");
    expectUnreadable(withInserted("<titles></titles>", "end"), "<titles>");
  });
});

// ---------------------------------------------------------------------------
// After `</head>`: a parser stays in its "after head" mode until `<body>`, and in
// that mode a meta, title or link start tag goes INTO the head. So after
// `</head>` the lint accepts only whitespace, comments, then end of input or
// `<body`; anything else is `unreadable`.
// ---------------------------------------------------------------------------

describe("lintSiteMetadataHtml after the closing head tag", () => {
  const ROBOTS = `<meta name="robots" content="noindex">`;
  const refused: Array<[string, string]> = [
    ["a robots meta", ROBOTS],
    ["an empty robots meta", `<meta name="robots" content="">`],
    ["a meta", `<meta name="viewport" content="width=device-width">`],
    ["a title", "<title>Other</title>"],
    ["a link", `<link rel=canonical href=/y>`],
    ["a base", `<base href="/">`],
    ["a script", "<script>1</script>"],
    ["a style", "<style>a{}</style>"],
    ["a div", "<div>x</div>"],
    ["plain text", "hello"],
    ["a no-break space", "\u00a0"],
    ["a byte order mark", "\uFEFF"],
    ["a second </head>", "</head>"],
    ["a <head>", "<head>"],
    ["a <head> element", "<head></head>"],
    ["a second <html>", "<html>"],
    ["a doctype", "<!doctype html>"],
    ["a stray end tag", "</div>"],
    ["an end tag then a meta", `</div>${ROBOTS}`],
    ["a script then a meta", `<script>1</script>${ROBOTS}`],
    ["a <header>", "<header>x</header>"],
    ["a <bodyx>", "<bodyx>"],
    ["a <body without a terminator", "<body"],
    ["a bare <", "<"],
    ["a processing instruction", "<?x?>"],
    ["an unterminated comment", "<!-- never closed"],
    ["a comment closed by --!>", `<!-- a --!>${ROBOTS}-->`],
    ["a declaration", "<!x>"],
  ];

  it.each(refused)("refuses %s between </head> and <body>", (_label, markup) => {
    expectUnreadable(`${fixture()}${markup}<body>`, "before <body>");
    expectUnreadable(`${fixture()}${markup}`, "at end of input");
    expectUnreadable(`${fixture()} \n<!-- c -->\n${markup}<body>`, "after whitespace and a comment");
    expectUnreadable(`${fixture()}<!-- c -->${markup}<body>`, "after a comment");
  });

  it("refuses the review's failing inputs, each of which a parser reads as a second copy in the head", () => {
    const inputs = [
      `${fixture()}${ROBOTS}<body>`,
      `${fixture()}<title>Other</title>`,
      `${fixture()}\n<!--x--><link rel=canonical href=/y>`,
      `${fixture()}</div>${ROBOTS}`,
      `${fixture()}<script>1</script>${ROBOTS}`,
      `${fixture()}<meta name="robots" content="">`,
    ];
    for (const html of inputs) {
      expectUnreadable(html, html.slice(-80));
      expect(oracleSaysComplete(html), html.slice(-80)).toBe(false);
    }
  });

  it("reports the after-head class as one unreadable finding, not as a duplicate", () => {
    expect(lintSiteMetadataHtml(`${fixture()}${ROBOTS}<body>`).findings.map((finding) => finding.tag)).toEqual(["head"]);
  });

  it.each([
    ["end of input", ""],
    ["whitespace", " \n\t\r\f"],
    ["a comment", "<!-- c -->"],
    ["empty comments", "<!----><!--->"],
    ["whitespace and comments", "\n<!-- a -->  <!-- b -->\n"],
    ["a plain body", "<body>"],
    ["an upper-case body", "<BODY>"],
    ["a body with attributes", `<body class="a" data-x=y>`],
    ["a body after whitespace and a comment", "\n<!-- c -->\n<body>"],
    ["a self-closing-style body", "<body/>"],
    ["a body with a line break before its attribute", "<body\nclass=x>"],
  ])("still judges a page whose </head> is followed by %s", (_label, tail) => {
    expect(lintSiteMetadataHtml(`${fixture()}${tail}`)).toEqual({ complete: true, findings: [] });
    expect(lintSiteMetadataHtml(`${fixture()}${tail}<h1>Hello</h1></body></html>`).complete).toBe(tail.toLowerCase().includes("<body"));
    expect(oracleSaysComplete(`${fixture()}${tail}`)).toBe(true);
  });

  it("judges the head normally when </head> is followed only by whitespace, comments and <body>", () => {
    const html = `${fixture({ override: { robots: null } })}\n<!-- c -->\n<body>`;
    expect(rulesAndTags(html)).toEqual([["missing", "robots"]]);
    expect(rulesAndTags(`${fixture({ duplicate: ["title"] })}<body>`)).toEqual([["duplicate", "title"]]);
  });

  it("refuses an end tag such as </html> directly after </head>, because only <body or the end of input may follow", () => {
    expectUnreadable(`${fixture()}</html>`, "</html> after </head>");
  });

  it("does not read what follows <body", () => {
    expect(lintSiteMetadataHtml(`${fixture()}<body>${ROBOTS}<head><title>x</title><!-- never closed`)).toEqual({
      complete: true,
      findings: [],
    });
  });
});

describe("lintSiteMetadataHtml closed character-reference set", () => {
  const cases: Array<[string, string]> = [
    ["a numeric reference with no semicolon", "&#32"],
    ["a hex reference with no semicolon", "&#x20"],
    ["&nbsp;", "&nbsp;"],
    ["&nbsp with no semicolon", "&nbsp"],
    ["&copy with no semicolon", "&copy"],
    ["&copy;", "&copy;"],
    ["&AMP;", "&AMP;"],
    ["&amp with no semicolon", "&amp"],
    ["a bare &#", "&#;"],
    ["&#x with no digits", "&#x;"],
    ["a named reference that decodes to a colon", "&colon;"],
  ];

  it.each(cases)("reports %s in a value as unreadable for that tag", (_label, value) => {
    const html = fixture({ override: { description: null }, extraHead: `<meta name="description" content="a ${value} b">` });
    const result = lintSiteMetadataHtml(html);
    expect(result.complete).toBe(false);
    expect(result.findings.map((finding) => [finding.rule, finding.tag])).toEqual([["unreadable", "description"]]);
  });

  it("reports a bad reference in a title, a link href, and a property meta for that tag", () => {
    const title = fixture({ override: { title: null }, extraHead: "<title>a &nbsp; b</title>" });
    expect(rulesAndTags(title)).toEqual([["unreadable", "title"]]);
    const href = fixture({ override: { canonical: null }, extraHead: `<link rel="canonical" href="https://example.com/?a=1&b=2&copy">` });
    expect(rulesAndTags(href)).toEqual([["unreadable", "canonical"]]);
    const prop = fixture({ override: { "og:title": null }, extraHead: `<meta property="og:title" content="&#32">` });
    expect(rulesAndTags(prop)).toEqual([["unreadable", "og:title"]]);
  });

  it("refuses a reference outside the set in an identity attribute, whose decoded value could name a declared tag", () => {
    const html = fixture({ override: { "og:title": null }, extraHead: `<meta property="og&colon;title" content="x">` });
    expect(lintSiteMetadataHtml(html).complete).toBe(false);
    expect(lintSiteMetadataHtml(html).findings.some((finding) => finding.rule === "unreadable" && finding.tag === "meta")).toBe(true);
  });

  it("accepts the closed set and treats a decoded identity as the tag it names", () => {
    for (const value of ["&amp;", "&lt;", "&gt;", "&quot;", "&apos;", "&#38;", "&#x26;", "&#X26;", "&#00038;", "a & b", "a &1 b", "&&amp;"]) {
      const html = fixture({ override: { description: null }, extraHead: `<meta name="description" content="${value}">` });
      expect(lintSiteMetadataHtml(html), value).toEqual({ complete: true, findings: [] });
    }
    const named = fixture({ override: { robots: null }, extraHead: `<meta name="rob&#111;ts" content="x">` });
    expect(lintSiteMetadataHtml(named)).toEqual({ complete: true, findings: [] });
    const duplicate = fixture({ extraHead: `<meta name="rob&#111;ts" content="x">` });
    expect(rulesAndTags(duplicate)).toEqual([["duplicate", "robots"]]);
  });

  it("judges an entity blank and a raw blank alike", () => {
    for (const blank of ["&#160;", "&#xA0;", "\u00a0", "&#32;&#9;", "&#x2003;"]) {
      const html = fixture({ override: { description: null }, extraHead: `<meta name="description" content="${blank}">` });
      expect(rulesAndTags(html), JSON.stringify(blank)).toEqual([["empty", "description"]]);
    }
  });
});

describe("lintSiteMetadataHtml property: nothing outside the grammar survives", () => {
  const ELEMENTS = [
    "div", "span", "p", "a", "img", "br", "body", "h1", "svg", "math", "noscript", "template", "textarea", "iframe",
    "form", "input", "ul", "li", "table", "section", "nav", "header", "footer", "main", "article", "button", "select",
    "option", "object", "embed", "video", "audio", "canvas", "frameset", "frame", "basefont", "bgsound", "noframes",
    "x-custom", "b", "i", "pre", "html", "hr", "font", "center", "marquee", "xmp", "plaintext", "noembed", "isindex",
    "title-x", "metas", "linked", "scripts", "styled", "headers", "DIV", "Div",
  ];
  const TEXTS = ["x", "hello", "0", ".", "\u00a0", "\u200b", "text with spaces", "&amp;", "\u0000", "-->", "\u00e9"];
  const END_TAGS = ELEMENTS.filter((name) => name !== "head");

  it("has at least 30 element names to try", () => {
    expect(ELEMENTS.length).toBeGreaterThanOrEqual(30);
  });

  it.each(POSITIONS)("refuses every non-allowlisted start tag at the %s of the head", (position) => {
    for (const name of ELEMENTS) {
      expectUnreadable(withInserted(`<${name}>`, position), `<${name}> at ${position}`);
      expectUnreadable(withInserted(`<${name} a="b">x</${name}>`, position), `<${name} a> at ${position}`);
    }
  });

  it.each(POSITIONS)("refuses every non-head end tag at the %s of the head", (position) => {
    for (const name of END_TAGS) {
      expectUnreadable(withInserted(`</${name}>`, position), `</${name}> at ${position}`);
    }
  });

  it.each(POSITIONS)("refuses non-whitespace text at the %s of the head", (position) => {
    for (const text of TEXTS) {
      expectUnreadable(withInserted(text, position), `text ${JSON.stringify(text)} at ${position}`);
    }
  });

  it("refuses every non-allowlisted element placed before <head>", () => {
    for (const name of ELEMENTS) {
      expectUnreadable(fixture({ beforeHead: `<${name}>` }), `<${name}> before head`);
    }
    for (const text of TEXTS) {
      expectUnreadable(fixture({ beforeHead: text }), `text ${JSON.stringify(text)} before head`);
    }
  });
});

// ---------------------------------------------------------------------------
// Oracle: whenever the lint says complete, a spec parser puts exactly one
// non-blank copy of each declared tag directly in <head>. jsdom (scripting
// on and off) is a test-only devDependency; the module itself has no
// dependency.
// ---------------------------------------------------------------------------

interface HeadElement {
  name: string;
  attrs: Map<string, string>;
  text: string;
}

/** Parses with jsdom's spec parser; `scripting` turns the parser's scripting flag on, which changes how `<noscript>` is read. */
function jsdomHead(html: string, scripting: boolean): HeadElement[] {
  const dom = new JSDOM(html, { virtualConsole: new VirtualConsole(), ...(scripting ? { runScripts: "dangerously" as const } : {}) });
  const head = dom.window.document.head;
  const elements = [...head.children].map((element) => ({
    name: element.localName,
    attrs: new Map([...element.attributes].map((attr) => [attr.name, attr.value])),
    text: element.textContent ?? "",
  }));
  dom.window.close();
  return elements;
}

function oracleValues(elements: HeadElement[], key: string): string[] {
  const entry = SITE_METADATA_REQUIRED_TAGS.find((candidate) => candidate.key === key)!;
  const lower = (text: string): string => text.toLowerCase();
  switch (entry.selector) {
    case "title":
      return elements.filter((element) => element.name === "title").map((element) => element.text);
    case "meta-name":
    case "meta-property": {
      const identity = entry.selector === "meta-name" ? "name" : "property";
      return elements
        .filter((element) => element.name === "meta" && lower(element.attrs.get(identity) ?? "") === key)
        .map((element) => element.attrs.get("content") ?? "");
    }
    case "link-rel":
      return elements
        .filter((element) => element.name === "link" && lower(element.attrs.get("rel") ?? "").split(/[ \t\n\r\f]+/).includes(key))
        .map((element) => element.attrs.get("href") ?? "");
  }
}

/** Every parser view of `html` holds exactly one non-blank copy of each declared tag in <head>. */
function oracleSaysComplete(html: string): boolean {
  const views = [jsdomHead(html, false), jsdomHead(html, true)];
  return views.every((elements) =>
    SITE_METADATA_REQUIRED_TAGS.every((entry) => {
      const values = oracleValues(elements, entry.key);
      return values.length === 1 && values[0]!.trim() !== "";
    }),
  );
}

describe("lintSiteMetadataHtml against a spec parser", () => {
  const ROBOTS = `<meta name="robots" content="index, follow">`;
  const inputs: string[] = [
    fixture(),
    fullDocument(),
    `\uFEFF${fixture()}`,
    `<!-- top -->${fixture()}`,
    fixture({ beforeHead: "<!-- a --><!---->" }),
    fixture({ extraHead: "<!-- c --><!----><!--->" }),
    fixture({ extraHead: `<script>var a = "<div>";</script><style>a>b{}</style><base href="/">` }),
    fixture({ override: { title: null }, extraHead: `<TITLE>A &amp; B</TITLE>` }),
    fixture({ override: { robots: null }, extraHead: `<META NAME=robots CONTENT=index>` }),
    fixture({ override: { robots: null }, extraHead: `<meta name="rob&#111;ts" content="x">` }),
    fixture({ override: { canonical: null }, extraHead: `<link rel="Canonical nofollow" href="https://example.com/x">` }),
    fixture({ override: { description: null }, extraHead: `<meta name="description" content="&#38;&#x26;&amp;">` }),
    fixture({ override: { description: null }, extraHead: `<meta name="description" content="&#160;">` }),
    fixture({ extraHead: "<!-- a --!>" + ROBOTS + "<!-- b -->" }),
    fixture({ override: { robots: null }, extraHead: `<script><!--<script></script>${ROBOTS}</script>` }),
    fixture({ override: { robots: null }, extraHead: `<noscript></template>${ROBOTS}</noscript>` }),
    fixture({ override: { robots: null }, extraHead: `<template>${ROBOTS}</template>` }),
    fixture({ extraHead: `<noscript>${ROBOTS}</noscript>` }),
    fixture({ beforeHead: "hello" }),
    fixture({ beforeHead: "<div>x</div>" }),
    `${fixture()}\n<!-- c -->\n<body class="a">`,
    `${fixture()}${ROBOTS}<body>`,
    `${fixture()}<title>Other</title>`,
    `${fixture()}\n<!--x--><link rel=canonical href=/y>`,
    `${fixture()}</div>${ROBOTS}`,
    `${fixture()}<script>1</script>${ROBOTS}`,
    `${fixture()}<div>x</div>${ROBOTS}`,
    `${fixture()}hello${ROBOTS}`,
    `${fixture()}</head>${ROBOTS}`,
    `${fixture()}<head>${ROBOTS}`,
    withInserted("<div>x</div>", "start"),
    withInserted("<img src=x>", "middle"),
    withInserted("hello", "end"),
    withInserted("< ", "start"),
    withInserted("<svg><title>x</title></svg>", "start"),
    withInserted("</body>", "middle"),
    withInserted("</br>", "middle"),
    withInserted("<textarea></textarea>", "middle"),
    withInserted("&#32", "end"),
    fixture({ override: { description: null }, extraHead: `<meta name="description" content="&#32">` }),
    fixture({ override: { description: null }, extraHead: `<meta name="description" content="&nbsp;">` }),
    fixture({ override: { description: null }, extraHead: `<meta name="description" content="&copy">` }),
    fixture({ override: { "og:title": null }, extraHead: `<meta property="og&colon;title" content="x">` }),
    ...SITE_METADATA_REQUIRED_TAGS.flatMap((entry) => [
      fixture({ override: { [entry.key]: null } }),
      fixture({ duplicate: [entry.key] }),
    ]),
  ];

  it("really parses with scripting on in one view and off in the other", () => {
    const html = `<!doctype html><html><head><noscript><meta name="robots" content="x"></noscript></head></html>`;
    const read = (scripting: boolean): number => {
      const dom = new JSDOM(html, { virtualConsole: new VirtualConsole(), ...(scripting ? { runScripts: "dangerously" as const } : {}) });
      const count = dom.window.document.head.querySelectorAll("noscript > meta").length;
      dom.window.close();
      return count;
    };
    expect(read(false)).toBe(1);
    expect(read(true)).toBe(0);
  });

  it("has fixtures the lint accepts and fixtures it refuses", () => {
    const complete = inputs.filter((html) => lintSiteMetadataHtml(html).complete);
    expect(complete.length).toBeGreaterThanOrEqual(8);
    expect(complete.length).toBeLessThan(inputs.length);
  });

  it("only reports complete when jsdom with scripting on and off find exactly one non-blank copy of each tag in the head", () => {
    for (const html of inputs) {
      if (!lintSiteMetadataHtml(html).complete) continue;
      expect(oracleSaysComplete(html), html.slice(0, 400)).toBe(true);
    }
  });

  it("only reports complete for the property-test insertions when the parsers agree", () => {
    for (const position of POSITIONS) {
      for (const name of ["div", "img", "noscript", "template", "body", "svg", "textarea", "p", "x-custom"]) {
        for (const markup of [`<${name}>`, `</${name}>`, `<${name}></${name}>`]) {
          const html = withInserted(markup, position);
          if (lintSiteMetadataHtml(html).complete) expect(oracleSaysComplete(html), html.slice(0, 400)).toBe(true);
        }
      }
    }
  });

  it("only reports complete when the parsers agree, over deterministic random mixes of head pieces", () => {
    const pieces = [
      " ", "\n", "<!-- c -->", "<!---->", "<!--->", "<!-- a --!> ", "<base href=/>", "<meta charset=utf-8>",
      `<script>var a="<b>";</script>`, "<script><!--</script>", "<style>a{}</style>", "<title>t &amp; u</title>",
      "<title>&nbsp;</title>", "<noscript>", "</noscript>", "<template>", "</template>", "<div>", "</div>", "x", "<",
      "< ", "</", "<!x>", "<?x?>", "</br>", "</body>", "<p>", "&#32", `<meta name="robots" content="a">`,
      `<meta name="rob&#111;ts" content="&#32;">`, `<meta name=description content=&copy>`, `<link rel=canonical href=/x>`,
      `<meta property="og:title" content="&#x20;">`, `<meta property='og:image' content=''>`, "<svg>", "</svg>",
      "<textarea>", "</textarea>", "<html>", "<head>", "</head>", "<body>", "\uFEFF", "\u00a0",
    ];
    // Between `</head>` and `<body>` a parser moves head-class tags into the head, so that position
    // draws from a pool weighted toward whitespace, comments and the tags a parser would move.
    const afterHeadPieces = [
      " ", "\n", "\t", "<!-- c -->", "<!---->", `<meta name="robots" content="a">`, `<meta name="description" content="d">`,
      "<title>t</title>", "<link rel=canonical href=/x>", `<meta property="og:title" content="t">`, `<meta name="viewport" content="v">`,
      "<base href=/>", "<script>1</script>", "<style>a{}</style>", "</div>", "<div>", "x", "</head>", "<head>", "<html>", "<body>",
      "<body class=a>", "<!-- a --!> ", "<!-- never",
    ];
    let seed = 20260928;
    const next = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed >>> 8) % bound;
    };
    let completeCount = 0;
    let completeAfterHead = 0;
    for (let round = 0; round < 800; round += 1) {
      // Positions 0-2 are inside the head; 3 is after `</head>`, alone or before a `<body>`.
      const slot = round % 4;
      const pool = slot === 3 ? afterHeadPieces : pieces;
      let mix = "";
      for (let n = next(4); n > 0; n -= 1) mix += pool[next(pool.length)];
      const overridden: Record<string, string | null> =
        round % 3 === 0 ? { robots: null, description: null, "og:title": null, "og:image": null, canonical: null } : {};
      const base = fixture({ override: overridden });
      const html = slot < 3 ? withInserted(mix, POSITIONS[slot]!, base) : `${base}${mix}`;
      if (!lintSiteMetadataHtml(html).complete) continue;
      completeCount += 1;
      if (slot === 3) completeAfterHead += 1;
      expect(oracleSaysComplete(html), html.slice(0, 500)).toBe(true);
    }
    expect(completeCount).toBeGreaterThan(0);
    expect(completeAfterHead).toBeGreaterThan(0);
  }, 60_000);

  it("agrees with the oracle that the bypass fixtures the old lint accepted are not complete pages", () => {
    const bypasses = [
      withInserted("<div>x</div>", "start"),
      withInserted("<img src=x>", "start"),
      withInserted("hello", "start"),
      withInserted("< ", "start"),
      withInserted("<svg><title>x</title></svg>", "start"),
      fixture({ beforeHead: "hello" }),
      `\uFEFF${fixture()}`,
      withInserted("</body>", "start"),
      withInserted("</br>", "start"),
      `${fixture()}<meta name="robots" content="noindex"><body>`,
      `${fixture()}<title>Other</title>`,
      `${fixture()}</div><link rel=canonical href=/y>`,
    ];
    for (const html of bypasses) {
      expect(oracleSaysComplete(html), html.slice(0, 300)).toBe(false);
      expect(lintSiteMetadataHtml(html).complete, html.slice(0, 300)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Time budget: the lint is linear, so a 200 KB pathological input finishes
// well inside the budget even on a busy machine.
// ---------------------------------------------------------------------------

describe("lintSiteMetadataHtml time budget", () => {
  const SIZE = 200_000;
  const BUDGET_MS = 750;
  const repeat = (unit: string): string => unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE);
  const head = "<!doctype html><html><head>";
  const pathological: Array<[string, string]> = [
    ["only '<'", repeat("<")],
    ["comment openers", repeat("<!--")],
    ["closed empty comments in the head", head + repeat("<!---->")],
    ["closed comments with --! runs in the head", head + repeat("<!-- --! -->")],
    ["unterminated meta starts in the head", head + repeat("<meta ")],
    ["attribute noise in the head", head + "<meta " + repeat('a="b" c ')],
    ["one long unterminated quoted value", head + '<meta name="x" content="' + repeat("a")],
    ["many titles in the head", head + repeat("<title>x</title>") + "</head>"],
    ["many scripts in the head", head + repeat("<script>x</script>") + "</head>"],
    ["many metas with entities in the head", head + repeat('<meta name="robots" content="&amp;&#1;">') + "</head>"],
    ["many style starts after the head", head + "</head>" + repeat("<style>")],
    ["end-tag openers inside a script", head + "<script>" + repeat("</")],
    ["character-reference prefixes in a value", head + '<meta name="description" content="' + repeat("&#") + '"></head>'],
    ["character-reference prefixes in a title", head + "<title>" + repeat("&#1") + "</title></head>"],
    ["hex character references in a value", head + '<meta name="description" content="' + repeat("&#x1;") + '"></head>'],
    ["a long run of digits after &#", head + '<meta name="description" content="&#' + repeat("1") + '"></head>'],
    ["many tags after the head", head + "</head>" + repeat("<div>")],
    ["comment and script openers after the head", head + "</head>" + repeat("<!--<script>")],
    ["whitespace only inside the head", head + repeat(" \n")],
    ["whitespace only before the head", repeat(" ") + "<head>"],
  ];

  it.each(pathological)("lints %s within the time budget", (_label, html) => {
    expect(html.length).toBeGreaterThanOrEqual(SIZE - 1);
    const started = performance.now();
    const result = lintSiteMetadataHtml(html);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(BUDGET_MS);
    expect(result.complete).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  it("lints a 200 KB complete head with a long trailing body within the time budget", () => {
    const html = fixture() + "<body>" + repeat("<p>x</p><!-- y -->") + "</body>";
    const started = performance.now();
    const result = lintSiteMetadataHtml(html);
    expect(performance.now() - started).toBeLessThan(BUDGET_MS);
    expect(result).toEqual({ complete: true, findings: [] });
  });
});
