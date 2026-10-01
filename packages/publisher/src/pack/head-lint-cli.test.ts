import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./head-lint-cli.js";

const TIMEOUT = { timeout: 10_000 };
const SITE = "Example Co";
const ORIGIN = "https://example.test";

function page(route: string, title: string, overrides: { omit?: string } = {}): string {
  const metas = [
    ["description", "A fictional description."],
    ["robots", "index, follow"],
    ["theme-color", "#112233"],
    ["og:title", title],
    ["og:description", "A fictional description."],
    ["og:url", `${ORIGIN}${route}`],
    ["og:image", `${ORIGIN}/share.png`],
    ["og:site_name", SITE],
    ["twitter:card", "summary"],
    ["twitter:title", title],
    ["twitter:image", `${ORIGIN}/share.png`],
  ]
    .filter(([tag]) => tag !== overrides.omit)
    .map(([tag, content]) => `<meta name="${tag}" content="${content}">`)
    .join("");
  return `<!doctype html><html><head><title>${title}</title><link rel="canonical" href="${ORIGIN}${route}">${metas}</head><body></body></html>`;
}

function listing(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: false }).map(String).sort();
}

describe("publisher-head-lint cli", () => {
  let dir: string;
  let out: string[];
  let err: string[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "head-lint-"));
    out = [];
    err = [];
    vi.spyOn(console, "log").mockImplementation((...values: unknown[]) => void out.push(values.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...values: unknown[]) => void err.push(values.join(" ")));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  function writeSite(): void {
    writeFileSync(join(dir, "index.html"), page("/", `${SITE} · A fictional tagline`));
    writeFileSync(join(dir, "about.html"), page("/about", `About · ${SITE}`));
    mkdirSync(join(dir, "team"));
    writeFileSync(join(dir, "team", "index.html"), page("/team", `Team · ${SITE}`));
    writeFileSync(join(dir, "notes.txt"), "not a page");
  }

  describe("exit codes", () => {
    it("exits 0 for a clean site, mapping index.html to its directory route, and writes nothing", TIMEOUT, () => {
      writeSite();
      const before = listing(dir);
      const contents = readFileSync(join(dir, "index.html"), "utf8");
      expect(main([dir, "--site-name", SITE])).toBe(0);
      expect(out.join("\n")).toContain("3 page(s)");
      expect(listing(dir)).toEqual(before);
      expect(readFileSync(join(dir, "index.html"), "utf8")).toBe(contents);
    });

    it("exits 1 and prints one rule and route per finding for a bad page", TIMEOUT, () => {
      writeSite();
      writeFileSync(join(dir, "about.html"), page("/about", `About | ${SITE}`, { omit: "og:image" }));
      const before = listing(dir);
      expect(main([dir, "--site-name", SITE])).toBe(1);
      expect(out).toEqual(["head-missing /about#og:image", "title-separator /about"]);
      expect(listing(dir)).toEqual(before);
    });

    it("exits 2 for a missing directory, an empty directory, a file, and a missing or blank --site-name", TIMEOUT, () => {
      expect(main([join(dir, "nope"), "--site-name", SITE])).toBe(2);
      expect(main([dir, "--site-name", SITE])).toBe(2);
      writeFileSync(join(dir, "x.html"), page("/x", `X · ${SITE}`));
      expect(main([join(dir, "x.html"), "--site-name", SITE])).toBe(2);
      expect(main([dir])).toBe(2);
      expect(main([dir, "--site-name", "  "])).toBe(2);
      expect(main([dir, "--site-name"])).toBe(2);
      expect(main([dir, "--site-name", "-h"])).toBe(2);
      expect(main(["--site-name", SITE])).toBe(2);
      expect(main([dir, dir, "--site-name", SITE])).toBe(2);
      expect(main([dir, "--site-name", SITE, "--bogus"])).toBe(2);
      expect(main([dir, "--site-name", SITE, "--site-name", SITE])).toBe(2);
      expect(out).toEqual([]);
      expect(err.length).toBeGreaterThan(0);
    });

    it("exits 0 for --help and prints usage", TIMEOUT, () => {
      expect(main(["--help"])).toBe(0);
      expect(out.join("\n")).toContain("publisher-head-lint <html-dir> --site-name <name>");
      expect(main([dir, "-h"])).toBe(0);
    });
  });

  describe("route mapping", () => {
    it("maps index.html to / and not /index", TIMEOUT, () => {
      // The home title form is only valid on route "/"; on "/index" it would be read as a label and refused.
      writeFileSync(join(dir, "index.html"), page("/", `${SITE} · A fictional tagline`));
      expect(main([dir, "--site-name", SITE])).toBe(0);
    });

    it("maps a nested index.html and a nested a.html to their routes", TIMEOUT, () => {
      writeFileSync(join(dir, "index.html"), page("/", `${SITE} · A fictional tagline`));
      mkdirSync(join(dir, "docs"));
      writeFileSync(join(dir, "docs", "index.html"), page("/docs", `Docs · ${SITE}`, { omit: "og:url" }));
      writeFileSync(join(dir, "docs", "intro.html"), page("/docs/intro", `Intro · ${SITE}`, { omit: "og:image" }));
      expect(main([dir, "--site-name", SITE])).toBe(1);
      expect(out).toEqual(["head-missing /docs#og:url", "head-missing /docs/intro#og:image"]);
    });
  });

  it("percent-encodes file names into routes", TIMEOUT, () => {
    writeFileSync(join(dir, "index.html"), page("/", `${SITE} · A fictional tagline`));
    writeFileSync(join(dir, "C#.html"), page("/C%23", `C# · ${SITE}`));
    writeFileSync(join(dir, "a b.html"), page("/a%20b", `Spaced · ${SITE}`, { omit: "og:image" }));
    expect(main([dir, "--site-name", SITE])).toBe(1);
    expect(out).toEqual(["head-missing /a%20b#og:image"]);
  });

  it("skips symbolic links", TIMEOUT, () => {
    writeFileSync(join(dir, "index.html"), page("/", `${SITE} · A fictional tagline`));
    const outside = mkdtempSync(join(tmpdir(), "head-lint-outside-"));
    try {
      writeFileSync(join(outside, "bad.html"), "<html></html>");
      symlinkSync(join(outside, "bad.html"), join(dir, "linked.html"));
      symlinkSync(outside, join(dir, "linked-dir"));
      expect(main([dir, "--site-name", SITE])).toBe(0);
      expect(out.join("\n")).toContain("1 page(s)");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
