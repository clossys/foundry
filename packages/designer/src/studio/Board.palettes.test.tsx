// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Board } from "./Board.js";
import { CandidateCell, memberFamilies } from "./CandidateCell.js";
import { matrixBoards, matrixRows } from "./matrix-model.js";
import { buildCandidates, emptyChanges } from "./model.js";
import { emptyLibrary, labels, smallCatalog } from "./__fixtures__/studio.js";
import { loadCatalog } from "../catalog-core/index.js";
import { completedTokenLibrary } from "../importers/__fixtures__/completed-token-library.js";
import { orderTokenMembers } from "../tokens/preview/member-order.js";

afterEach(cleanup);
const catalog = loadCatalog();
const library = completedTokenLibrary(catalog, { id: "palette-consumer", kind: "consumer", author: "consumer", license: "UNLICENSED" }, "2026-10-25");
const ramp = () => buildCandidates({ catalog, library, working: library, slotId: "tokens.color-ramp", scope: "slot", target: "tokens.color-ramp" }).find(candidate => candidate.selected)!;

it("starts every palette ramp on its own row, in display order, with no member lost (studio-20)", () => {
  const candidate = ramp();
  // Display order: each ramp ordinal (amber.50 before amber.100), VR2 studio-04.
  const families = memberFamilies(orderTokenMembers(candidate.members));
  expect(families.length).toBeGreaterThan(1);
  expect(new Set(families.map(run => run.family)).size).toBe(families.length);
  const view = render(<CandidateCell candidate={candidate} labels={labels} />);
  const cell = view.container.querySelector<HTMLElement>("[data-candidate-cell]")!;
  const rows = [...cell.querySelectorAll<HTMLElement>(":scope > [data-candidate-family]")];
  expect(rows.map(row => row.dataset.candidateFamily)).toEqual(families.map(run => run.family));
  for (const [index, row] of rows.entries()) {
    expect(row).toHaveClass("basis-full", "flex", "flex-wrap");
    expect([...row.querySelectorAll<HTMLElement>("[data-candidate-variant]")].map(variant => variant.dataset.candidateVariant)).toEqual(families[index]!.members.map(entry => entry.id));
  }
  expect([...cell.querySelectorAll<HTMLElement>("[data-candidate-variant]")].map(variant => variant.dataset.candidateVariant)).toEqual(families.flatMap(run => run.members.map(entry => entry.id)));
  expect(new Set(families.flatMap(run => run.members.map(entry => entry.id)))).toEqual(new Set(candidate.members.map(entry => entry.id)));
});

it("keeps a single-family leaf flat, with no family rows", () => {
  const candidate = ramp();
  const one = { ...candidate, members: memberFamilies(candidate.members)[0]!.members };
  const view = render(<CandidateCell candidate={one} labels={labels} />);
  expect(view.container.querySelector("[data-candidate-family]")).toBeNull();
  expect(view.container.querySelectorAll("[data-candidate-cell] > [data-candidate-variant]")).toHaveLength(one.members.length);
});

it("pins each row label to the top of its row instead of centring it beside a tall cell", () => {
  const small = emptyLibrary(), changes = emptyChanges(small);
  const rows = matrixRows({ catalog: smallCatalog, library: small, working: small, changes, expanded: new Set() });
  const board = matrixBoards({ catalog: smallCatalog, library: small, working: small }, rows).find(entry => entry.leaves.includes("tokens.surface-color"))!;
  const view = render(<Board board={board} boardRef={null} sources={["foundry"]} labels={labels} working={small} changes={changes} expanded={new Set()} groupChoices={{}} onExpand={() => {}} onUse={() => {}} onFocusCell={() => {}} />);
  const row = view.container.querySelector<HTMLElement>('[data-studio-row="tokens.surface-color"]')!;
  expect(row.querySelector('[role="rowheader"]')).toHaveClass("align-top");
});
