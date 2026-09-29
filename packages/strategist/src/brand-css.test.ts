import { describe, expect, it } from "vitest";
import { BRAND_CSS_SEGMENTS, extractBrandCssSlots } from "./brand-css.js";

describe("BRAND_CSS_SEGMENTS", () => {
  it("names brand/brand.css", () => {
    expect([...BRAND_CSS_SEGMENTS]).toEqual(["brand", "brand.css"]);
  });
});

describe("extractBrandCssSlots", () => {
  it("collects each declared custom property once, in source order, at any depth", () => {
    const css = ":root { --a: 1; --b: 2; }\n@media (prefers-color-scheme: dark) { :root { --b: 3; --c: 4; } }";
    expect(extractBrandCssSlots(css)).toEqual(["--a", "--b", "--c"]);
  });

  it("does not collect var() uses, only declarations", () => {
    const css = ":root { --a: 1; --b: var(--a, 0); color: var(--c, red); border: 1px solid var(--d, var(--e, 0)); }";
    expect(extractBrandCssSlots(css)).toEqual(["--a", "--b"]);
  });

  it("collects declarations under a :root[data-brand-bound] selector and ignores attribute selectors", () => {
    const css = ':root[data-brand-bound] { --a: 1; }\n[data-brand-bound="--x: y"] { --b: 2; }\n:root[data-brand-bound="true"] > .card { color: red; }';
    expect(extractBrandCssSlots(css)).toEqual(["--a", "--b"]);
  });

  it("ignores custom-property text inside quoted strings", () => {
    const css = [
      ':root { --a: 1; }',
      '.x::before { content: " --not-a-slot: 1"; }',
      ".y::after { content: ' ; --also-not: 2'; }",
      '.z { background: url("a.png;--nor-this:1"); }',
    ].join("\n");
    expect(extractBrandCssSlots(css)).toEqual(["--a"]);
  });

  it("ignores custom-property text inside comments, including a comment marker inside a string", () => {
    const css = ':root { /* --a: 1; */ --b: 2; }\n.q::before { content: "/*"; }\n:root { --c: 3; }\n.r::before { content: "*/"; }';
    expect(extractBrandCssSlots(css)).toEqual(["--b", "--c"]);
  });

  it("collects non-ASCII and escaped custom-property names", () => {
    const css = ":root { --\u00fcmlaut: 1; --a\\:b: 2; --caf\u00e9-\u30c6: 3; --plain_1: 4; }";
    expect(extractBrandCssSlots(css)).toEqual(["--\u00fcmlaut", "--a\\:b", "--caf\u00e9-\u30c6", "--plain_1"]);
  });

  it("does not count a name that follows an opening parenthesis, with or without a space", () => {
    const css = [
      "@supports (--a: 1) { :root { --b: 2; } }",
      "@supports ( --c: 1 ) { :root { --d: 2; } }",
      "@container style(--e: x) { .x { color: red; } }",
      "@container style(  --f: x ) { .x { color: red; } }",
      "@container style(\n  --g: x) { .x { color: red; } }",
    ].join("\n");
    expect(extractBrandCssSlots(css)).toEqual(["--b", "--d"]);
  });

  it("leaves an unterminated comment as text, so declarations after it are still collected", () => {
    expect(extractBrandCssSlots(":root { --a: 1; } /* never closed\n:root { --b: 2; }")).toEqual(["--a", "--b"]);
  });

  it("leaves an unterminated string as text, so declarations after it are still collected", () => {
    expect(extractBrandCssSlots(':root { --a: 1; content: "never closed; --b: 2; }')).toEqual(["--a", "--b"]);
  });

  it("returns an empty list for a stylesheet declaring no custom properties", () => {
    expect(extractBrandCssSlots("body { color: red; }")).toEqual([]);
    expect(extractBrandCssSlots("")).toEqual([]);
  });

  describe("hostile input", () => {
    const N = 100_000;
    const BOUND_MS = 1000;
    const timed = (css: string): { slots: string[]; ms: number } => {
      const start = performance.now();
      const slots = extractBrandCssSlots(css);
      return { slots, ms: performance.now() - start };
    };

    it("runs in linear time on a comment opener followed by many repeated openers", () => {
      const { slots, ms } = timed("/*" + "a/*".repeat(N / 3) + "\n:root { --a: 1; }");
      expect(ms).toBeLessThan(BOUND_MS);
      expect(slots).toEqual(["--a"]);
    });

    it("runs in linear time on a double quote followed by many escaped double quotes", () => {
      const { slots, ms } = timed('"' + '\\"'.repeat(N / 2) + "\n:root { --a: 1; }");
      expect(ms).toBeLessThan(BOUND_MS);
      expect(slots).toEqual(["--a"]);
    });

    it("runs in linear time on a single quote followed by many escaped single quotes", () => {
      const { slots, ms } = timed("'" + "\\'".repeat(N / 2) + "\n:root { --a: 1; }");
      expect(ms).toBeLessThan(BOUND_MS);
      expect(slots).toEqual(["--a"]);
    });

    it("runs in linear time on many unterminated openers of every kind", () => {
      const { ms } = timed("/*'\"".repeat(N / 4));
      expect(ms).toBeLessThan(BOUND_MS);
    });

    it("runs in linear time on a long run of escaped name characters", () => {
      const { ms } = timed("--a\\ ".repeat(N / 5));
      expect(ms).toBeLessThan(BOUND_MS);
    });

    it("runs in linear time on a long run of whitespace before a parenthesis check", () => {
      const { slots, ms } = timed("(" + " ".repeat(N) + "--a: 1");
      expect(ms).toBeLessThan(BOUND_MS);
      expect(slots).toEqual([]);
    });
  });

  it("keeps scanning after an unterminated comment, so a string after it still hides its contents", () => {
    expect(extractBrandCssSlots('/* open\n.x { content: "--hidden: 1"; } :root { --a: 1; }')).toEqual(["--a"]);
  });

  it("closes a string at an unescaped quote and honours a backslash-escaped quote inside it", () => {
    const css = '.x { content: "a\\"--hidden: 1"; } :root { --a: 1; } .y { content: \'it\\\'s\'; --b: 2; }';
    expect(extractBrandCssSlots(css)).toEqual(["--a", "--b"]);
  });

  it("does not treat a comment closer that overlaps its opener as a terminator", () => {
    expect(extractBrandCssSlots("/*/ --a: 1; */ :root { --b: 2; }")).toEqual(["--b"]);
  });
});
