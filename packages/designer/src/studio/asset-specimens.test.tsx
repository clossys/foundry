import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SvgSpecimen } from "./asset-specimens.js";

afterEach(cleanup);

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" color="#111111"><circle cx="24" cy="24" r="20" fill="currentColor"/></svg>';
const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
const show = (slot: string, role: string): HTMLElement => {
  const view = render(<SvgSpecimen id={`${slot}.${role}`} slot={slot} svg={svg} />);
  return view.container.querySelector<HTMLElement>("[data-asset-specimen]")!;
};
const sized = (root: Element, side: number): HTMLImageElement[] =>
  [...root.querySelectorAll<HTMLImageElement>("img")].filter(image => image.getAttribute("width") === String(side) && image.getAttribute("height") === String(side));

describe("favicon specimen", () => {
  it("shows the favicon in tab chrome at exactly 16 CSS px and again at exactly 32 CSS px, sized by attributes, never inline style", () => {
    const specimen = show("assets.favicon", "vector");
    expect(specimen.getAttribute("data-asset-specimen")).toBe("favicon");
    const tab = specimen.querySelector("[role='tablist'] [role='tab']");
    expect(tab).not.toBeNull();
    expect(sized(tab!, 16)).toHaveLength(1);
    expect(sized(specimen, 32)).toHaveLength(1);
    for (const image of [...sized(specimen, 16), ...sized(specimen, 32)]) {
      expect(image.getAttribute("src")).toBe(uri);
      expect(image.hasAttribute("style")).toBe(false);
      expect(image.getAttribute("alt")).toBe("");
    }
    expect(specimen.querySelectorAll("img")).toHaveLength(2);
  });

  it("labels each size with its pixels, and the tab it draws is one the tab panel answers", () => {
    const specimen = show("assets.favicon", "vector");
    expect(specimen.textContent).toContain("16 px");
    expect(specimen.textContent).toContain("32 px");
    const tab = specimen.querySelector("[role='tab']")!;
    const panel = specimen.querySelector("[role='tabpanel']");
    expect(panel?.id).toBe(tab.getAttribute("aria-controls"));
  });
});

describe("app-icon specimen", () => {
  it("overlays the maskable icon's safe zone: a circle at 80 percent of the side, the ratio the identity badge keeps its symbol inside", () => {
    const specimen = show("assets.app-icon", "maskable");
    const zone = specimen.querySelector<SVGElement>("[data-safe-zone]");
    expect(zone).not.toBeNull();
    expect(zone!.getAttribute("aria-hidden")).toBe("true");
    const box = zone!.getAttribute("viewBox")!.split(" ").map(Number);
    const circle = zone!.querySelector("circle")!;
    expect(box[0]).toBe(0);
    expect(box[1]).toBe(0);
    expect(box[2]).toBe(box[3]);
    expect(Number(circle.getAttribute("cx"))).toBe(box[2]! / 2);
    expect(Number(circle.getAttribute("cy"))).toBe(box[3]! / 2);
    expect((2 * Number(circle.getAttribute("r"))) / box[2]!).toBeCloseTo(0.8, 10);
    expect(zone!.getAttribute("style")).toBeNull();
    // The overlay sits over the artwork, in the same box as the image it marks.
    expect(zone!.parentElement?.querySelector(`img[src='${uri}']`)).not.toBeNull();
  });

  it("draws no safe zone on the standard icon, whose rounded plate the platform does not mask", () => {
    const specimen = show("assets.app-icon", "standard");
    expect(specimen.getAttribute("data-asset-specimen")).toBe("app-icon");
    expect(specimen.querySelector("[data-safe-zone]")).toBeNull();
    expect(specimen.querySelectorAll("img")).toHaveLength(1);
  });
});
