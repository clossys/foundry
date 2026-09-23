import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOKENS } from "@clossys/designer/tokens";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "./cli.js";
import {
  BRAND_GUIDE_FILENAME,
  PREVIEW_GALLERY_FILENAME,
  SYSTEM_AUDIT_FILENAME,
  buildMinimalBrandCssFromTokens,
  writePreviewGallery,
} from "./render-preview-gallery.js";
import { LAUNCH_PACK_INDEX_FILENAME } from "./render-launch-pack-gallery.js";

let dir: string;

function writeBrandCss(content: string, name = "brand.css"): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

const MASTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>`;

function writeCompleteRoster(name = "roster.json"): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    JSON.stringify([
      { role: "favicon-svg", src: MASTER_SVG, width: 0, height: 0, alt: "Fixture mark" },
      { role: "favicon-32", src: "/favicon-32.png", width: 32, height: 32, alt: "Fixture mark" },
      { role: "apple-touch-180", src: "/apple-touch.png", width: 180, height: 180, alt: "Fixture mark" },
      { role: "maskable-192", src: "/maskable-192.png", width: 192, height: 192, alt: "Fixture mark" },
      { role: "maskable-512", src: "/maskable-512.png", width: 512, height: 512, alt: "Fixture mark" },
      { role: "open-graph", src: "/og.png", width: 1200, height: 630, alt: "Fixture mark" },
      { role: "twitter-image", src: "/twitter.png", width: 1200, height: 630, alt: "Fixture mark" },
      { role: "email-png", src: "/email.png", width: 600, height: 200, alt: "Fixture mark" },
    ]),
  );
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "publisher-launch-pack-preview-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const EXPECTED_SITE_FILES = ["site-home.html", "site-about.html", "site-contact.html", "site-privacy.html", "site-terms.html", "site-not-found.html"];
const EXPECTED_MATERIALS_FILES = [
  "materials-overview-short.html",
  "materials-overview-medium.html",
  "materials-overview-long.html",
  "materials-pitch-deck.html",
  "materials-pitch-deck-partner.html",
  "materials-index.html",
];
const EXPECTED_EMAIL_FILES = ["email-launch-announcement.html", "email-welcome.html", "email-follow-up.html", "email-signature.html"];

describe("writePreviewGallery — every section renders", () => {
  it("writes the web-view gallery, every site page, every materials page, every email, and every card", () => {
    const brandPath = writeBrandCss(buildMinimalBrandCssFromTokens({ TOKENS }));
    const outDir = join(dir, "out");
    const result = writePreviewGallery({ brandCssPath: brandPath, outputDir: outDir });

    expect(existsSync(join(outDir, PREVIEW_GALLERY_FILENAME))).toBe(true);

    for (const file of EXPECTED_SITE_FILES) {
      expect(existsSync(join(outDir, file))).toBe(true);
    }
    for (const file of EXPECTED_MATERIALS_FILES) {
      expect(existsSync(join(outDir, file))).toBe(true);
    }
    for (const file of EXPECTED_EMAIL_FILES) {
      expect(existsSync(join(outDir, file))).toBe(true);
    }

    // Cards: one .svg per channel-spec image, the OG card, and the three
    // video-call backgrounds — checked by count and a sample, not every
    // filename, since the full list is generated from the channel-spec
    // registry (see fixture-cards.ts).
    const cardFiles = readdirSync(outDir).filter((name) => name.startsWith("cards-") && name.endsWith(".svg"));
    expect(cardFiles.length).toBeGreaterThan(15);
    expect(cardFiles).toContain("cards-og-share-card.svg");
    expect(cardFiles).toContain("cards-linkedin-avatar.svg");
    expect(cardFiles).toContain("cards-videocall-zoom.svg");
    for (const file of cardFiles) {
      const svg = readFileSync(join(outDir, file), "utf8");
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
    }

    // Sanity: fixture copy actually reached the rendered markup, not just a filename.
    expect(readFileSync(join(outDir, "site-home.html"), "utf8")).toContain("Everything your launch needs, out of the box");
    expect(readFileSync(join(outDir, "materials-overview-short.html"), "utf8")).toContain("One-liner");
    expect(readFileSync(join(outDir, "materials-pitch-deck.html"), "utf8")).toContain("Pitch deck");
    // The email's own HTML is embedded inside an `iframe[srcdoc]` attribute,
    // so its `&`/`'` get attribute-escaped once more on top of
    // `renderEmailDocument`'s own HTML escaping; the plain-text alternative
    // (shown unescaped in a `<pre>`) is the reliable place to assert the
    // resolved copy actually reached the page.
    expect(readFileSync(join(outDir, "email-launch-announcement.html"), "utf8")).toContain("We're live");
    expect(readFileSync(join(outDir, "email-signature.html"), "utf8")).toContain("Jordan Rivera");

    expect(existsSync(result.indexPath)).toBe(true);
  });

  it("the partner pitch-deck variant has fewer slides than the default deck (audience filtering actually ran)", () => {
    const brandPath = writeBrandCss(buildMinimalBrandCssFromTokens({ TOKENS }));
    const outDir = join(dir, "out");
    writePreviewGallery({ brandCssPath: brandPath, outputDir: outDir });
    const defaultDeck = readFileSync(join(outDir, "materials-pitch-deck.html"), "utf8");
    const partnerDeck = readFileSync(join(outDir, "materials-pitch-deck-partner.html"), "utf8");
    const countSlides = (html: string) => (html.match(/class="materials-slide"/g) ?? []).length;
    expect(countSlides(partnerDeck)).toBeLessThan(countSlides(defaultDeck));
  });
});

describe("writePreviewGallery — index.html links every file written", () => {
  it("links every file writePreviewGallery reports, without a roster", () => {
    const brandPath = writeBrandCss(buildMinimalBrandCssFromTokens({ TOKENS }));
    const outDir = join(dir, "out");
    const result = writePreviewGallery({ brandCssPath: brandPath, outputDir: outDir });
    const indexHtml = readFileSync(result.indexPath, "utf8");

    for (const file of result.writtenFiles) {
      if (file === LAUNCH_PACK_INDEX_FILENAME) continue;
      expect(indexHtml, `index.html should link ${file}`).toContain(`href="${file}"`);
    }
    // Every written, linkable file must actually exist on disk.
    for (const file of result.writtenFiles) {
      expect(existsSync(join(outDir, file))).toBe(true);
    }
  });

  it("also links guide.html and audit.html when a roster is given", () => {
    const brandPath = writeBrandCss(buildMinimalBrandCssFromTokens({ TOKENS }));
    const rosterPath = writeCompleteRoster();
    const outDir = join(dir, "out");
    const result = writePreviewGallery({ brandCssPath: brandPath, outputDir: outDir, rosterPath });
    const indexHtml = readFileSync(result.indexPath, "utf8");
    expect(indexHtml).toContain(`href="${BRAND_GUIDE_FILENAME}"`);
    expect(indexHtml).toContain(`href="${SYSTEM_AUDIT_FILENAME}"`);
    expect(result.writtenFiles).toContain(BRAND_GUIDE_FILENAME);
    expect(result.writtenFiles).toContain(SYSTEM_AUDIT_FILENAME);
  });
});

describe("publisher-preview main — brand-coverage failure writes nothing", () => {
  it("returns 1 and writes no output directory at all when brand coverage fails", () => {
    const brandPath = writeBrandCss("/* empty */\n");
    const outDir = join(dir, "out-fail");
    expect(main([brandPath, outDir])).toBe(1);
    expect(existsSync(outDir)).toBe(false);
  });

  it("writePreviewGallery itself throws before creating outputDir on brand-coverage failure", () => {
    const brandPath = writeBrandCss("/* empty */\n");
    const outDir = join(dir, "out-fail-direct");
    expect(() => writePreviewGallery({ brandCssPath: brandPath, outputDir: outDir })).toThrow();
    expect(existsSync(outDir)).toBe(false);
  });
});

describe("writePreviewGallery — deterministic output", () => {
  it("produces byte-identical files across two independent runs with identical inputs", () => {
    const brandPath = writeBrandCss(buildMinimalBrandCssFromTokens({ TOKENS }));
    const rosterPath = writeCompleteRoster();

    const outDirA = join(dir, "out-a");
    const outDirB = join(dir, "out-b");
    const resultA = writePreviewGallery({ brandCssPath: brandPath, outputDir: outDirA, rosterPath });
    const resultB = writePreviewGallery({ brandCssPath: brandPath, outputDir: outDirB, rosterPath });

    expect(resultA.writtenFiles).toEqual(resultB.writtenFiles);
    for (const file of resultA.writtenFiles) {
      const contentA = readFileSync(join(outDirA, file), "utf8");
      const contentB = readFileSync(join(outDirB, file), "utf8");
      expect(contentA, `${file} should be byte-identical across runs`).toBe(contentB);
    }
  });
});
