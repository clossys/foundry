import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TOKENS } from "@clossys/designer/tokens";
import { main } from "./preview-cli.js";
import { CERTIFICATION_FIXTURE_COPY } from "./certification-fixtures.js";

const MASTER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>`;

function filledBrandCss(): string {
  const body = Object.values(TOKENS)
    .filter((token) => token.brandable)
    .map((token) => `${token.property}: red;`)
    .join("\n");
  return `:root {\n${body}\n}\n`;
}

function rosterJson(): string {
  return JSON.stringify([
    { role: "favicon-svg", src: MASTER, width: 0, height: 0, alt: "Fixture mark" },
    { role: "favicon-32", src: "/favicon-32.png", width: 32, height: 32, alt: "Fixture mark" },
    { role: "apple-touch-180", src: "/apple-touch.png", width: 180, height: 180, alt: "Fixture mark" },
    { role: "maskable-192", src: "/maskable-192.png", width: 192, height: 192, alt: "Fixture mark" },
    { role: "maskable-512", src: "/maskable-512.png", width: 512, height: 512, alt: "Fixture mark" },
    { role: "open-graph", src: "/og.png", width: 1200, height: 630, alt: "Fixture mark" },
    { role: "twitter-image", src: "/twitter.png", width: 1200, height: 630, alt: "Fixture mark" },
    { role: "email-png", src: "/email.png", width: 600, height: 200, alt: "Fixture mark" },
  ]);
}

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("publisher-preview", () => {
  it("writes the guide and the audit from a filled brand.css and a complete roster", () => {
    dir = mkdtempSync(join(tmpdir(), "publisher-preview-"));
    const brand = join(dir, "brand.css");
    const roster = join(dir, "roster.json");
    const out = join(dir, "out");
    writeFileSync(brand, filledBrandCss());
    writeFileSync(roster, rosterJson());
    expect(main(["--brand", brand, "--roster", roster, "--out", out])).toBe(0);
    const guide = readFileSync(join(out, "guide.html"), "utf8");
    const audit = readFileSync(join(out, "audit.html"), "utf8");
    expect(guide).toContain(CERTIFICATION_FIXTURE_COPY.guideTitle);
    expect(guide).toContain(CERTIFICATION_FIXTURE_COPY.factValue);
    expect(guide).toContain("apple-touch-180");
    expect(audit).toContain(CERTIFICATION_FIXTURE_COPY.auditTitle);
    expect(audit).toContain("gallery.html");
  });

  it("does not write pages when brand.css fails coverage", () => {
    dir = mkdtempSync(join(tmpdir(), "publisher-preview-"));
    const brand = join(dir, "brand.css");
    const roster = join(dir, "roster.json");
    const out = join(dir, "out");
    writeFileSync(brand, ":root { --color-ink-primary: oklch(0.2 0 0); }\n");
    writeFileSync(roster, rosterJson());
    expect(main(["--brand", brand, "--roster", roster, "--out", out])).toBe(1);
    expect(existsSync(join(out, "guide.html"))).toBe(false);
    expect(existsSync(join(out, "audit.html"))).toBe(false);
  });
});
