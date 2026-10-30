import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runtimeHash, type RuntimeContent, type RuntimeFillDescriptor, type RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import type { CompositeResolved } from "../../catalog-core/types.js";
import { scanProvenance } from "../../catalog-core/provenance-scan.js";
import { renderLogoCloudSection } from "./logo-cloud.js";
import { renderTestimonialsSection } from "./testimonials.js";
import { renderStats } from "./stats.js";
import { renderGallerySection } from "./gallery.js";

const here = dirname(fileURLToPath(import.meta.url));
function input(leaf: string, values: Record<string, unknown>, members: string[]): RuntimeRenderInput<ReactNode> {
  const doc = JSON.parse(readFileSync(resolve(here, `../../catalog/fills/foundry/sections.${leaf}.json`), "utf8"));
  const row = doc.sections[leaf];
  const content = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { reference: { kind: key === "controls" ? "copy" : "records", ref: `proof:${key}` }, hash: runtimeHash(value), value }])) as Record<string, RuntimeContent>;
  const fill = { kind: "section", library: "foundry", fill: `foundry/sections.${leaf}`, leaf: `sections.${leaf}`, config: null, slots: Object.keys(row.slotMap), members: Object.keys(row.propMap), states: ["default"], renderer: { id: "proof", source: { entry: "index.ts", files: {}, dependencies: {} }, sourceHash: runtimeHash("proof") } } as RuntimeFillDescriptor;
  return { fill, content, selection: { leaf: fill.leaf, fill: fill.fill, config: null, members, content: Object.fromEntries(Object.entries(content).map(([key, value]) => [key, value.reference])) }, path: "sections.main.0", slots: {}, cell: { theme: "light", state: "default", width: 1280 }, profile: {} as CompositeResolved };
}
function assertRoot(container: HTMLElement, leaf: string) {
  expect(container.firstElementChild).toHaveAttribute("data-ds-leaf", `sections.${leaf}`);
  const findings = scanProvenance({ html: `<main data-ds-layer="pages" data-ds-leaf="pages.proof" data-ds-fill="foundry/pages.proof">${container.innerHTML}</main>`, route: { id: "proof", binding: { frame: { leaf: "frames.none" }, frameSlots: {}, sections: { main: [{ leaf: `sections.${leaf}` }] } } }, selection: { [`sections.${leaf}`]: `foundry/sections.${leaf}` } }).findings;
  expect(findings).toEqual([]);
}
beforeEach(() => vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))));
afterEach(() => vi.unstubAllGlobals());
describe("native proof member adoption", () => {
  it("maps marquee and authored controls while preserving the section root provenance", () => {
    const { container } = render(<>{renderLogoCloudSection(input("logo-cloud", { logos: Array.from({ length: 3 }, (_, i) => ({ id: String(i), name: "Example Co.", src: "/example.svg" })), controls: { pause: "Pause motion", resume: "Resume motion" } }, ["count.3", "motion.marquee"]))}</>);
    expect(screen.getByRole("button", { name: "Pause motion" })).toBeInTheDocument();
    assertRoot(container, "logo-cloud");
  });
  it.each(["wall", "carousel"])("maps testimonial %s layout and keeps the stamped outer root", layout => {
    const { container } = render(<>{renderTestimonialsSection(input("testimonials", { quotes: Array.from({ length: 3 }, (_, i) => ({ id: String(i), quote: `Shared foundation ${i}.`, attributorName: "Example Co." })), controls: { previous: "Previous quote", next: "Next quote" } }, [`layout.${layout}`]))}</>);
    expect(container.firstElementChild).toHaveAttribute("data-layout", layout);
    if (layout === "carousel") expect(screen.getByRole("button", { name: "Next quote" })).toBeInTheDocument();
    assertRoot(container, "testimonials");
  });
  it("maps stats count motion and retains the authored final value", () => {
    const { container } = render(<>{renderStats(input("stats", { stats: [{ id: "one", label: "Completed tasks", value: "1,200", countTo: 1200 }] }, ["motion.count"]))}</>);
    expect(container.firstElementChild).toHaveAttribute("data-motion", "count");
    expect(container.querySelector("[data-stats-count]")).toHaveTextContent("1,200");
    assertRoot(container, "stats");
  });
  it("maps authored Gallery controls into the shared dialog trigger", () => {
    const { container } = render(<>{renderGallerySection(input("gallery", {
      images: { label: "Image gallery", items: [{ id: "one", label: "Example image", media: { kind: "mark", src: "/example.svg", title: "Example image" } }] },
      controls: { close: "Close image", enlarge: "Enlarge image" },
    }, ["lightbox.enabled"]))}</>);
    expect(screen.getByRole("button", { name: "Enlarge image Example image" })).toBeInTheDocument();
    assertRoot(container, "gallery");
  });
  it.each([["motion.unknown"], ["motion.static", "motion.count"]])("refuses unknown or conflicting stats motion %j", (...members) => {
    expect(() => renderStats(input("stats", { stats: [] }, members))).toThrow(/unknown or conflicting motion/);
  });
});
