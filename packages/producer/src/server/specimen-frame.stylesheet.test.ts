import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyThemeAttributes } from "@clossys/designer/theme/server";
import { resolveAgent } from "../agents.js";
import { SPECIMEN_FRAME_CSP, SPECIMEN_FRAME_STYLESHEET, specimenFramePage } from "./specimen-frame.js";
import { designerStylesheet, designerStylesheetHref } from "./publisher-preview-render.js";

// DS-COMPLETE D2: served documents take their theme attributes and stylesheets from Designer.
describe("Designer-owned specimen and preview document styling", () => {
  it("links the frame document's stylesheet from Designer and inlines no style", async () => {
    const html = specimenFramePage({ src: "/__specimen-site/k/index.html", width: 768, title: "probe" });
    expect(html).not.toMatch(/<style\b|\sstyle=/);
    expect(html).toContain(`<link rel="stylesheet" href="${SPECIMEN_FRAME_STYLESHEET}">`);
    expect(SPECIMEN_FRAME_STYLESHEET).toBe(designerStylesheetHref("specimen-frame.css"));
    expect(SPECIMEN_FRAME_CSP).toContain("style-src 'self';");
    expect(SPECIMEN_FRAME_CSP).not.toContain("unsafe-inline");
    const shipped = await readFile(join(resolveAgent("designer").packageRoot, "styles", "specimen-frame.css"));
    expect(await designerStylesheet("specimen-frame.css")).toEqual(shipped);
  });

  it("serves only Designer's named stylesheets", async () => {
    expect(await designerStylesheet("compiled.css")).toBeInstanceOf(Buffer);
    for (const name of ["../package.json", "theme.css", "specimen-frame.css/..", ""]) expect(await designerStylesheet(name)).toBeUndefined();
  });

  it("sets the page theme through Designer's theme attributes", () => {
    expect(applyThemeAttributes("<html><body></body></html>", "light")).toBe('<html style="color-scheme:light"><body></body></html>');
    expect(applyThemeAttributes('<html lang="en">x</html>', "dark")).toBe('<html class="dark" lang="en" style="color-scheme:dark">x</html>');
  });
});
