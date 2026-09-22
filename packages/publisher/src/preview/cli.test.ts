import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOKENS } from "@clossys/designer/tokens";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./cli.js";
import { BRAND_GUIDE_FILENAME, PREVIEW_GALLERY_FILENAME, SYSTEM_AUDIT_FILENAME, buildMinimalBrandCssFromTokens } from "./render-preview-gallery.js";
import { CERTIFICATION_FIXTURE_COPY } from "./certification-fixtures.js";

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
  dir = mkdtempSync(join(tmpdir(), "publisher-preview-cli-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("publisher-preview main — argument handling", () => {
  it("--help returns 0", () => {
    expect(main(["--help"])).toBe(0);
  });

  it("throws CliInputError when arguments are missing", () => {
    expect(() => main([])).toThrow(CliInputError);
    expect(() => main([join(dir, "brand.css")])).toThrow(CliInputError);
  });

  it("throws CliInputError when brand.css does not exist", () => {
    expect(() => main([join(dir, "missing.css"), dir])).toThrow(CliInputError);
  });
});

describe("publisher-preview main — brand coverage gate", () => {
  it("writes gallery.html when brand.css passes coverage", () => {
    const brandPath = writeBrandCss(buildMinimalBrandCssFromTokens({ TOKENS }));
    const outDir = join(dir, "out");
    expect(main([brandPath, outDir])).toBe(0);
    const galleryPath = join(outDir, PREVIEW_GALLERY_FILENAME);
    expect(existsSync(galleryPath)).toBe(true);
    const html = readFileSync(galleryPath, "utf8");
    expect(html).toContain("MarketingView");
    expect(html).toContain("SectionedView");
    expect(html).toContain("AuthView");
    expect(html).toContain("CollectionView");
  });

  it("returns 1 and does not write gallery.html when coverage fails", () => {
    const brandPath = writeBrandCss("/* empty */\n");
    const outDir = join(dir, "out-fail");
    expect(main([brandPath, outDir])).toBe(1);
    expect(existsSync(join(outDir, PREVIEW_GALLERY_FILENAME))).toBe(false);
  });
});

describe("publisher-preview main — optional brand-asset roster (issue #1111)", () => {
  it("also writes guide.html and audit.html when a complete roster is given", () => {
    const brandPath = writeBrandCss(buildMinimalBrandCssFromTokens({ TOKENS }));
    const rosterPath = writeCompleteRoster();
    const outDir = join(dir, "out");
    expect(main([brandPath, outDir, rosterPath])).toBe(0);
    const guide = readFileSync(join(outDir, BRAND_GUIDE_FILENAME), "utf8");
    const audit = readFileSync(join(outDir, SYSTEM_AUDIT_FILENAME), "utf8");
    expect(guide).toContain(CERTIFICATION_FIXTURE_COPY.guideTitle);
    expect(guide).toContain(CERTIFICATION_FIXTURE_COPY.factValue);
    expect(guide).toContain("apple-touch-180");
    expect(audit).toContain(CERTIFICATION_FIXTURE_COPY.auditTitle);
    expect(audit).toContain(PREVIEW_GALLERY_FILENAME);
  });

  it("returns 1 and writes no HTML when the roster is incomplete", () => {
    const brandPath = writeBrandCss(buildMinimalBrandCssFromTokens({ TOKENS }));
    const rosterPath = join(dir, "roster.json");
    writeFileSync(rosterPath, JSON.stringify([{ role: "favicon-svg", src: MASTER_SVG, width: 0, height: 0, alt: "Fixture mark" }]));
    const outDir = join(dir, "out-incomplete-roster");
    expect(main([brandPath, outDir, rosterPath])).toBe(1);
    expect(existsSync(join(outDir, PREVIEW_GALLERY_FILENAME))).toBe(false);
    expect(existsSync(join(outDir, BRAND_GUIDE_FILENAME))).toBe(false);
  });

  it("throws CliInputError when roster.json does not exist", () => {
    const brandPath = writeBrandCss(buildMinimalBrandCssFromTokens({ TOKENS }));
    const outDir = join(dir, "out");
    expect(() => main([brandPath, outDir, join(dir, "missing-roster.json")])).toThrow(CliInputError);
  });
});
