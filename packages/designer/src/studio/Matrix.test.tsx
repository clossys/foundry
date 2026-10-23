import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadCatalog } from "../catalog-core/index.js";
import { DEMO_CATALOG, DEMO_LIBRARY, DEMO_SELECTION } from "./demo-data.js";
import { studioEngine } from "./engine.js";
import { emptyChanges, changesFor } from "./model.js";
import { matrixRows, matrixSources } from "./matrix-model.js";
import { Matrix } from "./Matrix.js";
import type { StudioLabels } from "./types.js";

const labels = { useGroup: "Choose", useSource: () => "Use this version", previewUnavailable: "Fill available; member preview pending", referenceOnly: "Reference only", noFill: "No fill", checkSummary: (errors: number, notices: number) => `${errors} errors ${notices} warnings`, sampleText: "Sample", fontNotLoaded: "No font", matrix: { label: "Matrix", leaf: "Leaf", libraries: "Libraries", showAll: "Show all", expand: (leaf: string) => `Expand ${leaf}`, collapse: (leaf: string) => `Collapse ${leaf}`, differs: "Differs from group", pending: "Pending" }, inspector: { light: "Light", dark: "Dark" } } as StudioLabels;
const input = { catalog: DEMO_CATALOG, library: DEMO_LIBRARY, working: DEMO_SELECTION, changes: emptyChanges(DEMO_SELECTION), expanded: new Set<string>() };
afterEach(cleanup);
const mount = (extra: Partial<Parameters<typeof Matrix>[0]> = {}) => render(<Matrix rows={matrixRows(input)} sources={matrixSources(input)} labels={labels} working={DEMO_SELECTION} changes={input.changes} groupChoices={{}} expanded={input.expanded} onExpand={() => undefined} onUse={() => undefined} onFocusCell={() => undefined} {...extra} />);

it("renders native table rows and one shared radio group per choice row, with sticky headers and leaf cells", () => {
  mount();
  const matrix = screen.getByRole("table", { name: "Matrix" });
  expect(within(matrix).getAllByRole("columnheader").map(node => node.textContent)).toEqual(expect.arrayContaining(["Leaf", "example", "foundry"]));
  const row = matrix.querySelector('[data-studio-row="tokens.accent-color"]') as HTMLElement;
  expect(row.querySelector("th")).toHaveClass("sticky", "start-0");
  expect(within(row).getAllByRole("radiogroup")).toHaveLength(1);
  expect(within(row).getAllByRole("radio")).toHaveLength(4);
  expect(within(row).getByText("role")).toBeInTheDocument();
  expect(matrix.querySelectorAll("tbody > div, tr > div, tr > label")).toHaveLength(0);
});

it("keeps reference and missing cells visible but disabled, and preserves arrow-key selection within a row", async () => {
  const user = userEvent.setup(); const onUse = vi.fn();
  mount({ onUse });
  const row = document.querySelector('[data-studio-row="tokens.accent-color"]') as HTMLElement;
  const radios = within(row).getAllByRole("radio");
  expect(radios[2]).toBeDisabled();
  expect(radios[3]).toBeDisabled();
  expect(within(row).getByText("Reference only")).toBeInTheDocument();
  await act(async () => { (radios[0] as HTMLElement).focus(); });
  await user.keyboard("{ArrowRight}");
  expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ target: "tokens.accent-color", scope: "slot" }), "foundry");
});

it("expands members, marks pending cells and a real leaf override of current-session group context", () => {
  const working = { ...DEMO_SELECTION, picks: [{ scope: "slot" as const, target: "tokens.accent-color", source: "example" }] };
  const changes = { baseHash: "x", changes: changesFor({ ...input, scope: "slot", target: "tokens.accent-color", source: "example" }) };
  const expanded = new Set(["tokens.accent-color"]);
  mount({ rows: matrixRows({ ...input, working, changes, expanded }), working, changes, expanded, groupChoices: { "tokens/role-color": "foundry" } });
  const row = document.querySelector('[data-studio-row="tokens.accent-color"]') as HTMLElement;
  expect(within(row).getByText("Differs from group")).toBeInTheDocument();
  expect(within(row).getAllByLabelText("Pending")).toHaveLength(1);
  expect(document.querySelector('[data-studio-row="tokens.accent-color.default"]')).not.toBeNull();
});

it("focuses the actual revealed leaf row for scorecard issue navigation", () => {
  mount({ focusTarget: { id: "tokens.accent-color", serial: 1 } });
  expect(document.querySelector('[data-studio-row="tokens.accent-color"]')).toHaveFocus();
});


it.each(["notice", "error"] as const)("a real %s candidate controls whether its matrix radio can be operated", async severity => {
  const user = userEvent.setup(); const onUse = vi.fn();
  const engine = { ...studioEngine, check: () => ({ ok: severity === "notice", findings: [{ code: "C2" as const, rule: "contract", severity, subject: "foundry/tokens.accent-color", message: "measured check" }] }) };
  const rows = matrixRows({ ...input, engine }).filter(row => row.id === "tokens.accent-color");
  mount({ rows, onUse });
  const radio = within(document.querySelector('[data-studio-row="tokens.accent-color"]') as HTMLElement).getAllByRole("radio")[1]!;
  if (severity === "notice") expect(radio).toBeEnabled(); else expect(radio).toBeDisabled();
  await user.click(radio);
  expect(onUse).toHaveBeenCalledTimes(severity === "notice" ? 1 : 0);
});

it("basket changes real emphasis while group fan-out and persisted picks remain identical", () => {
  const catalog = structuredClone(DEMO_CATALOG);
  const group = catalog.placements[0]!.nodes.find(node => node.id === "role");
  if (!group || !("children" in group)) throw new Error("fixture");
  const color = group.children.find(node => node.id === "role-color")!;
  (color as typeof color & { basket: string }).basket = "leaf";
  const rows = matrixRows({ ...input, catalog });
  mount({ rows });
  expect(document.querySelector('[data-studio-row="tokens/role-color"] th')).toHaveClass("bg-surface-base");
  expect(document.querySelector('[data-studio-row="tokens.accent-color"] th')).toHaveClass("bg-surface-raised");
  expect(changesFor({ ...input, catalog, scope: "node", target: "tokens/role-color", source: "foundry" })).toEqual(changesFor({ ...input, scope: "node", target: "tokens/role-color", source: "foundry" }));
});


it.each([1, 4, 5, 6])("uses one fixed column layout and scrolls beyond four libraries (%i)", count => {
  const sources = Array.from({ length: count }, (_, index) => `library-${index}`);
  mount({ sources });
  const matrix = screen.getByRole("table", { name: "Matrix" });
  expect(matrix).toHaveClass("table-fixed");
  const viewport = matrix.closest("[data-studio-matrix]") as HTMLElement;
  expect(viewport.style.maxBlockSize).toContain("--ui-table-max-block-default");
  expect(viewport.style.overflowY).toBe("auto");
  expect(matrix.querySelector("tbody > tr > th")?.getAttribute("style")).toContain("--ui-z-sticky");
  expect(matrix.querySelector("thead")).toHaveClass("sticky", "top-0");
  expect(matrix.querySelectorAll(":scope > thead > tr > th")).toHaveLength(count + 1);
  if (count <= 4) expect(matrix.style.inlineSize).toBe("100%");
  else expect(matrix.style.inlineSize).toContain(`${count} / 4`);
});

it("renders one bordered color swatch with two contiguous accessible light/dark halves", () => {
  mount();
  const row = document.querySelector('[data-studio-row="tokens.accent-color"]') as HTMLElement;
  const swatch = row.querySelector("[data-studio-color-swatch]") as HTMLElement;
  expect(swatch).not.toBeNull();
  expect(swatch).toHaveClass("inline-flex", "overflow-hidden", "border", "border-line-base");
  expect(swatch.children).toHaveLength(2);
  expect(within(swatch).getByRole("img", { name: /^Light / })).toHaveStyle({ inlineSize: "50%" });
  expect(within(swatch).getByRole("img", { name: /^Dark / })).toHaveStyle({ inlineSize: "50%" });
  expect(swatch).not.toHaveClass("gap-xs");
});


it("keeps an open-contract fill selectable while explicitly reporting unavailable member previews", () => {
  const catalog = loadCatalog();
  const rows = matrixRows({ ...input, catalog, leafId: "tokens.spacing" });
  mount({ rows, sources: matrixSources({ catalog, library: DEMO_LIBRARY }) });
  const cell = document.querySelector('[data-studio-row="tokens.spacing"] [data-studio-card="foundry"]') as HTMLElement;
  expect(within(cell).getByText("Fill available; member preview pending")).toBeVisible();
  expect(within(cell).getByRole("radio", { name: "Use this version" })).toBeEnabled();
  expect(within(cell).queryByText("No fill")).toBeNull();
});
