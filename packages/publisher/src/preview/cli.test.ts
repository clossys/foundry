import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOKENS } from "@clossys/designer/tokens";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliInputError, main } from "./cli.js";
import { PREVIEW_GALLERY_FILENAME, buildMinimalBrandCssFromTokens } from "./render-preview-gallery.js";

let dir: string;

function writeBrandCss(content: string, name = "brand.css"): string {
  const path = join(dir, name);
  writeFileSync(path, content);
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
