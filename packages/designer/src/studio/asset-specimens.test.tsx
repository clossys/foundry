import { readFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { parseRootDeclarations } from "../tokens/internal/parse-css.js";
import { contrastRatio } from "../tokens/color.js";
import { AA_LARGE } from "../tokens/contrast-pairs.js";
import { IconSpecimen, SvgSpecimen } from "./asset-specimens.js";

afterEach(cleanup);

const tokensCss = readFileSync(resolvePath(dirname(fileURLToPath(import.meta.url)), "../../styles/tokens.css"), "utf8");
const lightTokens = parseRootDeclarations(tokensCss);
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" color="#111111"><circle cx="24" cy="24" r="20" fill="currentColor"/></svg>';
const uri = `data:image/svg+xml,${encodeURIComponent(svg)}`;
const show = (slot: string, role: string): HTMLElement => {
  const view = render(<SvgSpecimen id={`${slot}.${role}`} slot={slot} svg={svg} />);
  return view.container.querySelector<HTMLElement>("[data-asset-specimen]")!;
};
const sized = (root: Element, side: number): HTMLImageElement[] =>
  [...root.querySelectorAll<HTMLImageElement>("img")].filter(image => image.getAttribute("width") === String(side) && image.getAttribute("height") === String(side));
/** The colour classes of an element and every ancestor up to the specimen root. */
const groundClasses = (element: Element): string[] => {
  const classes: string[] = [];
  for (let node: Element | null = element; node; node = node.parentElement) classes.push(...node.className.toString().split(/\s+/).filter(name => name.startsWith("bg-")));
  return classes;
};
/** A ground token that is declared once, at the root, and never redefined for the dark theme. */
const fixedPolarity = (token: string): boolean => (tokensCss.match(new RegExp(`${token}:`, "g")) ?? []).length === 1;

describe("specimen grounds follow the variant's role, never the theme", () => {
  const LIGHT = "bg-neutral-50", DARK = "bg-neutral-900";

  it.each([["positive", "light", LIGHT], ["mono", "light", LIGHT], ["reversed", "dark", DARK]])("%s sits on the %s ground", (role, ground, token) => {
    const specimen = show("assets.mark", role);
    const image = specimen.querySelector(`img[src='${uri}']`)!;
    expect(specimen.getAttribute("data-ground")).toBe(ground);
    expect(groundClasses(image)).toEqual([token]);
  });

  it("the app icon sits on the light ground", () => {
    const specimen = show("assets.app-icon", "standard");
    expect(groundClasses(specimen.querySelector("img")!)).toEqual([LIGHT]);
  });

  it("both grounds are neutral references that never flip, and each separates from the ink drawn for it", () => {
    for (const token of ["--color-neutral-50", "--color-neutral-900"]) expect(fixedPolarity(token), token).toBe(true);
    expect(fixedPolarity("--color-surface-base")).toBe(false);
    expect(contrastRatio(lightTokens.get("--color-ink-primary")!, lightTokens.get("--color-neutral-50")!)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrastRatio(lightTokens.get("--color-ink-on-inverse")!, lightTokens.get("--color-neutral-900")!)).toBeGreaterThanOrEqual(AA_LARGE);
  });
});

describe("favicon specimen", () => {
  it("shows the favicon at exactly 16, 32 and 48 CSS px on the light and the dark ground, sized by attributes, never inline style", () => {
    const specimen = show("assets.favicon", "vector");
    expect(specimen.getAttribute("data-asset-specimen")).toBe("favicon");
    expect(specimen.querySelector("[role='tablist']")).toBeNull();
    const grounds = [...specimen.querySelectorAll<HTMLElement>("[data-ground]")];
    expect(grounds.map(ground => ground.getAttribute("data-ground"))).toEqual(["light", "dark"]);
    expect(grounds.map(ground => groundClasses(ground))).toEqual([["bg-neutral-50"], ["bg-neutral-900"]]);
    for (const ground of grounds) {
      expect([...ground.querySelectorAll("img")].map(image => Number(image.getAttribute("width")))).toEqual([16, 32, 48]);
      for (const side of [16, 32, 48]) expect(sized(ground, side)).toHaveLength(1);
    }
    for (const image of specimen.querySelectorAll("img")) {
      expect(image.getAttribute("src")).toBe(uri);
      expect(image.hasAttribute("style")).toBe(false);
      expect(image.getAttribute("alt")).toBe("");
    }
    expect(specimen.querySelectorAll("img")).toHaveLength(6);
  });

  it("labels the sizes it draws in pixels", () => {
    expect(show("assets.favicon", "vector").textContent).toContain("16, 32, 48 px");
  });
});

describe("icon specimen", () => {
  it("draws the glyph once at each icon size token, smallest first, labelled with its name", () => {
    const view = render(<IconSpecimen glyph={[["circle", { cx: "12", cy: "12", r: "8" }]]} name="dot" />);
    const specimen = view.container.querySelector("[data-asset-specimen='icon']")!;
    const widths = [...specimen.querySelectorAll<SVGElement>("svg")].map(icon => icon.style.width);
    expect(widths.map(width => /--ui-icon-(sm|md|lg)/.exec(width)?.[1])).toEqual(["sm", "md", "lg"]);
    expect(specimen.textContent).toContain("dot");
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
