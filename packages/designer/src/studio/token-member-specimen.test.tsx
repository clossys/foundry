import { expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { loadCatalog } from "../catalog-core/index.js";
import { completedTokenLibrary } from "../importers/__fixtures__/completed-token-library.js";
import { buildCandidates, type Candidate } from "./model.js";
import { CandidateCell } from "./CandidateCell.js";
import { labels } from "./__fixtures__/studio.js";

/**
 * TB-LABEL (TOKENS-FB-1): a labelled CandidateCell owns the member key. Every member shows
 * exactly one visible key and one separate visible value, whatever the member type, and the
 * compact path never re-enters the labelled SlotPreview (which would paint a second key).
 */
const catalog = loadCatalog();
const library = completedTokenLibrary(catalog, { id: "member-specimen", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-25");
const selected = (slotId: string): Candidate => {
  const candidate = buildCandidates({ catalog, library, working: library, scope: "slot", target: slotId, slotId }).find(entry => entry.selected);
  if (!candidate) throw new Error(`no selected candidate for ${slotId}`);
  return candidate;
};
const visible = (element: Element): boolean => !element.closest("[aria-hidden=true], .sr-only");
const leafTexts = (root: Element, text: string): Element[] =>
  [...root.querySelectorAll("*")].filter(element => element.children.length === 0 && visible(element) && element.textContent?.trim() === text);

const cases: Array<[kind: string, slotId: string, $type: string]> = [
  ["color", "tokens.scrim-color", "color"],
  ["bound dimension", "tokens.spacing", "dimension"],
  ["open dimension", "tokens.region-width", "dimension"],
  ["fontWeight", "tokens.font-weight", "fontWeight"],
  ["fontFamily", "tokens.typeface", "fontFamily"],
];

it.each(cases)("%s members show one visible key and one separate value (%s)", (_kind, slotId, $type) => {
  const candidate = selected(slotId);
  expect(candidate.previewable).toBe(true);
  expect(candidate.members.length).toBeGreaterThan(0);
  expect(candidate.members.every(({ member }) => member.$type === $type)).toBe(true);
  const view = render(<CandidateCell candidate={candidate} labels={labels} />);
  const cell = view.container.querySelector("[data-candidate-cell]")!;
  // The cell owns the label: no labelled SlotPreview inside a labelled cell.
  expect(cell.querySelectorAll("[data-studio-slot-preview]")).toHaveLength(0);
  const problems: string[] = [];
  for (const { id, member } of candidate.members) {
    const key = id.slice(member.slot.length + 1), value = member.css.light;
    const variant = [...cell.querySelectorAll<HTMLElement>("[data-candidate-variant]")].find(element => element.dataset.candidateVariant === id);
    if (!variant) { problems.push(`${key}: not rendered`); continue; }
    const named = leafTexts(variant, key);
    const keys = named.filter(element => element.hasAttribute("data-member-key"));
    if (key !== value) keys.push(...named.filter(element => !element.hasAttribute("data-member-key")));
    const values = leafTexts(variant, value).filter(element => !element.hasAttribute("data-member-key"));
    if (keys.length !== 1) problems.push(`${key}: ${keys.length} visible keys`);
    if (key !== value && values.length !== 1) problems.push(`${key}: ${values.length} visible values`);
  }
  expect(problems).toEqual([]);
  cleanup();
});
