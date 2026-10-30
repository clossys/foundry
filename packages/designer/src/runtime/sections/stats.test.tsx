import { beforeAll, describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { renderStats } from "./stats.js";
import type { SectionRenderInput } from "./group-b-support.js";
import { a270StatsContribution, a270StatsSpecimen } from "../../studio/a270-stats.contribution.js";
import { nativeStatsMarkup, nativeStatsSelection, nativeStatsTree } from "../../blocks/Stats/__fixtures__/native.js";

let selection: Awaited<ReturnType<typeof nativeStatsSelection>>;
beforeAll(async () => { selection = await nativeStatsSelection(); });
function input(values: unknown = a270StatsSpecimen.items, state = "default"): SectionRenderInput {
  return JSON.parse(JSON.stringify({ fill: { leaf: "sections.stats" }, selection: { leaf: "sections.stats", members: ["layout.grid"] }, cell: { state }, content: { stats: { value: values } }, sectionHost: a270StatsContribution.specimenHost, slots: {} }));
}
describe("sections.stats selected runtime and Studio contribution", () => {
  it("renders the registered section fixture through the actual selected Card source", async () => {
    const { container } = render(nativeStatsTree(selection, renderStats(input())));
    const list = await screen.findByRole("list", { name: "ExampleCo key figures" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(container.querySelectorAll('[data-slot="card"]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-slot="card-content"]')).toHaveLength(4);
    expect(screen.getByText("2,481")).toBeVisible();
    expect(container.querySelector('section[data-ds-leaf="sections.stats"]')).toBeTruthy();
  });
  it("honors row selection and caller copy rather than specimen copy", async () => {
    const value = input([{ id: "one", label: "Writer customers", value: 91, delta: "+2", trend: "up" }]);
    value.selection.members = ["layout.row"];
    value.sectionHost = { statsCopy: { label: "Writer figures", trendLabels: { up: "Writer rising", down: "Writer falling", neutral: "Writer level" } } };
    const html = await nativeStatsMarkup(selection, renderStats(value));
    expect(html).toContain('data-layout="row"'); expect(html).toContain("Writer customers"); expect(html).toContain("Writer rising");
    expect(html).not.toMatch(/ExampleCo|Active users|Key figures|Increase/);
  });
  it.each(["loading", "empty", "error"] as const)("renders the %s copy from its explicit host port", async state => {
    const html = await nativeStatsMarkup(selection, renderStats(input([], state)));
    expect(html).toContain(a270StatsContribution.specimenHost.statsCopy.states![state].label);
    expect(html).not.toContain('data-slot="card"');
    expect(html).toContain(state === "error" ? 'role="alert"' : 'role="status"');
  });
  it("refuses missing copy, malformed records, invalid layouts and foreign leaves", () => {
    const missing = input(); missing.sectionHost = undefined;
    expect(() => renderStats(missing)).toThrow(/NEED sections.stats statsCopy host port/);
    const trendCopy = input(); trendCopy.sectionHost = { statsCopy: { label: "Writer figures", trendLabels: { up: "Up" } } };
    expect(() => renderStats(trendCopy)).toThrow(/statsCopy.trendLabels/);
    expect(() => renderStats(input([{ id: "one", label: "Writer metric" }]))).toThrow(/stats.0.value/);
    expect(() => renderStats(input([{ id: "one", label: "Writer metric", value: 1, countTo: "2" }]))).toThrow(/countTo/);
    const layout = input(); layout.selection.members = ["layout.grid", "layout.row"];
    expect(() => renderStats(layout)).toThrow(/one supported layout/);
    const foreign = input(); foreign.fill.leaf = "sections.hero";
    expect(() => renderStats(foreign)).toThrow(/matching selected leaf/);
  });
  it("refuses unbound state copy and an invalid motion request", () => {
    const state = input([], "error"); state.sectionHost = { statsCopy: { label: "Writer figures", trendLabels: { up: "Up", down: "Down", neutral: "Level" } } };
    expect(() => renderStats(state)).toThrow(/statsCopy.states.error/);
    const motion = input(); motion.sectionHost = { ...a270StatsContribution.specimenHost, statsMotion: "repeat" };
    expect(() => renderStats(motion)).toThrow(/statsMotion static or count/);
  });
  it("refuses unavailable native modules with a visible NEED instead of a fallback Card", async () => {
    const missing = { ...selection, modules: {} };
    await expect(nativeStatsMarkup(missing, renderStats(input()))).rejects.toThrow(/NEED component selection/);
  });
});
