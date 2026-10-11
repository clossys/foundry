import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnatomyCallouts, type AnatomyCalloutsMarker } from "./AnatomyCallouts.js";
import type { SpecimenPanelContent } from "./specimen/SpecimenPanel.js";

const sourceDir = dirname(fileURLToPath(import.meta.url));

const panel: SpecimenPanelContent = {
  title: "Leverage exception",
  parts: [
    { id: "result", type: "fields", label: "Result", items: [{ id: "latest", label: "Latest result", value: "3.00x" }] },
    { id: "sources", type: "files", label: "Sources", items: [{ id: "certificate", format: "PDF", name: "Compliance certificate" }] },
    { id: "response", type: "fields", label: "Response", items: [{ id: "plan", label: "Plan", value: "30-day cure" }] },
  ],
  footer: { note: "Review exception" },
};
const targets = ["header", "result", "sources", "response", "footer"];
function markers(count = 3): AnatomyCalloutsMarker[] {
  const selected = count === 3 ? ["result", "sources", "footer"] : targets.slice(0, count);
  return selected.map((target, index) => ({ id: `area-${index}`, target, heading: ["The result", "Its sources", "The owner"][index] ?? "Response", description: "The tested figure beside its limit." }));
}
function view(overrides: Partial<Parameters<typeof AnatomyCallouts>[0]> = {}) {
  return <AnatomyCallouts id="exception" label="Sample exception record with three numbered areas explained in the key." panel={panel} markers={markers()} keyLabel="Key" {...overrides} />;
}

describe("AnatomyCallouts", () => {
  it("links each figure name and key description to existing stable caller-seeded ids", () => {
    const { container } = render(<>{view()}{view({ id: "exception-key" })}</>);
    for (const figure of screen.getAllByRole("figure")) {
      expect(figure.getAttribute("aria-labelledby")).toMatch(/-label$/);
      expect(figure.getAttribute("aria-describedby")).toMatch(/-key$/);
      expect(container.querySelector(`[id="${figure.getAttribute("aria-labelledby")}"]`)).toHaveTextContent("Sample exception record");
      expect(container.querySelector(`[id="${figure.getAttribute("aria-describedby")}"]`)?.tagName).toBe("OL");
    }
    const ids = [...container.querySelectorAll("[id]")].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each([3, 4, 5])("renders %i ordered key items and matching hidden inline marker numerals", count => {
    const { container } = render(view({ markers: markers(count) }));
    const key = screen.getByRole("list", { name: "Key" });
    const items = within(key).getAllByRole("listitem");
    expect(items).toHaveLength(count);
    const discs = [...container.querySelectorAll("[data-anatomy-marker]")];
    expect(discs).toHaveLength(count);
    for (const [index, disc] of discs.entries()) {
      expect(disc).toHaveAttribute("aria-hidden", "true");
      expect(disc).toHaveTextContent(String(index + 1));
      expect(disc.parentElement?.firstChild).toBe(disc);
      expect(disc).toHaveClass("anatomy-disc", "rounded-pill", "bg-ink-primary", "text-surface-raised", "text-caption", "font-semibold", "tabular-nums");
      const item = items[index]!;
      expect(within(item).getByRole("heading", { level: 3 })).toBeInTheDocument();
      expect(item.querySelector("p")).toHaveTextContent("The tested figure beside its limit.");
      expect(item.firstElementChild).toHaveAttribute("aria-hidden", "true");
      expect(item.firstElementChild).toHaveTextContent(String(index + 1));
    }
    const figure = screen.getByRole("figure");
    expect(figure.compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(figure.querySelector("[tabindex], [href], button, input, select, textarea, [role=button]")).toBeNull();
  });

  it("uses token classes and the responsive 8:4 end grid only for an end legend", () => {
    const { container, rerender } = render(view({ sample: "Sample data.", ground: "inverse", headingLevel: 4, className: "caller", style: { opacity: 0.9 } }));
    expect(container.firstChild).toHaveClass("grid", "gap-2xl", "tablet-lg:anatomy-columns", "tablet-lg:gap-x-3xl", "caller");
    expect(container.firstChild).toHaveAttribute("data-legend-side", "end");
    expect(screen.getByText("Sample data.").tagName).toBe("FIGCAPTION");
    const item = within(screen.getByRole("list", { name: "Key" })).getAllByRole("listitem")[1]!;
    expect(item).toHaveClass("py-lg", "gap-x-md", "gap-y-xs", "border-line-on-inverse");
    expect(item.style.borderBlockStartWidth).toContain("--ui-border-hairline");
    expect(item.firstElementChild).toHaveClass("bg-ink-on-inverse", "text-surface-inverse");
    expect(within(item).getByRole("heading", { level: 4 })).toHaveClass("text-h2", "leading-heading", "font-semibold");
    expect(item.querySelector("p")).toHaveClass("text-body", "text-ink-on-inverse-muted");
    rerender(view({ legendSide: "below", ground: "sunken" }));
    expect(container.firstChild).not.toHaveClass("tablet-lg:anatomy-columns", "tablet-lg:gap-x-3xl");
    expect(screen.getByRole("list", { name: "Key" }).parentElement).toHaveClass("anatomy-key-measure");
    expect(container.querySelector("[data-anatomy-key-number]")).toHaveClass("bg-ink-primary", "text-surface-sunken");
    expect(container.querySelector("figcaption")).toBeNull();
  });

  it.each([2, 6])("refuses %i markers", count => {
    const values = Array.from({ length: count }, (_, i) => ({ id: `m${i}`, target: targets[i % targets.length]!, heading: "The result", description: "The tested figure beside its limit." }));
    expect(() => renderToStaticMarkup(view({ markers: values }))).toThrow(RangeError);
  });
  it("refuses missing instance ids and duplicate marker ids or targets", () => {
    const values = markers();
    for (const invalid of [
      view({ id: "" }),
      view({ markers: [values[0]!, { ...values[1]!, id: values[0]!.id }, values[2]!] }),
      view({ markers: [values[0]!, { ...values[1]!, target: values[0]!.target }, values[2]!] }),
      view({ panel: { ...panel, parts: panel.parts.map(p => ({ ...p, id: "same" })) } }),
    ]) expect(() => renderToStaticMarkup(invalid)).toThrow(TypeError);
  });
  it("refuses unknown or unlabelled targets", () => {
    const values = markers();
    for (const invalid of [
      view({ markers: [{ ...values[0]!, target: "missing" }, values[1]!, values[2]!] }),
      view({ panel: { ...panel, title: undefined }, markers: markers(5) }),
      view({ panel: { ...panel, footer: undefined } }),
      view({ panel: { ...panel, parts: panel.parts.map(p => p.id === "result" ? { ...p, label: undefined } : p) } }),
    ]) expect(() => renderToStaticMarkup(invalid)).toThrow(RangeError);
  });
  it("supports authored node labels without stringifying React elements in ARIA attributes", () => {
    render(view({ label: <span>Sample exception record.</span>, keyLabel: <span>Its sources</span> }));
    expect(screen.getByRole("figure", { name: "Sample exception record." })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Its sources" })).toBeInTheDocument();
  });
  it("refuses marker order that disagrees with actual header, parts and footer reading order", () => {
    const values = markers(5);
    expect(() => renderToStaticMarkup(view({ markers: [...values].reverse() }))).toThrow(TypeError);
    expect(() => renderToStaticMarkup(view({ panel: { ...panel, parts: [...panel.parts].reverse() } }))).toThrow(TypeError);
  });
  it("requires caller labels and exports a hook-free component for server rendering", async () => {
    expect(() => renderToStaticMarkup(view({ label: undefined }))).toThrow(TypeError);
    expect(() => renderToStaticMarkup(view({ keyLabel: undefined }))).toThrow(TypeError);
    const server = await import("./server.js");
    expect(server.AnatomyCallouts).toBe(AnatomyCallouts);
    const html = renderToStaticMarkup(view());
    expect(html).toBe(renderToStaticMarkup(view()));
    expect(readFileSync(resolve(sourceDir, "AnatomyCallouts.tsx"), "utf8")).not.toMatch(/useId|useState|useEffect|useRef|use client/);
    const utilities = readFileSync(resolve(sourceDir, "../../styles/theme-keys.css"), "utf8");
    expect(utilities).toMatch(/@utility anatomy-disc\s*\{[^}]*inline-size: var\(--ui-icon-md, var\(--spacing-xl, 24px\)\)[^}]*block-size: var\(--ui-icon-md, var\(--spacing-xl, 24px\)\)/);
    expect(utilities).toContain("@utility anatomy-key-measure { max-inline-size: var(--ui-width-prose-max, 48rem); }");
    expect(utilities).toMatch(/@utility anatomy-columns\s*\{[^}]*grid-template-columns: minmax\(0, 8fr\) minmax\(0, 4fr\)/);
  });
});
