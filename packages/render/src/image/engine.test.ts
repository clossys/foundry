import { describe, expect, it } from "vitest";
import {
  computeCanvasDimensions,
  escapeXml,
  frameToCanvasRect,
  resolveColorRole,
  wrapText,
  buildFlatTokenMap,
} from "./engine.js";
import { RenderError } from "../internal/errors.js";

// ─────────────────────────────────────────────────────────────────────────
// computeCanvasDimensions — the retina-SVG check: viewBox never scales
// ─────────────────────────────────────────────────────────────────────────

describe("computeCanvasDimensions", () => {
  it("scale 1: viewBox and attrs are identical", () => {
    const dims = computeCanvasDimensions({ width: 1200, height: 630 }, 1);
    expect(dims).toEqual({ viewBoxWidth: 1200, viewBoxHeight: 630, attrWidth: 1200, attrHeight: 630, scale: 1 });
  });

  it("scale 2: attrs double, viewBox stays at logical units — the standard retina-SVG shape", () => {
    const dims = computeCanvasDimensions({ width: 1200, height: 630 }, 2);
    expect(dims.viewBoxWidth).toBe(1200);
    expect(dims.viewBoxHeight).toBe(630);
    expect(dims.attrWidth).toBe(2400);
    expect(dims.attrHeight).toBe(1260);
    expect(dims.scale).toBe(2);
  });

  it("defaults scale to 1 when omitted", () => {
    const dims = computeCanvasDimensions({ width: 800, height: 400 });
    expect(dims.attrWidth).toBe(800);
    expect(dims.attrHeight).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// frameToCanvasRect — hand-computed geometry
// ─────────────────────────────────────────────────────────────────────────

describe("frameToCanvasRect", () => {
  it("a slot at {x:0.25,y:0.5,w:0.5,h:0.25} on a 1920x1080 canvas lands at exactly x=480, y=540, w=960, h=270", () => {
    const rect = frameToCanvasRect({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, { width: 1920, height: 1080 });
    expect(rect).toEqual({ x: 480, y: 540, w: 960, h: 270 });
  });

  it("the full-canvas frame {0,0,1,1} maps to the whole canvas", () => {
    const rect = frameToCanvasRect({ x: 0, y: 0, w: 1, h: 1 }, { width: 1024, height: 768 });
    expect(rect).toEqual({ x: 0, y: 0, w: 1024, h: 768 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// escapeXml
// ─────────────────────────────────────────────────────────────────────────

describe("escapeXml", () => {
  it("escapes all five XML-significant characters", () => {
    expect(escapeXml(`<b>&"'"</b>`)).toBe("&lt;b&gt;&amp;&quot;&apos;&quot;&lt;/b&gt;");
  });

  it("neutralizes a literal CDATA-close sequence ']]>' as a byproduct of escaping '>'", () => {
    const escaped = escapeXml("data]]>more");
    expect(escaped).toBe("data]]&gt;more");
    expect(escaped.includes("]]>")).toBe(false);
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeXml("Hello, world!")).toBe("Hello, world!");
  });

  it("does not double-escape an already-escaped ampersand's own '&'", () => {
    // escapeXml is called exactly once by this package's own renderers on
    // raw input — this test only proves the function itself does a single
    // linear pass, not that it's idempotent (it is deliberately NOT
    // idempotent; escaping its own output again would double-encode it).
    expect(escapeXml("&")).toBe("&amp;");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// wrapText — deterministic wrapping + overflow reporting
// ─────────────────────────────────────────────────────────────────────────

describe("wrapText", () => {
  it("does not wrap text that already fits on one line", () => {
    const result = wrapText("Short headline", { fontSizePx: 16, widthPx: 400, heightPx: 100 });
    expect(result.lines).toEqual(["Short headline"]);
    expect(result.overflowed).toBe(false);
  });

  it("wraps onto multiple lines when the text is wider than the slot, without overflowing when the slot is tall enough", () => {
    const longText = "This is a long headline that will not fit on one single line at this width";
    const result = wrapText(longText, { fontSizePx: 16, widthPx: 200, heightPx: 400 });
    expect(result.lines.length).toBeGreaterThan(1);
    expect(result.overflowed).toBe(false);
    // No line exceeds the character budget implied by widthPx/fontSizePx.
    const maxChars = Math.floor(200 / (16 * 0.55));
    for (const line of result.lines) {
      expect(line.replace("…", "").length).toBeLessThanOrEqual(maxChars);
    }
  });

  it("REPORTS overflow (never silent) when a long string in a narrow, short slot needs more lines than fit — the fixture built to trigger it", () => {
    const veryLongText =
      "This deliberately very long string is placed in a narrow slot with almost no height so that it must overflow and this test asserts that overflow is reported by name.";
    const result = wrapText(veryLongText, { fontSizePx: 16, widthPx: 100, heightPx: 20 });
    // heightPx=20 at fontSize=16*1.2=19.2 line-height allows exactly 1 line.
    expect(result.overflowed).toBe(true);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]!.endsWith("…")).toBe(true);
  });

  it("hard-breaks a single word longer than the whole line width", () => {
    const result = wrapText("supercalifragilisticexpialidocious", { fontSizePx: 16, widthPx: 80, heightPx: 200 });
    expect(result.overflowed).toBe(false);
    expect(result.lines.length).toBeGreaterThan(1);
    expect(result.lines.join("")).toContain("supercali");
  });

  it("returns no lines for empty/whitespace-only input", () => {
    expect(wrapText("   ", { fontSizePx: 16, widthPx: 200, heightPx: 200 })).toEqual({ lines: [], overflowed: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// resolveColorRole — always a literal hex, never oklch()/var()
// ─────────────────────────────────────────────────────────────────────────

describe("resolveColorRole", () => {
  it("resolves a real token role name to a literal hex, with no oklch()/var() surviving", () => {
    const flat = buildFlatTokenMap();
    const hex = resolveColorRole("--color-ink-primary", flat, "#000000");
    expect(hex).toMatch(/^#[0-9a-f]{6,8}$/);
    expect(hex.includes("oklch(")).toBe(false);
    expect(hex.includes("var(")).toBe(false);
  });

  it("falls back when no role is given", () => {
    const flat = buildFlatTokenMap();
    expect(resolveColorRole(undefined, flat, "#abcdef")).toBe("#abcdef");
  });

  it("throws the shared RenderError for an unknown token role", () => {
    const flat = buildFlatTokenMap();
    expect(() => resolveColorRole("--not-a-real-token", flat, "#000000")).toThrow(RenderError);
  });
});
