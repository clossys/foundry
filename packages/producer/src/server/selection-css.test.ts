import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { selectionCss } from "./selection-css.js";

describe("selected runtime CSS closure", () => {
  it("compiles actual selected source variants, arbitrary values and single-quoted classes", async () => {
    const css = await selectionCss(new Map([
      ["components/selected/Selected.tsx", "export const Selected = () => <div className='w-[137px] hover:opacity-75 [&_span]:font-bold translate-x-[calc(100%+2px)]'>Selected<span>Label</span></div>;"],
      ["components/selected/classes.ts", "export const height = `h-[43px]`;"],
    ]));
    expect(css.includes("width: 137px")).toBe(true);
    expect(css.includes("opacity: 75%")).toBe(true);
    expect(css.includes("height: 43px")).toBe(true);
    expect(css.includes("\\:font-bold span {")).toBe(true);
    expect(css.includes("calc(100% + 2px)")).toBe(true);
    expect(css.includes("box-sizing: border-box")).toBe(true);
    expect(css.includes("--color-surface-base:")).toBe(true);
    expect(css.includes("components/selected/Selected.tsx")).toBe(false);
    const { chromium } = createRequire(import.meta.url)("playwright");
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setContent('<html data-brand-bound=""><body><div id="selected" class="w-[137px] [&_span]:font-bold"><span>Selected</span></div></body></html>');
      expect(await page.locator("#selected").evaluate((element: HTMLElement) => getComputedStyle(element).width)).not.toBe("137px");
      await page.addStyleTag({ content: css });
      expect(await page.locator("#selected").evaluate((element: HTMLElement) => getComputedStyle(element).width)).toBe("137px");
      expect(await page.locator("#selected span").evaluate((element: HTMLElement) => getComputedStyle(element).fontWeight)).toBe("700");
    } finally { await browser.close(); }
  });

  it("does not invent a selected utility rule without its candidate and preserves emitted CSS", async () => {
    const css = await selectionCss(new Map([["selected.ts", "export const label = 'Selected';"], ["selected.css", ".selected-proof { isolation: isolate; }"]]));
    expect(css.includes("width: 137px")).toBe(false);
    expect(css.includes(".selected-proof { isolation: isolate; }")).toBe(true);
    expect(css.includes(".m-0 {")).toBe(true);
    expect(css.includes(".font-body {")).toBe(true);
  });
});
