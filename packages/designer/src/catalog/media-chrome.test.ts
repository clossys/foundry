import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import sections from "./slots/sections.json" with { type: "json" };
import sectionIa from "./ia/sections.json" with { type: "json" };
import passages from "../../../writer/src/catalog/slots/passages.json" with { type: "json" };
import { FOUNDRY_SECTION_MAP, generatedFoundrySectionFiles, importFoundrySections } from "../importers/foundry-sections.js";
// @ts-expect-error — the canonical producer is dependency-free JavaScript.
import { derivePassages } from "../../../writer/scripts/derive-passages.mjs";
// @ts-expect-error — the canonical producer is dependency-free JavaScript.
import { emitCopyPortTypes } from "../../scripts/generate-copy-ports.mjs";

const section = sections.find(row => row.id === "sections.media")!;
const passage = passages.find(row => row.id === "passages.media")!;
const newCopy = [
  { key: "figure.chromeLabel", kind: "plain", required: false, maxLength: { en: 160 }, dir: "auto" },
  { key: "callouts.label", kind: "plain", required: false, maxLength: { en: 160 }, dir: "auto" },
  { key: "callouts.items[].body", kind: "plain", required: false, maxLength: { en: 480 }, dir: "auto" },
];
const copyPortRow = (text: string) => text.match(/  readonly "sections\.media": \{\n[\s\S]*?\n  \};/)?.[0];
const catalogDirectory = dirname(fileURLToPath(import.meta.url));

describe("media specimen chrome catalog contract", () => {
  it("keeps the figure required and exposes optional callouts with exactly three chrome members", () => {
    expect(section.contract.slots).toEqual([
      { name: "figure", type: "media", required: true },
      { name: "callouts", type: "records", required: false },
    ]);
    expect(section.contract.members).toEqual({ mode: "closed", names: ["chrome.browser", "chrome.device", "chrome.bare"] });
  });

  it("maps every chrome member and callouts to the public MediaFigure API", () => {
    expect(FOUNDRY_SECTION_MAP.media?.slotMap).toEqual({ figure: "./blocks#MediaFigure.children", callouts: "./blocks#MediaFigure.callouts" });
    expect(FOUNDRY_SECTION_MAP.media?.propMap).toEqual({
      "chrome.browser": "./blocks#MediaFigure.chrome=browser",
      "chrome.device": "./blocks#MediaFigure.chrome=device",
      "chrome.bare": "./blocks#MediaFigure.chrome=bare",
    });
    const coverage = importFoundrySections().coverage.find(row => row.slot === section.id);
    expect(coverage).toMatchObject({ status: "candidate", supportedSlots: ["callouts", "figure"], missingSlots: [], missingRequiredSlots: [], supportedMembers: ["chrome.bare", "chrome.browser", "chrome.device"], missingMembers: [] });
    const generated = generatedFoundrySectionFiles();
    expect(readFileSync(resolve(catalogDirectory, "fills/foundry/sections.media.json"), "utf8")).toBe(generated["sections.media.json"]);
    const committedCoverage = JSON.parse(readFileSync(resolve(catalogDirectory, "fills/foundry/sections.coverage.json"), "utf8"));
    expect(committedCoverage.coverage.find((row: { slot: string }) => row.slot === section.id)).toEqual(coverage);
  });

  it("declares only optional authored chrome and callout copy and derives the same Writer passage", () => {
    for (const field of newCopy) expect(section.contract.copy.fields.find(candidate => candidate.key === field.key)).toEqual(field);
    expect(passage.contract.copy).toEqual(section.contract.copy);
    const derived = derivePassages(sectionIa, sections).slots.find((row: { id: string }) => row.id === passage.id);
    expect(passage).toEqual(derived);
  });

  it("keeps the generated media copy port equal to Writer's canonical producer", () => {
    const source = readFileSync(resolve(catalogDirectory, "../runtime/sections/copy-ports.ts"), "utf8");
    const expected = copyPortRow(emitCopyPortTypes(passages));
    expect(expected).toBeDefined();
    expect(copyPortRow(source)).toBe(expected);
    for (const field of newCopy) expect(expected).toContain(`readonly "${field.key}"?: string;`);
  });
});
