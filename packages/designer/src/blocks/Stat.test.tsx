import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stat } from "./Stat.js";
import { nativeStatsMarkup, nativeStatsSelection, nativeStatsTree } from "./Stats/__fixtures__/native.js";

let selection: Awaited<ReturnType<typeof nativeStatsSelection>>;
beforeAll(async () => { selection = await nativeStatsSelection(); });
const labels = { up: "Sube", down: "Baja", neutral: "Sin cambio" };
describe("Stat on selected native Card", () => {
  it("renders actual Card anatomy with caller copy and value typography", async () => {
    const { container } = render(nativeStatsTree(selection, <Stat label="ExampleCo customers" value="2,481" description="Previous month" />));
    await screen.findByText("ExampleCo customers");
    expect(container.querySelector('[data-slot="card"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="card-header"]')).toHaveTextContent("ExampleCo customers");
    expect(container.querySelector('[data-slot="card-title"]')).toHaveClass("text-(length:--text-body-s)");
    expect(container.querySelector('[data-slot="card-content"]')).toHaveTextContent("2,481");
    expect(container.querySelector('[data-slot="card-content"]')).toHaveClass("text-(length:--text-h1)", "tabular-nums");
    expect(container.querySelector('[data-slot="card-footer"]')).toHaveTextContent("Previous month");
  });
  it.each([["up", "▲", "Sube"], ["down", "▼", "Baja"], ["neutral", "→", "Sin cambio"]] as const)("renders %s with shape and caller-owned accessible copy", async (trend, glyph, text) => {
    render(nativeStatsTree(selection, <Stat label="ExampleCo change" value={16} delta="+2" trend={trend} trendLabels={labels} />));
    expect(await screen.findByText(glyph)).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText(`${text},`)).toHaveClass("sr-only");
    expect(screen.queryByText(/Increase|Decrease|No change/)).toBeNull();
  });
  it("omits footer anatomy when supporting regions are absent", async () => {
    const html = await nativeStatsMarkup(selection, <Stat label="ExampleCo regions" value={16} />);
    expect(html).toContain('data-slot="card"');
    expect(html).not.toContain('data-slot="card-footer"');
  });
  it("refuses a delta without its authored trend label", () => {
    expect(() => Stat({ label: "ExampleCo customers", value: 12, delta: "+1" })).toThrow(/NEED Stats trendLabels.neutral/);
  });
  it("forwards consumer class and style to the selected Card", async () => {
    const { container } = render(nativeStatsTree(selection, <Stat label="ExampleCo regions" value={16} className="gap-lg" style={{ marginTop: "8px" }} />));
    await screen.findByText("ExampleCo regions");
    expect(container.querySelector('[data-slot="card"]')).toHaveClass("gap-lg");
    expect(container.querySelector('[data-slot="card"]')).toHaveStyle({ marginTop: "8px" });
  });
});
