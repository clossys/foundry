import { expect, it } from "vitest";
import { contentCatalogDocument } from "../preview/fixture-content-catalog.js";
import { checkSectionVariety } from "./sectioned-view.js";

// Catalog fixtures migrate separately; retain the historical assertion verbatim.
it("preserves legacy catalog variety output including the adjacent lane variants", () => {
  const legacy = { ...contentCatalogDocument, sections: contentCatalogDocument.sections.filter((section) => !section.id.startsWith("catalog-topics-groups-")) };
  expect(checkSectionVariety(legacy)).toMatchInlineSnapshot(`
[
  {
    "message": "sections.13 repeats the layout, block and visual of the band before it (stacked, topic-list, none); vary one of them.",
    "path": "sections.13",
    "rule": "sectioned-view-variety-repeat",
    "severity": "warning",
  },
  {
    "message": "sections.21 repeats the layout, block and visual of the band before it (stacked, ordered-step-sequence, lanes); vary one of them.",
    "path": "sections.21",
    "rule": "sectioned-view-variety-repeat",
    "severity": "warning",
  },
  {
    "message": "sections.18 is a second band with four or more cards; keep at most one.",
    "path": "sections.18",
    "rule": "sectioned-view-variety-card-bands",
    "severity": "warning",
  },
  {
    "message": "sections.19 is a second comparison; keep at most one.",
    "path": "sections.19",
    "rule": "sectioned-view-variety-comparison-count",
    "severity": "warning",
  },
  {
    "message": "sections.8 uses the feature-grid block with the same treatment as sections.3; give it a different treatment.",
    "path": "sections.8",
    "rule": "sectioned-view-variety-treatment",
    "severity": "warning",
  },
  {
    "message": "sections.13 uses the topic-list block with the same treatment as sections.12; give it a different treatment.",
    "path": "sections.13",
    "rule": "sectioned-view-variety-treatment",
    "severity": "warning",
  },
  {
    "message": "sections.18 uses the card-grid block with the same treatment as sections.15; give it a different treatment.",
    "path": "sections.18",
    "rule": "sectioned-view-variety-treatment",
    "severity": "warning",
  },
]
`);
});
