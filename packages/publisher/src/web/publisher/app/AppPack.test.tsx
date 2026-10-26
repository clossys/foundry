// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AppPack } from "./AppPack.js";
import { APP_LANES, projectAppInventory } from "./inventory.js";
import { genericInventory } from "./__fixtures__/generic.js";
import { appBindingFixture, genericProjection } from "./__fixtures__/binding.js";
import { fixtureCompiler } from "../__fixtures__/compiler.js";
import { key } from "../../../core/__fixtures__/instance-binding/fixtures.js";
afterEach(cleanup);
it("shows only page chips in collapsed lanes and keeps detail tabs hidden", () => {
  render(<AppPack inventory={projectAppInventory(genericInventory())} />);
  const matrix = screen.getByRole("table", { name: "App publish stages" });
  expect(within(matrix).getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["Lane", "Configure", "Frame", "Layout", "Fills", "Content", "Checks", "States", "Ready", "Export", "Deploy"]);
  expect(within(matrix).getAllByRole("rowheader").map(cell => cell.textContent?.replace(/^[+−] /, "").split(/\d/)[0]?.trim())).toEqual(APP_LANES);
  expect(within(matrix).getAllByRole("rowheader").filter(cell => cell.textContent?.includes("no pages yet"))).toHaveLength(3);
  const chips = within(matrix).getAllByRole("button", { name: /^Open / });
  expect(chips).toHaveLength(3);
  for (const chip of chips) expect(chip.closest("td")?.cellIndex).toBe(1);
  expect(screen.queryByRole("button", { name: /Overview/ })).toBeNull();
  expect(screen.getByText("3 pages · 0 Ready · 3 not ready")).toBeVisible();
});
it("expands route evidence and opens accessible details without inventing a binding", () => {
  render(<AppPack inventory={projectAppInventory(genericInventory())} />);
  fireEvent.click(screen.getByRole("button", { name: /Expand Record/ }));
  const rows = screen.getByRole("table", { name: "Record routes" });
  expect(within(rows).queryByRole("button", { name: "↳ Overview" })).toBeNull();
  const expandTabs = within(rows).getByRole("button", { name: "Expand Sample record tabs · 1" });
  expect(expandTabs).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(expandTabs);
  expect(expandTabs).toHaveAttribute("aria-expanded", "true");
  expect(within(rows).getByRole("button", { name: "↳ Overview" })).toBeVisible();
  expect(within(rows).getAllByRole("cell").filter(cell => cell.textContent?.includes("Planner default only"))).toHaveLength(2);
  const button = within(rows).getByRole("button", { name: "↳ Overview" });
  fireEvent.click(button);
  expect(screen.getByRole("heading", { name: "Overview · route details" })).toHaveFocus();
  const details = screen.getByRole("heading", { name: "Overview · route details" }).closest("section")!;
  expect(within(details).queryByText(/^Frame:/)).toBeNull();
  expect(within(details).queryByText(/^Layout:/)).toBeNull();
  expect(within(details).getByText("States: waiting")).toBeVisible();
  const tabRow = within(rows).getByRole("button", { name: "↳ Overview" }).closest("tr")!;
  expect(tabRow).toHaveAttribute("data-parent-page", "sample.record");
  expect(within(tabRow).getByText("N/A · parent page owns Frame")).toBeVisible();
  expect(within(tabRow).getByText("N/A · parent page owns Layout")).toBeVisible();
  expect(screen.getByText(/empty: declared · applicability: undecided/)).toBeVisible();
  expect(screen.getByText(/Declarations describe inspected source conditions/)).toBeVisible();
  expect(screen.queryByRole("complementary", { name: "Instance inspector" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close route details" }));
  expect(button).toHaveFocus();
  fireEvent.click(expandTabs);
  expect(within(rows).queryByRole("button", { name: "↳ Overview" })).toBeNull();
});
it("preserves native page URLs and marks only internal local tabs as missing URL routes", () => {
  render(<AppPack inventory={projectAppInventory(genericInventory())} />);
  fireEvent.click(screen.getByRole("button", { name: /^Open Sample studio/ }));
  expect(screen.getAllByText("/studio/sample").length).toBeGreaterThan(0);
  expect(screen.getByText("one · no URL route")).toBeVisible();
  expect(screen.getByText("two · no URL route")).toBeVisible();
  expect(screen.getByText("Local tab identity is missing; this is not a check finding.")).toBeVisible();
});
it("counts native page owners separately from v2 subrows", () => {
  const projection = genericProjection();
  const page = { ...projection.pages[0]!, id: "sample.studio", label: "Sample studio", path: "/studio/sample", transport: "next" as const, lane: "Studio" as const, pathParameters: [] };
  const subrows = projection.subrows.map((row, index) => ({ ...row, path: `/studio/sample?panel=${index}`, transport: "next" as const, parentPageId: page.id, pathParameters: [] }));
  render(<AppPack inventory={projectAppInventory({ ...projection, pages: [page], subrows })} />);
  expect(screen.getByText("0 bound hash patterns · 2 detail tabs · 1 native pages")).toBeVisible();
  expect(screen.getByText("1 pages · 0 Ready · 1 not ready")).toBeVisible();
});
it("keeps an entirely empty inventory empty", () => {
  render(<AppPack inventory={projectAppInventory({ ...genericInventory(), routes: [], nonAddressableTabs: [] })} />);
  expect(screen.getAllByRole("rowheader").filter(cell => cell.textContent?.includes("no pages yet"))).toHaveLength(6);
  expect(screen.queryByRole("button", { name: /^Open / })).toBeNull();
});

it("keeps missing page decisions separate from actual page identities and counts", () => {
  const decisions = [
    { id: "home", label: "Home", lane: "Dashboard" as const },
    { id: "settings", label: "Settings", lane: "Settings" as const },
    { id: "not-found", label: "Not found", lane: "Status" as const },
    { id: "error", label: "Error", lane: "Status" as const },
  ];
  render(<AppPack inventory={projectAppInventory(genericInventory(), decisions)} />);
  const missing = screen.getAllByRole("button", { name: /page decision · to do$/ });
  expect(missing).toHaveLength(4);
  for (const chip of missing) { expect(chip.closest("td")?.cellIndex).toBe(1); expect(chip).toHaveTextContent("No route or adopted page"); }
  expect(screen.queryByRole("table", { name: "Missing App page decisions" })).toBeNull();
  fireEvent.click(missing[0]!);
  expect(screen.getByRole("heading", { name: "Home · page decision" })).toHaveFocus();
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText("3 pages · 0 Ready · 3 not ready")).toBeVisible();
  expect(screen.getByRole("button", { name: "Expand Record · 1 pages" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Expand Dashboard · 0 pages" })).toBeVisible();
});

it("keeps twenty-six detail tabs out of the eight-page matrix until their own parent expands", () => {
  const raw = genericInventory();
  const parent = raw.routes[1]!;
  const tab = raw.routes[2]!;
  const tabs = Array.from({ length: 26 }, (_, index) => ({ ...tab, id: `sample.tab.${index}`, label: `Detail ${index}`, path: `${parent.path}?tab=${index}` }));
  const pages = Array.from({ length: 5 }, (_, index) => ({ ...raw.routes[0]!, id: `sample.extra.${index}`, label: `Extra ${index}`, path: `/#/extra-${index}` }));
  render(<AppPack inventory={projectAppInventory({ ...raw, routes: [raw.routes[0], parent, raw.routes[3], ...pages, ...tabs] })} />);
  const matrix = screen.getByRole("table", { name: "App publish stages" });
  expect(within(matrix).getAllByRole("button", { name: /^Open / })).toHaveLength(8);
  expect(screen.getByText("8 pages · 0 Ready · 8 not ready")).toBeVisible();
  expect(screen.queryByRole("button", { name: /^↳ Detail/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Expand Record · 1 pages" }));
  const rows = screen.getByRole("table", { name: "Record routes" });
  expect(within(rows).queryByRole("button", { name: /^↳ Detail/ })).toBeNull();
  fireEvent.click(within(rows).getByRole("button", { name: "Expand Sample record tabs · 26" }));
  expect(within(rows).getAllByRole("button", { name: /^↳ Detail/ })).toHaveLength(26);
  const row = within(rows).getByRole("button", { name: "↳ Detail 0", exact: true }).closest("tr")!;
  expect(within(row).queryByText("Frame: pending")).toBeNull();
  expect(within(row).queryByText("Layout: pending")).toBeNull();
  expect(within(row).getByText("States: waiting")).toBeVisible();
});

it("configures only parent pages, keeps tabs at their five own stages, and resets without adoption", () => {
  const inventory = projectAppInventory(genericInventory());
  const settings = { format: "web.page.responsive" as const, frame: { leaf: "frames.app-shell" as const }, layout: { leaf: "layouts.stack" as const, config: "stack.index" } };
  const { rerender } = render(<AppPack inventory={inventory} productionSettings={{ "sample.record": settings }} />);
  const chip = screen.getByRole("button", { name: /^Open Sample record/ });
  expect(chip.closest("td")?.cellIndex).toBe(2);
  fireEvent.click(screen.getByRole("button", { name: /Expand Record/ }));
  fireEvent.click(screen.getByRole("button", { name: "Expand Sample record tabs · 1" }));
  fireEvent.click(screen.getByRole("button", { name: "↳ Overview" }));
  const detail = screen.getByRole("heading", { name: "Overview · route details" }).closest("section")!;
  expect(within(detail).getByRole("list", { name: "Full App publish stages" }).children).toHaveLength(5);
  expect(within(detail).getByText("States: pending")).toBeVisible();
  expect(within(detail).queryByRole("form", { name: "Production settings" })).toBeNull();
  expect(within(detail).getByText(/Production settings inherited from parent page/)).toBeVisible();
  rerender(<AppPack inventory={inventory} productionSettings={{}} />);
  expect(screen.getByRole("button", { name: /^Open Sample record/ }).closest("td")?.cellIndex).toBe(1);
  expect(within(detail).getByText("States: waiting")).toBeVisible();
  expect(screen.queryByText(/static checks pass/i)).toBeNull();
});

it("moves a bound page using real checks and retains source/effective findings", () => {
  const f = appBindingFixture();
  const { rerender } = render(<AppPack {...f} productionSettings={f.settings} compiler={fixtureCompiler} />);
  let chip = screen.getByRole("button", { name: /^Open Sample record/ });
  expect(chip.closest("td")?.cellIndex).toBe(6);
  expect(chip).toHaveTextContent("pending · 0 findings");
  expect(screen.getByText("App frame leaves: frames.app-shell")).toBeVisible();
  f.fills.delete(key("frames.app-shell", "page"));
  rerender(<AppPack {...f} productionSettings={f.settings} compiler={fixtureCompiler} />);
  chip = screen.getByRole("button", { name: /^Open Sample record/ });
  expect(chip.closest("td")?.cellIndex).toBe(2);
  expect(chip).toHaveTextContent("failed");
  fireEvent.click(chip);
  expect(screen.getByRole("heading", { name: "Source binding findings" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Effective binding findings" })).toBeVisible();
  const details = screen.getByRole("heading", { name: "Sample record · route details" }).closest("section")!;
  expect(within(details).getByText("Frame: failed")).toBeVisible();
  expect(screen.queryByText("Ready: passed")).toBeNull();
});

it("keeps nested subrows inherited and local States pending with real parent metadata", () => {
  const f = appBindingFixture();
  render(<AppPack {...f} productionSettings={f.settings} compiler={fixtureCompiler} />);
  fireEvent.click(screen.getByRole("button", { name: "Expand Record · 1 pages" }));
  fireEvent.click(screen.getByRole("button", { name: "Expand Sample record tabs · 2" }));
  fireEvent.click(screen.getByRole("button", { name: "↳ Details" }));
  const section = screen.getByRole("heading", { name: "Details · route details" }).closest("section")!;
  expect(within(section).getByText("States: pending")).toBeVisible();
  expect(within(section).queryByRole("form", { name: "Production settings" })).toBeNull();
  expect(within(section).getByRole("list", { name: "Full App publish stages" }).children).toHaveLength(5);
});

it("lets the host override new evidence copy and input questions", () => {
  const f = appBindingFixture();
  render(<AppPack inventory={f.inventory} productionSettings={f.settings} messages={{ pageSummary: count => `Pages supplied: ${count}`, findingCountLabel: count => `Observed: ${count}`, defaultSettingsDescription: "Supplied planning description" }} pipelineMessages={{ bindingQuestion: "Select an owned page assembly" }} />);
  expect(screen.getByText("Pages supplied: 1")).toBeVisible();
  const chip = screen.getByRole("button", { name: /^Open Sample record/ });
  expect(chip).toHaveTextContent("Observed: 0");
  expect(chip).toHaveTextContent("Select an owned page assembly");
  fireEvent.click(screen.getByRole("button", { name: "Expand Record · 1 pages" }));
  const routeTable = screen.getByRole("table", { name: "Record routes" });
  expect(within(routeTable).getAllByRole("cell").filter(cell => cell.textContent?.includes("Supplied planning description"))).toHaveLength(2);
  expect(screen.queryByText(/Planner default only · adoption unverified/)).toBeNull();
});

it("shows explicitly supplied planning questions on a configured App chip and drill-in", () => {
  const settings = { format: "web.page.responsive" as const, frame: { leaf: "frames.app-shell" as const }, layout: { leaf: "layouts.stack" as const, config: "stack.index" } };
  const request = { slot: "record.primary-action", question: "Which action should open this record?" };
  render(<AppPack inventory={projectAppInventory(genericInventory())} productionSettings={{ "sample.record": settings }} inputRequests={{ "sample.record": [request] }} />);
  const chip = screen.getByRole("button", { name: /Open Sample record .* needs input/ });
  expect(chip).toHaveTextContent(request.slot);
  expect(chip).toHaveTextContent(request.question);
  fireEvent.click(chip);
  const detail = screen.getByRole("heading", { name: "Sample record · route details" }).closest("section")!;
  expect(within(detail).getByRole("list", { name: "Blocking input questions" })).toHaveTextContent(request.question);
  expect(within(detail).queryByText(/failed/i)).toBeNull();
});
