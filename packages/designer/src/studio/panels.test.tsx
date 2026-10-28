import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasDomain } from "./CanvasDomain.js";
import { specimenDatasetFor, specimenStateFixtures } from "./specimen-dataset.js";

it("keeps board arrangement on a token-spaced grid in both panel layouts", () => {
  for (const narrow of [false, true]) {
    const html = renderToStaticMarkup(<CanvasDomain id="fixture" label="Fixture" narrow={narrow}><div>Board</div></CanvasDomain>);
    expect(html).toContain('data-studio-board-grid=""');
    expect(html).toContain(narrow ? 'grid min-w-0 grid-cols-1' : 'grid min-w-0 items-start');
    if (!narrow) expect(html).toContain('grid-auto-flow:column;grid-auto-columns:max-content');
  }
});
it("fixes independent specimen values per theme and includes reproducible empty/loading/disabled states", () => {
  const light = specimenDatasetFor("light"), dark = specimenDatasetFor("dark");
  expect(light.themeValues.ink).not.toBe(dark.themeValues.ink);
  expect(light.themeValues.surface).not.toBe(dark.themeValues.surface);
  // Categorical identities remain stable; foreground and surface are theme-specific.
  expect(light.color.swatches).toEqual(dark.color.swatches);
  expect(specimenDatasetFor("light")).toEqual(light);
  expect(specimenStateFixtures.empty.table.rows).toEqual([]);
  expect(specimenStateFixtures.disabled.isDisabled).toBe(true);
  expect(specimenStateFixtures.loading.isLoading).toBe(true);
});
