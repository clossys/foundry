import { describe, expect, it } from "vitest";
import { buildHiddenPreheaderContent, escapeHtml } from "./escapeHtml.js";

describe("escapeHtml", () => {
  it("escapes &, <, >, \", ' — & first, so nothing is double-escaped", () => {
    expect(escapeHtml(`<script>alert(1)</script> & "quoted" 'quoted' > tail`)).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot; &#39;quoted&#39; &gt; tail",
    );
  });

  it("leaves ordinary text completely unchanged", () => {
    expect(escapeHtml("Welcome aboard, no special characters here.")).toBe("Welcome aboard, no special characters here.");
  });

  it("does not double-escape an already-escaped ampersand sequence", () => {
    // "&amp;" fed in as literal text (not itself an escaping bug's output,
    // but a caller's own literal string) becomes "&amp;amp;" — proving `&`
    // really is replaced exactly once per occurrence, first, as documented.
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });
});

describe("buildHiddenPreheaderContent", () => {
  it("escapes the preheader text and appends exactly 20 zero-width filler pairs", () => {
    const content = buildHiddenPreheaderContent("Your account is ready.");
    expect(content).toBe("Your account is ready." + "&zwnj;&nbsp;".repeat(20));
    expect(content.split("&zwnj;&nbsp;").length - 1).toBe(20);
  });

  it("HTML-escapes hostile content inside the preheader itself", () => {
    const content = buildHiddenPreheaderContent(`<script>x</script>`);
    expect(content.startsWith("&lt;script&gt;x&lt;/script&gt;")).toBe(true);
    expect(content).not.toContain("<script>");
  });
});
