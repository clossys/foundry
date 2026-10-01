import { describe, expect, it } from "vitest";
import { lintRenderedHead } from "./head-lint.js";

const SITE = "Example Co";
const ORIGIN = "https://example.test";
const MARKER_TITLE = "Marker Title Zq";
const MARKER_URL = "https://marker-url.example.test/leak";

interface HeadOptions {
  route?: string;
  title?: string | null;
  omit?: readonly string[];
  blank?: readonly string[];
  override?: Readonly<Record<string, string>>;
}

const TAGS = ["description", "robots", "theme-color", "canonical", "og:title", "og:description", "og:url", "og:image", "og:site_name", "twitter:card", "twitter:title", "twitter:image"];

function titleFor(route: string): string {
  return route === "/" ? `${SITE} · A fictional tagline` : `About · ${SITE}`;
}

/** One complete head for a route; every tag can be omitted, blanked or overridden. */
function head(options: HeadOptions = {}): string {
  const route = options.route ?? "/";
  const title = options.title === undefined ? titleFor(route) : options.title;
  const values: Record<string, string> = {
    description: "A fictional description.",
    robots: "index, follow",
    "theme-color": "#112233",
    canonical: `${ORIGIN}${route}`,
    "og:title": title ?? titleFor(route),
    "og:description": "A fictional description.",
    "og:url": `${ORIGIN}${route}`,
    "og:image": `${ORIGIN}/share.png`,
    "og:site_name": SITE,
    "twitter:card": "summary_large_image",
    "twitter:title": title ?? titleFor(route),
    "twitter:image": `${ORIGIN}/share.png`,
    ...options.override,
  };
  const lines: string[] = [];
  if (title !== null) lines.push(`<title>${title}</title>`);
  for (const tag of TAGS) {
    if (options.omit?.includes(tag)) continue;
    const value = options.blank?.includes(tag) ? "   " : (values[tag] as string);
    if (tag === "canonical") lines.push(`<link rel="canonical" href="${value}">`);
    else if (tag.startsWith("og:")) lines.push(`<meta property="${tag}" content="${value}">`);
    else lines.push(`<meta name="${tag}" content="${value}">`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${lines.join("")}</head><body><h1>Page</h1></body></html>`;
}

function lint(html: string, path = "/") {
  return lintRenderedHead({ siteName: SITE, pages: [{ path, html }] });
}

function rules(findings: { rule: string }[]): string[] {
  return findings.map((finding) => finding.rule);
}

describe("lintRenderedHead", () => {
  it("passes a complete head on the home route and on another route", () => {
    expect(lint(head())).toEqual([]);
    expect(lint(head({ route: "/about" }), "/about")).toEqual([]);
  });

  describe("titles", () => {
    it("refuses a pipe or dash separator with title-separator", () => {
      for (const title of [`About | ${SITE}`, `About - ${SITE}`, `About – ${SITE}`, `About — ${SITE}`, `About|${SITE}`]) {
        const html = head({ route: "/about", title });
        expect(rules(lint(html, "/about")), title).toEqual(["title-separator"]);
      }
      expect(rules(lint(head({ title: `${SITE} | A fictional tagline` })))).toEqual(["title-separator"]);
    });

    it("does not read a hyphen inside the site name as a separator", () => {
      const findings = lintRenderedHead({ siteName: "Ex-Co", pages: [{ path: "/about", html: head({ route: "/about", title: "About · Ex-Co" }) }] });
      expect(findings).toEqual([]);
    });

    it("refuses the name on the wrong side, a missing name, a repeated separator and bad spacing with title-format", () => {
      expect(rules(lint(head({ route: "/about", title: `${SITE} · About` }), "/about"))).toEqual(["title-format"]);
      expect(rules(lint(head({ route: "/about", title: "About" }), "/about"))).toEqual(["title-format"]);
      expect(rules(lint(head({ route: "/about", title: `A · B · ${SITE}` }), "/about"))).toEqual(["title-format"]);
      expect(rules(lint(head({ route: "/about", title: `About·${SITE}` }), "/about"))).toEqual(["title-format"]);
      expect(rules(lint(head({ title: `A fictional tagline · ${SITE}` })))).toEqual(["title-format"]);
      expect(rules(lint(head({ title: `${SITE} · ` })))).toEqual(["title-format"]);
    });

    it("refuses a missing or blank title with head-missing and a second title with title-duplicate", () => {
      expect(lint(head({ title: null }))).toEqual([{ rule: "head-missing", path: "/#title" }]);
      expect(rules(lint(head({ title: "   " })))).toContain("head-missing");
      const doubled = head().replace("</head>", `<title>${SITE} · A fictional tagline</title></head>`);
      expect(lint(doubled)).toEqual([{ rule: "title-duplicate", path: "/" }]);
    });

    it("accepts a character-reference separator and decodes whitespace", () => {
      const html = head({ route: "/about", title: `About &middot; ${SITE}` });
      expect(lint(html, "/about")).toEqual([]);
      expect(lint(head({ route: "/about", title: `\n  About · ${SITE}\n` }), "/about")).toEqual([]);
    });
  });

  describe("completeness", () => {
    it("reports one head-missing per removed or blanked tag", () => {
      expect(TAGS).toHaveLength(12);
      for (const tag of TAGS) {
        expect(lint(head({ omit: [tag] })), `omit ${tag}`).toEqual([{ rule: "head-missing", path: `/#${tag}` }]);
        expect(lint(head({ blank: [tag] })), `blank ${tag}`).toEqual([{ rule: "head-missing", path: `/#${tag}` }]);
      }
    });

    it("accepts attribute order, quote and name/property variants", () => {
      const html = [
        "<html><head>",
        `<TITLE>${SITE} · A fictional tagline</TITLE>`,
        `<meta content='A fictional description.' name=description>`,
        `<META CONTENT="index, follow" NAME="robots" />`,
        `<meta name="theme-color" content=#112233>`,
        `<link href="${ORIGIN}/" rel="canonical">`,
        `<link rel="Alternate CANONICAL" href='${ORIGIN}/'>`,
        `<meta property="og:title" content="${SITE} &#183; A fictional tagline">`,
        `<meta name="og:description" content="d">`,
        `<meta content="${ORIGIN}/" property="og:url">`,
        `<meta property="og:image" content="${ORIGIN}/share.png">`,
        `<meta property="og:site_name" content="${SITE}">`,
        `<meta name="twitter:card" content="summary">`,
        `<meta property="twitter:title" content="${SITE} &middot; A fictional tagline">`,
        `<meta name="twitter:image" content="${ORIGIN}/share.png">`,
        "</head><body></body></html>",
      ].join("\n");
      expect(lint(html)).toEqual([]);
    });

    it("does not count a tag in a comment, a script or a style", () => {
      const stripped = head({ omit: ["og:image", "description"] });
      const hidden = [
        `<!-- <meta property="og:image" content="${ORIGIN}/share.png"> -->`,
        `<script>var s = '<meta name="description" content="x">';</script>`,
        `<style>/* <meta name="description" content="x"> */</style>`,
      ].join("");
      const html = stripped.replace("</head>", `${hidden}</head>`);
      expect(lint(html)).toEqual([
        { rule: "head-missing", path: "/#description" },
        { rule: "head-missing", path: "/#og:image" },
      ]);
    });

    it("does not read a title outside the head", () => {
      const html = head({ title: null }).replace("<h1>Page</h1>", `<svg><title>${SITE} · A fictional tagline</title></svg>`);
      expect(lint(html)).toEqual([{ rule: "head-missing", path: "/#title" }]);
    });

    it("does not count a tag inside a template, nor let one end the head", () => {
      const inner = head({ title: `${SITE} · A fictional tagline` }).replace("<head>", "").replace(/<\/head>.*$/, "");
      const html = `<!doctype html><html><head><meta charset="utf-8"><template><head></head><body>${inner}</body></template></head><body></body></html>`;
      expect(rules(lint(html))).toContain("head-missing");
      expect(lint(html)).toContainEqual({ rule: "head-missing", path: "/#title" });
      expect(lint(html)).toContainEqual({ rule: "head-missing", path: "/#og:image" });
      const withTemplateTitle = head().replace("</head>", `<template><title>${SITE} · Other</title></template></head>`);
      expect(lint(withTemplateTitle)).toEqual([]);
    });

    it("keys findings on the route of each page", () => {
      const findings = lintRenderedHead({
        siteName: SITE,
        pages: [
          { path: "/", html: head() },
          { path: "/about", html: head({ route: "/about", omit: ["og:image"] }) },
        ],
      });
      expect(findings).toEqual([{ rule: "head-missing", path: "/about#og:image" }]);
    });
  });

  describe("consistency", () => {
    it("refuses an og:title or twitter:title that differs from the title", () => {
      expect(lint(head({ override: { "og:title": "Something else" } }))).toEqual([{ rule: "head-title-mismatch", path: "/#og:title" }]);
      expect(lint(head({ override: { "twitter:title": "Something else" } }))).toEqual([{ rule: "head-title-mismatch", path: "/#twitter:title" }]);
    });

    it("refuses a canonical path that is not the route and accepts a trailing slash", () => {
      expect(lint(head({ route: "/about", override: { canonical: `${ORIGIN}/other` } }), "/about")).toEqual([{ rule: "canonical-path", path: "/about#canonical" }]);
      expect(lint(head({ route: "/about", override: { canonical: `${ORIGIN}/about/` } }), "/about")).toEqual([]);
      expect(lint(head({ override: { canonical: `${ORIGIN}/about` } }))).toEqual([{ rule: "canonical-path", path: "/#canonical" }]);
    });

    it("refuses a relative canonical and a canonical origin that differs between pages", () => {
      expect(lint(head({ override: { canonical: "/" } }))).toEqual([{ rule: "canonical-origin", path: "/#canonical" }]);
      const findings = lintRenderedHead({
        siteName: SITE,
        pages: [
          { path: "/", html: head() },
          { path: "/about", html: head({ route: "/about", override: { canonical: "https://other.example.test/about" } }) },
          { path: "/team", html: head({ route: "/team", override: { canonical: "http://example.test/team" } }).replace("About ·", "Team ·") },
        ],
      });
      expect(findings).toContainEqual({ rule: "canonical-origin", path: "/about#canonical" });
      expect(findings).toContainEqual({ rule: "canonical-origin", path: "/team#canonical" });
      expect(findings.filter((finding) => finding.rule === "canonical-origin")).toHaveLength(2);
    });
  });

  describe("no echo", () => {
    it("never puts a title or URL from the HTML in a finding", () => {
      const html = head({
        route: "/about",
        title: `${MARKER_TITLE} | ${SITE}`,
        override: { canonical: `${MARKER_URL}/elsewhere`, "og:title": MARKER_TITLE, "twitter:title": MARKER_URL },
        omit: ["og:image"],
      });
      const findings = lint(html, "/about");
      expect(findings.length).toBeGreaterThan(0);
      const text = JSON.stringify(findings);
      expect(text).not.toContain("Marker");
      expect(text).not.toContain("marker-url");
      expect(text).not.toContain("example.test");
    });

    it("returns findings and never throws on garbage input", () => {
      const garbage = ["", "<", "<<<>>>", "<title", "<title>x", "<meta name=", "<!-- <title>", "<script><title>", "\u0000\ud800", "<meta name='a' content='&#x110000;&#xD800;&bogus;'>", "<head>".repeat(2000)];
      for (const html of garbage) {
        const findings = lint(html);
        expect(findings.length).toBeGreaterThan(0);
      }
      expect(() => lintRenderedHead({ siteName: SITE, pages: [{ path: 5, html: 7 } as never, null as never, { path: "/x" } as never] })).not.toThrow();
      expect(() => lintRenderedHead(null as never)).not.toThrow();
      expect(lintRenderedHead({ siteName: " ", pages: [] })).toEqual([{ rule: "input-invalid", path: "input" }]);
      expect(lintRenderedHead({ siteName: SITE, pages: "no" as never })).toEqual([{ rule: "input-invalid", path: "input" }]);
    });

    it("keys a page with an unusable route on its index, not on the value", () => {
      const findings = lintRenderedHead({ siteName: SITE, pages: [{ path: `https://${MARKER_URL}`, html: "" }] });
      expect(findings[0]).toEqual({ rule: "head-missing", path: "pages[0]#title" });
    });
  });
});
