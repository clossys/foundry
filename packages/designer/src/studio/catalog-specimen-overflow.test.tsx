import { expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { loadCatalog } from "../catalog-core/index.js";
import { completedTokenLibrary } from "../importers/__fixtures__/completed-token-library.js";
import { buildCandidates } from "./model.js";
import { CandidateCell, LIBRARY_COLUMN_BOUND } from "./CandidateCell.js";
import { TOKEN_LEAF_SPECIMENS, TOKEN_SPECIMEN_WIDTHS, type TokenSpecimenKind } from "../tokens/preview/specimens.js";
import { labels } from "./__fixtures__/studio.js";

/**
 * Catalog-wide overflow test (FB-12b, C21-4). Every token specimen declares a minimum and a
 * maximum inline size and clips at its maximum, so no specimen content can push past its
 * declared bound, and no declared bound is wider than the library column cap.
 *
 * D3 (per-specimen min/max width) is an owner decision held open; these are the DEFAULTS this
 * packet ships, derived from existing size tokens only (no token value changed):
 *   shape specimens (radius, shadow, blur, density, focus,
 *   icon, opacity):                                            min --ui-control-h-lg (52px), max --spacing-6xl (128px)
 *   motion:                                                    min --spacing-6xl (128px),   max --ui-layout-sidebar-w (256px)
 *   text-metric:                                               min --ui-control-h-lg (52px), max --ui-layout-sidebar-w (256px)
 *   ruler (true-px scale, 256px track):                        min = max = 256px
 *   layer-fan (11 plates, 48px plate + 10 x 8px step):         min = max = --spacing-6xl (128px)
 * The px numbers are the shipped token values, recorded so a change to either side is visible here.
 */
const D3_DEFAULTS: Record<TokenSpecimenKind, { min: number; max: number }> = {
  motion: { min: 128, max: 256 },
  radius: { min: 52, max: 128 },
  shadow: { min: 52, max: 128 },
  blur: { min: 52, max: 128 },
  "text-metric": { min: 52, max: 256 },
  ruler: { min: 256, max: 256 },
  density: { min: 52, max: 128 },
  focus: { min: 52, max: 128 },
  "layer-fan": { min: 128, max: 128 },
  icon: { min: 52, max: 128 },
  opacity: { min: 52, max: 128 },
};

const catalog = loadCatalog();
const library = completedTokenLibrary(catalog, { id: "overflow-consumer", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-25");

it("ships the D3 default bounds, each within the library column cap", () => {
  expect(Object.fromEntries(Object.entries(TOKEN_SPECIMEN_WIDTHS).map(([kind, width]) => [kind, { min: width.min, max: width.max }]))).toEqual(D3_DEFAULTS);
  for (const width of Object.values(TOKEN_SPECIMEN_WIDTHS)) {
    expect(width.min).toBeLessThanOrEqual(width.max);
    expect(width.max).toBeLessThanOrEqual(Number(LIBRARY_COLUMN_BOUND.maxWidth));
  }
});

it("no token specimen in the catalog can exceed its declared maximum width", () => {
  const problems: string[] = [];
  let seen = 0;
  for (const [leaf, kind] of Object.entries(TOKEN_LEAF_SPECIMENS)) {
    const candidate = buildCandidates({ catalog, library, working: library, scope: "slot", target: leaf, slotId: leaf }).find(entry => entry.selected);
    if (!candidate) { problems.push(`${leaf}: no selected candidate`); continue; }
    const view = render(<CandidateCell candidate={candidate} labels={labels} />);
    const specimens = [...view.container.querySelectorAll<HTMLElement>("[data-token-specimen]")];
    if (specimens.length !== candidate.members.length) problems.push(`${leaf}: ${specimens.length} specimens for ${candidate.members.length} members`);
    for (const specimen of specimens) {
      seen++;
      const classes = specimen.className.split(/\s+/);
      if (specimen.dataset.tokenSpecimen !== kind) problems.push(`${leaf}: ${specimen.dataset.tokenSpecimen} is not ${kind}`);
      for (const required of TOKEN_SPECIMEN_WIDTHS[kind].className.split(/\s+/)) if (!classes.includes(required)) problems.push(`${leaf}: missing ${required}`);
      if (!classes.includes("overflow-hidden")) problems.push(`${leaf}: does not clip at its maximum`);
      // Nothing inside a specimen is sized to max-content or forced past the bound.
      if (specimen.querySelector('[class*="w-max"], [class*="min-w-max"]')) problems.push(`${leaf}: max-content child`);
    }
    view.unmount();
  }
  cleanup();
  expect(seen).toBeGreaterThan(0);
  expect(problems).toEqual([]);
}, 120_000);
