import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractStyleCandidates,
  findEmbeddedStyleLiterals,
  isPureVarReference,
  resolveFallbackChain,
  scanStyleSources,
} from "./style-scan.js";

// Hermetic: `extractStyleCandidates` tests operate on plain in-memory
// strings (zero I/O); `scanStyleSources` tests operate on their own
// `mkdtemp` directory, removed afterward. Nothing here scans this
// repository's own source.

describe("extractStyleCandidates — true positives (the gate CAN fire)", () => {
  it("a hex color in a plain string literal is a candidate", () => {
    const { candidates } = extractStyleCandidates('export const X = "#3b82f6";\n', "x.ts");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: "hex-color", raw: "#3b82f6", value: "#3b82f6", line: 1 });
  });

  it("an 8-digit (alpha) hex color is a candidate", () => {
    const { candidates } = extractStyleCandidates('const c = "#3b82f6ff";\n', "x.ts");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: "hex-color", raw: "#3b82f6ff" });
  });

  it("a raw hex color directly in .tsx source (not just chart-vars-style constants) is a candidate", () => {
    const { candidates } = extractStyleCandidates('<div style={{ color: "#fff" }} />;\n', "Thing.tsx");
    expect(candidates.some((c) => c.kind === "hex-color" && c.raw === "#fff")).toBe(true);
  });

  it('style={{ padding: "13px" }} — a raw length inside an inline style object — is a candidate', () => {
    const { candidates } = extractStyleCandidates('<div style={{ padding: "13px" }} />;\n', "Thing.tsx");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: "raw-length", raw: "13px" });
  });

  it("an oklch() color function literal is a candidate", () => {
    const { candidates } = extractStyleCandidates('const c = "oklch(0.4748 0 0)";\n', "x.ts");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: "color-function", raw: "oklch(0.4748 0 0)" });
  });

  it("an rgba() color function literal is a candidate", () => {
    const { candidates } = extractStyleCandidates('const c = "rgba(0, 0, 0, 0.10)";\n', "x.ts");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: "color-function", raw: "rgba(0, 0, 0, 0.10)" });
  });

  it("bg-[#3b82f6] — a Tailwind arbitrary hex value — is a tw-arbitrary candidate, not also a bare hex-color candidate", () => {
    const { candidates } = extractStyleCandidates('<div className="bg-[#3b82f6]" />;\n', "Thing.tsx");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: "tw-arbitrary", raw: "bg-[#3b82f6]", value: "#3b82f6" });
  });

  it("p-[13px] and text-[17px] are tw-arbitrary candidates", () => {
    const { candidates } = extractStyleCandidates('<div className="p-[13px] text-[17px]" />;\n', "Thing.tsx");
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.raw).sort()).toEqual(["p-[13px]", "text-[17px]"]);
  });

  it("a var() reference WITH a literal fallback inside an arbitrary bracket is still a candidate (the fallback matters to the gate, not to extraction)", () => {
    const { candidates } = extractStyleCandidates(
      '<div className="w-[var(--ui-layout-sidebar-rail-w,64px)]" />;\n',
      "Shell.tsx",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: "tw-arbitrary", value: "var(--ui-layout-sidebar-rail-w,64px)" });
  });
});

describe("extractStyleCandidates — false-positive traps (the gate must NOT fire)", () => {
  it("a legitimate Tailwind token class is never a candidate", () => {
    const { candidates } = extractStyleCandidates('<div className="text-ink-primary bg-surface-base" />;\n', "Thing.tsx");
    expect(candidates).toEqual([]);
  });

  it("a z-10-style scale utility (no brackets, no hardcoded value) is never a candidate", () => {
    const { candidates } = extractStyleCandidates('<div className="z-10 p-4 rounded-control" />;\n', "Thing.tsx");
    expect(candidates).toEqual([]);
  });

  it("a bare number inside a non-style string is never a candidate", () => {
    const { candidates } = extractStyleCandidates('const msg = "revenue grew 42 percent this year";\n', "x.ts");
    expect(candidates).toEqual([]);
  });

  it('a version string like "1.0.0" is never a candidate', () => {
    const { candidates } = extractStyleCandidates('const VERSION = "1.0.0";\n', "x.ts");
    expect(candidates).toEqual([]);
  });

  it('viewBox="0 0 24 24" in an icon is never a candidate (bare numbers, no unit suffix)', () => {
    const { candidates } = extractStyleCandidates('<svg viewBox="0 0 24 24"><path d="M12 9v4" /></svg>;\n', "Icon.tsx");
    expect(candidates).toEqual([]);
  });

  it("an aria-* attribute value is excluded, even one shaped like a hex color", () => {
    const { candidates, excluded } = extractStyleCandidates('<Button aria-label="#face this" />;\n', "x.tsx");
    expect(candidates).toEqual([]);
    expect(excluded.some((e) => e.reason === "structural-or-a11y-attribute-value")).toBe(true);
  });

  it("a data-* attribute value is excluded", () => {
    const { candidates, excluded } = extractStyleCandidates('<div data-color="#123456" />;\n', "x.tsx");
    expect(candidates).toEqual([]);
    expect(excluded.some((e) => e.reason === "structural-or-a11y-attribute-value")).toBe(true);
  });

  it('href="#face" is excluded even though "face" is a valid hex run (structural attribute, not a color)', () => {
    const { candidates, excluded } = extractStyleCandidates('<a href="#face">jump</a>;\n', "x.tsx");
    expect(candidates).toEqual([]);
    expect(excluded).toEqual([{ file: "x.tsx", line: 1, raw: "#face", reason: "structural-or-a11y-attribute-value" }]);
  });

  it("a hex-shaped run inside a // line comment is excluded, not a candidate", () => {
    const { candidates, excluded } = extractStyleCandidates("// the brand color used to be #3b82f6\nconst x = 1;\n", "x.ts");
    expect(candidates).toEqual([]);
    expect(excluded).toEqual([{ file: "x.ts", line: 1, raw: "#3b82f6", reason: "comment" }]);
  });

  it("a raw-length-shaped run inside a /** JSDoc */ block comment is excluded, not a candidate — the real DataTable.tsx shape", () => {
    const src = '/** Fixed column width (`"120px"`, `"10rem"`, or a bare number of pixels). */\nexport type X = string;\n';
    const { candidates, excluded } = extractStyleCandidates(src, "DataTable.tsx");
    expect(candidates).toEqual([]);
    expect(excluded.filter((e) => e.reason === "comment").map((e) => e.raw).sort()).toEqual(["10rem", "120px"]);
  });

  it("// inside a real string (a URL) is never mistaken for a comment opener", () => {
    const src = 'const url = "https://example.com/#3b82f6-not-a-color-just-a-url-fragment";\n';
    const { candidates, excluded } = extractStyleCandidates(src, "x.ts");
    // The hex-shaped run after the URL's "#" IS still a real candidate here
    // — it is genuine string content, not a comment, and this scanner does
    // not attempt to recognize "this string looks like a URL" as its own
    // exclusion category (out of declared scope, matching this file's
    // stated boundary). What this test actually proves is narrower and
    // load-bearing: the "//" inside the URL must not be treated as a
    // comment opener that swallows the rest of the line.
    expect(excluded.every((e) => e.reason !== "comment")).toBe(true);
    expect(candidates.some((c) => c.raw === "#3b82f6")).toBe(true);
  });
});

describe("extractStyleCandidates — the waiver mechanism", () => {
  it("a token-gate:ignore marker on the candidate's own line sets hasIgnoreMarker", () => {
    const { candidates } = extractStyleCandidates('const c = "#3b82f6"; // token-gate:ignore deliberate\n', "x.ts");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.hasIgnoreMarker).toBe(true);
  });

  it("no marker present means hasIgnoreMarker is false", () => {
    const { candidates } = extractStyleCandidates('const c = "#3b82f6";\n', "x.ts");
    expect(candidates[0]?.hasIgnoreMarker).toBe(false);
  });

  it("a marker on a DIFFERENT line does not suppress a candidate on this line", () => {
    const src = "// token-gate:ignore applies only to its own line\nconst c = \"#3b82f6\";\n";
    const { candidates } = extractStyleCandidates(src, "x.ts");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.hasIgnoreMarker).toBe(false);
  });
});

describe("extractStyleCandidates — the unchecked path", () => {
  it("an arbitrary-value opener with no closing ']' before end of line is unchecked, not silently dropped", () => {
    const { candidates, unchecked } = extractStyleCandidates('<div className="bg-[#3b82f6" />;\n', "x.tsx");
    expect(candidates).toEqual([]);
    expect(unchecked).toHaveLength(1);
    expect(unchecked[0]).toMatchObject({ kind: "unterminated-tw-arbitrary" });
  });

  it("a color function whose parens never close is unchecked", () => {
    const { candidates, unchecked } = extractStyleCandidates('const c = "rgba(0, 0, 0";\n', "x.ts");
    expect(candidates).toEqual([]);
    expect(unchecked).toHaveLength(1);
    expect(unchecked[0]).toMatchObject({ kind: "unterminated-color-function" });
  });

  it("an invalid-length hex run (5 digits) is unchecked, not guessed at as a color", () => {
    const { candidates, unchecked } = extractStyleCandidates('const c = "#3b82f";\n', "x.ts");
    expect(candidates).toEqual([]);
    expect(unchecked).toHaveLength(1);
    expect(unchecked[0]).toMatchObject({ kind: "invalid-hex-length" });
  });

  it("real ui/src shape: content-['/'] (Breadcrumb.tsx/Table.tsx) extracts as a tw-arbitrary candidate — classification of its value shape is token-gate.ts's job, not this scanner's", () => {
    const { candidates } = extractStyleCandidates("<span className=\"not-last:after:content-['/']\" />;\n", "Breadcrumb.tsx");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ kind: "tw-arbitrary", value: "'/'" });
  });
});

describe("findEmbeddedStyleLiterals / isPureVarReference — the tw-arbitrary value-shape helpers token-gate.ts reuses", () => {
  it("finds a hex color embedded in a var() fallback, and resolves which property it is the fallback FOR", () => {
    const found = findEmbeddedStyleLiterals("var(--ui-layout-sidebar-rail-w,64px)");
    expect(found).toEqual([{ kind: "raw-length", raw: "64px", fallbackForProperty: "--ui-layout-sidebar-rail-w" }]);
  });

  it("finds multiple raw lengths (min(24rem,90vw), the real Toaster.tsx shape) — neither is a var() fallback (min() is not var())", () => {
    const found = findEmbeddedStyleLiterals("min(24rem,90vw)");
    expect(found.map((f) => f.raw).sort()).toEqual(["24rem", "90vw"]);
    expect(found.every((f) => f.fallbackForProperty === undefined)).toBe(true);
  });

  it("finds nothing in a grid-track-list shape (Shell.tsx's real grid-cols-[...] value)", () => {
    expect(findEmbeddedStyleLiterals("auto_minmax(0,1fr)_auto")).toEqual([]);
  });

  it("isPureVarReference is true only for a bare var() reference with no fallback", () => {
    // "-N"-suffixed names are this repository's own convention for an
    // illustrative, non-real custom property (see
    // scripts/check-contamination-classes.mjs's CLASS 6 —
    // isPlaceholderVarName), used deliberately here: a real token name
    // written with NO fallback at all would otherwise read as exactly the
    // production defect that gate exists to catch, when this is only a
    // synthetic input proving isPureVarReference's own classification.
    expect(isPureVarReference("var(--ui-example-token-N)")).toBe(true);
    expect(isPureVarReference(" var( --ui-example-token-N ) ")).toBe(true);
    expect(isPureVarReference("var(--ui-example-token-N,320px)")).toBe(false);
    expect(isPureVarReference("#3b82f6")).toBe(false);
  });
});

describe("resolveFallbackChain — structural attribution, never value-coincidental", () => {
  it("a bare literal reached by no var() at all resolves to undefined", () => {
    const text = "13px";
    expect(resolveFallbackChain(text, text.indexOf("13px"))).toBeUndefined();
  });

  it("a single-level var(--x, <literal>) resolves to --x", () => {
    const text = "var(--spacing-lg, 16px)";
    expect(resolveFallbackChain(text, text.indexOf("16px"))).toBe("--spacing-lg");
  });

  it("var(--a, var(--b, 16px)) resolves to --b, the INNERMOST wrapper, never --a", () => {
    const text = "var(--a, var(--b, 16px))";
    expect(resolveFallbackChain(text, text.indexOf("16px"))).toBe("--b");
  });

  it("triply-nested var(--a, var(--b, var(--c, 16px))) resolves to --c", () => {
    const text = "var(--a, var(--b, var(--c, 16px)))";
    expect(resolveFallbackChain(text, text.indexOf("16px"))).toBe("--c");
  });

  it("peels through a NON-var wrapping function (rgba) to find the true enclosing var — a position INSIDE rgba(...)'s own argument list still resolves to the var() it is ultimately the fallback for", () => {
    // In practice, style-scan.ts's own color-function pass extracts the
    // WHOLE "rgba(0, 0, 0, 0.10)" as one candidate (never a bare "0"
    // inside it) — this test exercises resolveFallbackChain directly at a
    // position inside rgba(...)'s argument list, confirming the nearest
    // enclosing call is correctly identified as "rgba" first, then peeled
    // through (same mechanism the clamp() test below exercises) to reach
    // the true enclosing "--ui-elevation-floating".
    const text = "var(--ui-elevation-floating, rgba(0, 0, 0, 0.10))";
    const zeroIndex = text.indexOf("0, 0, 0");
    expect(resolveFallbackChain(text, zeroIndex)).toBe("--ui-elevation-floating");
  });

  it("peels through a NON-var wrapping function (clamp) to find the true enclosing var — the real shell-vars.ts UI_WIDTH_PAGE_PADDING_X shape", () => {
    const text = "var(--ui-width-page-padding-x, clamp(16px, 4vw, 48px))";
    expect(resolveFallbackChain(text, text.indexOf("16px"))).toBe("--ui-width-page-padding-x");
    expect(resolveFallbackChain(text, text.indexOf("4vw"))).toBe("--ui-width-page-padding-x");
    expect(resolveFallbackChain(text, text.lastIndexOf("48px"))).toBe("--ui-width-page-padding-x");
  });

  it("a position inside a bare var() reference with NO comma at all is not a fallback — isPureVarReference's territory, not this function's", () => {
    // var(--x) with no fallback slot has nothing for a literal to occupy in
    // the first place; this exercises the "no comma found" branch directly
    // by pointing at a position that is nonetheless inside the parens.
    const text = "var(--ui-example-token-N)";
    expect(resolveFallbackChain(text, text.indexOf("N"))).toBeUndefined();
  });

  it("a literal in an UNRELATED sibling var() (not enclosing this position at all) is never attributed to it", () => {
    const text = "var(--a, 1px) var(--b, 16px)";
    // The "16px" belongs to --b; confirm resolving from its own position
    // does not somehow reach back to --a (a prior, already-closed call).
    expect(resolveFallbackChain(text, text.indexOf("16px"))).toBe("--b");
  });
});

describe("scanStyleSources — the directory walk", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ui-style-scan-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("scans a real directory and reports filesScanned/candidates", () => {
    writeFileSync(join(dir, "about.tsx"), 'export const C = "#3b82f6";\n');
    const result = scanStyleSources(dir);
    expect(result.filesScanned).toBe(1);
    expect(result.candidates).toHaveLength(1);
  });

  it("skips .test.tsx, .spec.ts, .check.tsx, and .d.ts files by design", () => {
    writeFileSync(join(dir, "about.test.tsx"), 'export const C = "#3b82f6";\n');
    writeFileSync(join(dir, "about.spec.ts"), 'export const C = "#3b82f6";\n');
    writeFileSync(join(dir, "contract.check.tsx"), 'export const C = "#3b82f6";\n');
    writeFileSync(join(dir, "types.d.ts"), 'export const C = "#3b82f6";\n');
    const result = scanStyleSources(dir);
    expect(result.filesScanned).toBe(0);
    expect(result.candidates).toEqual([]);
    expect(result.skippedByDesign).toHaveLength(4);
  });

  it("skips node_modules/.git/dist/build/coverage directories", () => {
    for (const skip of ["node_modules", ".git", "dist", "build", "coverage"]) {
      mkdirSync(join(dir, skip), { recursive: true });
      writeFileSync(join(dir, skip, "x.ts"), 'export const C = "#3b82f6";\n');
    }
    const result = scanStyleSources(dir);
    expect(result.filesScanned).toBe(0);
  });

  it("throws (fail-closed) on a scan root that does not exist", () => {
    expect(() => scanStyleSources(join(dir, "does-not-exist"))).toThrow();
  });

  it("ignores a non-matching extension (.json)", () => {
    writeFileSync(join(dir, "data.json"), '{"color":"#3b82f6"}');
    const result = scanStyleSources(dir);
    expect(result.filesScanned).toBe(0);
  });
});
