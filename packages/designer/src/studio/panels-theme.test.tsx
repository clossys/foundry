import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider } from "../theme/ThemeProvider.js";
import { PATTERN_RECIPES } from "../tokens/pattern.js";
import { PatternSpecimen, SvgSpecimen } from "./asset-specimens.js";

it("renders the pattern against each fixed theme ground while preserving logo polarity", () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M0 0h48v48H0z"/></svg>';
  for (const theme of ["light", "dark"] as const) {
    const pattern = renderToStaticMarkup(<ThemeProvider preference={theme}><PatternSpecimen recipe={PATTERN_RECIPES.grid}/></ThemeProvider>);
    expect(pattern).toContain(`data-specimen-theme="${theme}"`);
    expect(pattern).toContain(`data-ground="${theme}"`);
    const logo = renderToStaticMarkup(<ThemeProvider preference={theme}><SvgSpecimen slot="assets.mark" id="assets.mark.reversed" svg={svg}/></ThemeProvider>);
    expect(logo).toContain('data-ground="dark"');
  }
});
