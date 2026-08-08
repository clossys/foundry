import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseBrandDeclarations, readBrandCss } from "./read-brand-css.js";

describe("parseBrandDeclarations — the four shapes it must handle", () => {
  it("a bare :root block", () => {
    const { declarations, unchecked } = parseBrandDeclarations(`
      :root {
        --color-surface-base: oklch(0.97 0 0);
        --color-ink-primary: oklch(0.22 0 0);
      }
    `);
    expect(declarations).toEqual({
      "--color-surface-base": "oklch(0.97 0 0)",
      "--color-ink-primary": "oklch(0.22 0 0)",
    });
    expect(unchecked).toEqual([]);
  });

  it("multiple selectors, each contributing declarations", () => {
    const { declarations } = parseBrandDeclarations(`
      :root[data-brand-bound] {
        --color-accent: #2a78d6;
      }
      :root[data-brand-bound][data-theme="dark"] {
        --color-accent: #6da7ec;
      }
    `);
    // last-declaration-wins, in source order — see this file's own module
    // doc comment for why that simplification is fine for this reader.
    expect(declarations["--color-accent"]).toBe("#6da7ec");
  });

  it("comments are stripped and never mistaken for declarations", () => {
    const { declarations } = parseBrandDeclarations(`
      :root {
        /* --color-ink-muted: this is just documentation, not live */
        --color-accent: #2a78d6; /* inline comment after a real declaration */
      }
    `);
    expect(declarations).toEqual({ "--color-accent": "#2a78d6" });
    expect(declarations["--color-ink-muted"]).toBeUndefined();
  });

  it("a declaration nested inside @media", () => {
    const { declarations } = parseBrandDeclarations(`
      @media (prefers-color-scheme: dark) {
        :root[data-brand-bound]:not([data-theme="light"]) {
          --color-surface-base: #1a1a1a;
        }
      }
    `);
    expect(declarations).toEqual({ "--color-surface-base": "#1a1a1a" });
  });

  it("a multi-line declaration value", () => {
    const { declarations } = parseBrandDeclarations(`
      :root {
        --ui-elevation-raised:
          0 1px 0
          rgba(0, 0, 0, 0.1);
      }
    `);
    expect(declarations["--ui-elevation-raised"]).toBe("0 1px 0\n          rgba(0, 0, 0, 0.1)");
  });

  it("the real brand-template.css shape: three selector blocks (light, @media dark, explicit dark), each with required-but-empty slots and commented-out optional ones", () => {
    const { declarations, unchecked } = parseBrandDeclarations(`
      :root[data-brand-bound] {
        --color-surface-base:            ;
        /* --ui-icon-stroke: 2; */
      }
      @media (prefers-color-scheme: dark) {
        :root[data-brand-bound]:not([data-theme="light"]) {
          --color-surface-base:            ;
        }
      }
      :root[data-brand-bound][data-theme="dark"] {
        --color-surface-base:            ;
      }
    `);
    expect(declarations["--color-surface-base"]).toBe("");
    expect(declarations["--ui-icon-stroke"]).toBeUndefined(); // commented out, never live
    expect(unchecked).toEqual([]);
  });
});

describe("parseBrandDeclarations — never drops what it cannot parse", () => {
  it("an unterminated rule block is reported as unchecked, not silently ignored", () => {
    const { declarations, unchecked } = parseBrandDeclarations(`
      :root {
        --color-accent: #2a78d6;
    `); // missing closing "}"
    expect(declarations).toEqual({});
    expect(unchecked).toHaveLength(1);
    expect(unchecked[0]!.detail).toMatch(/no matching/);
  });

  it("a malformed declaration (no colon) is reported as unchecked", () => {
    const { unchecked } = parseBrandDeclarations(`
      :root {
        --color-accent #2a78d6;
        --font-body: Inter, sans-serif;
      }
    `);
    expect(unchecked.some((u) => u.detail.includes("--color-accent"))).toBe(true);
  });

  it("unchecked entries carry an accurate line number", () => {
    const { unchecked } = parseBrandDeclarations(
      ["", ":root {", "  --broken-one no-colon;", "}"].join("\n"),
    );
    expect(unchecked).toHaveLength(1);
    expect(unchecked[0]!.line).toBe(3);
  });

  it("an unterminated comment does NOT yield a declaration from inside it, and IS reported as unchecked — regression for the false-pass a real browser would never produce", () => {
    // Exact repro: everything from "/*" onward has no closing "*/", so a
    // real browser treats the rest of the file — including the
    // "declaration" and the closing "}" — as comment content that does not
    // exist. The pre-fix version of this reader extracted
    // "--color-surface-base": "#fff" as a live declaration here and
    // reported zero `unchecked` — a silent false PASS: a consumer who
    // forgot the closing "*/" would have been told the slot was covered
    // when the browser ignores it entirely.
    const { declarations, unchecked } = parseBrandDeclarations(
      ":root { /* --color-surface-base: #fff; }",
    );
    expect(declarations).toEqual({});
    expect(unchecked.length).toBeGreaterThan(0);
    expect(unchecked.some((u) => u.detail.includes("unterminated comment"))).toBe(true);
  });

  it("mirror case: an unterminated comment starting MID-VALUE is caught the same way", () => {
    const { declarations, unchecked } = parseBrandDeclarations(
      ":root {\n  --accent: red /* oops, forgot to close\n}\n",
    );
    expect(declarations).toEqual({});
    expect(unchecked.some((u) => u.detail.includes("unterminated comment"))).toBe(true);
  });

  it("mirror case: a comment mid-value that IS properly terminated parses the declaration normally (no false negative)", () => {
    const { declarations, unchecked } = parseBrandDeclarations(
      ":root { --accent: red /* TODO: pick real brand red */; }",
    );
    expect(declarations).toEqual({ "--accent": "red" });
    expect(unchecked).toEqual([]);
  });

  it("mirror case: a correctly-terminated comment containing a literal `}` does not confuse brace matching", () => {
    const { declarations, unchecked } = parseBrandDeclarations(
      ":root { /* a comment with a } inside it */ --color-accent: red; }",
    );
    expect(declarations).toEqual({ "--color-accent": "red" });
    expect(unchecked).toEqual([]);
  });
});

describe("readBrandCss — file I/O wrapper", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tokens-brand-css-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads and parses a real file", () => {
    const path = join(dir, "brand.css");
    writeFileSync(path, `:root { --color-accent: #2a78d6; }\n`);
    const result = readBrandCss(path);
    expect(result.complete).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.declarations).toEqual({ "--color-accent": "#2a78d6" });
  });

  it("a nonexistent file is reported as an issue, never a silent empty pass", () => {
    const result = readBrandCss(join(dir, "does-not-exist.css"));
    expect(result.complete).toBe(false);
    expect(result.issues).toEqual([{ reason: "unreadable", detail: expect.any(String) }]);
    expect(result.declarations).toEqual({});
  });
});
