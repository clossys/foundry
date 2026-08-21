import { describe, expect, it } from "vitest";
import type { PrintMeta } from "../../core/index.js";
import { RenderError } from "../../internal/errors.js";
import { buildPageAtRuleCss, resolvePageBox } from "./page.js";

function meta(overrides: Partial<PrintMeta> = {}): PrintMeta {
  return {
    channel: "print",
    pageSize: "A4",
    orientation: "portrait",
    margins: { top: "20mm", right: "20mm", bottom: "20mm", left: "20mm" },
    ...overrides,
  };
}

describe("resolvePageBox", () => {
  it("resolves A4 portrait to its real physical dimensions", () => {
    expect(resolvePageBox(meta({ pageSize: "A4", orientation: "portrait" }), undefined)).toEqual({
      width: "210mm",
      height: "297mm",
    });
  });

  it("resolves A4 landscape by swapping width/height", () => {
    expect(resolvePageBox(meta({ pageSize: "A4", orientation: "landscape" }), undefined)).toEqual({
      width: "297mm",
      height: "210mm",
    });
  });

  it("resolves Letter portrait to 8.5in x 11in", () => {
    expect(resolvePageBox(meta({ pageSize: "Letter", orientation: "portrait" }), undefined)).toEqual({
      width: "8.5in",
      height: "11in",
    });
  });

  it("resolves Letter landscape by swapping width/height", () => {
    expect(resolvePageBox(meta({ pageSize: "Letter", orientation: "landscape" }), undefined)).toEqual({
      width: "11in",
      height: "8.5in",
    });
  });

  it("resolves Custom to the caller-supplied dimensions verbatim", () => {
    expect(resolvePageBox(meta({ pageSize: "Custom" }), { width: "148mm", height: "210mm" })).toEqual({
      width: "148mm",
      height: "210mm",
    });
  });

  it("REFUSES Custom with no customPageSize at all — never silently falls back to A4", () => {
    let thrown: unknown;
    try {
      resolvePageBox(meta({ pageSize: "Custom" }), undefined);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as RenderError).reason).toBe("missing-custom-page-size");
    expect((thrown as RenderError).message).toContain('doc.meta.pageSize is "Custom"');
  });

  it("REFUSES Custom with a blank width", () => {
    expect(() => resolvePageBox(meta({ pageSize: "Custom" }), { width: "  ", height: "210mm" })).toThrow(
      RenderError,
    );
  });

  it("REFUSES Custom with a blank height", () => {
    let thrown: unknown;
    try {
      resolvePageBox(meta({ pageSize: "Custom" }), { width: "148mm", height: "" });
    } catch (error) {
      thrown = error;
    }
    expect((thrown as RenderError).reason).toBe("missing-custom-page-size");
  });
});

describe("buildPageAtRuleCss", () => {
  it("emits an exact @page rule for A4 portrait with margins only", () => {
    const m = meta({ pageSize: "A4", orientation: "portrait" });
    const css = buildPageAtRuleCss(m, resolvePageBox(m, undefined));
    expect(css).toBe("@page{size:A4 portrait;margin-top:20mm;margin-right:20mm;margin-bottom:20mm;margin-left:20mm;}");
  });

  it("emits an exact @page rule for Letter landscape", () => {
    const m = meta({
      pageSize: "Letter",
      orientation: "landscape",
      margins: { top: "0.5in", right: "0.75in", bottom: "0.5in", left: "0.75in" },
    });
    const css = buildPageAtRuleCss(m, resolvePageBox(m, undefined));
    expect(css).toBe(
      "@page{size:letter landscape;margin-top:0.5in;margin-right:0.75in;margin-bottom:0.5in;margin-left:0.75in;}",
    );
  });

  it("emits bleed and marks:crop together when both are present", () => {
    const m = meta({ bleed: "3mm", cropMarks: true });
    const css = buildPageAtRuleCss(m, resolvePageBox(m, undefined));
    expect(css).toBe(
      "@page{size:A4 portrait;margin-top:20mm;margin-right:20mm;margin-bottom:20mm;margin-left:20mm;bleed:3mm;marks:crop;}",
    );
  });

  it("omits both bleed and marks declarations entirely when neither is set", () => {
    const m = meta();
    const css = buildPageAtRuleCss(m, resolvePageBox(m, undefined));
    expect(css).not.toContain("bleed:");
    expect(css).not.toContain("marks:");
  });

  it("emits bleed alone when cropMarks is not set (harmless per the CSS spec — bleed only has effect when marks:crop is present)", () => {
    const m = meta({ bleed: "6pt" });
    const css = buildPageAtRuleCss(m, resolvePageBox(m, undefined));
    expect(css).toBe(
      "@page{size:A4 portrait;margin-top:20mm;margin-right:20mm;margin-bottom:20mm;margin-left:20mm;bleed:6pt;}",
    );
  });

  it("emits marks:crop alone when bleed is not set", () => {
    const m = meta({ cropMarks: true });
    const css = buildPageAtRuleCss(m, resolvePageBox(m, undefined));
    expect(css).toBe(
      "@page{size:A4 portrait;margin-top:20mm;margin-right:20mm;margin-bottom:20mm;margin-left:20mm;marks:crop;}",
    );
  });

  it("emits raw length pairs (no orientation keyword) for a Custom page — the CSS grammar cannot pair explicit lengths with portrait/landscape", () => {
    const m = meta({ pageSize: "Custom", orientation: "landscape" });
    const box = resolvePageBox(m, { width: "297mm", height: "210mm" });
    const css = buildPageAtRuleCss(m, box);
    expect(css).toBe(
      "@page{size:297mm 210mm;margin-top:20mm;margin-right:20mm;margin-bottom:20mm;margin-left:20mm;}",
    );
    expect(css).not.toContain("landscape");
    expect(css).not.toContain("portrait");
  });
});
