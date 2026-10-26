import { afterEach, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { RatioSpecimen } from "./asset-specimens.js";
import { RATIO_FIXTURE_VIEWBOX, RatioFixture, ratioFixtureShapes } from "./ratio-fixture.js";

afterEach(cleanup);

it("generates the same abstract picture on every call, and a different one for another seed", () => {
  expect(ratioFixtureShapes()).toEqual(ratioFixtureShapes());
  expect(ratioFixtureShapes(7)).not.toEqual(ratioFixtureShapes());
  const { ridges, sun } = ratioFixtureShapes();
  expect(ridges).toHaveLength(4);
  for (const ridge of ridges) expect(ridge.d).toMatch(/^M0 800L(\d+ \d+L){25}1200 800Z$/);
  expect(sun.cx).toBeGreaterThan(0); expect(sun.cx).toBeLessThan(RATIO_FIXTURE_VIEWBOX.width);
});

it("ships a small, licence-free image: under 30 KB, no text, no external raster, only neutral-ramp fills", () => {
  const markup = renderToStaticMarkup(<RatioFixture />);
  expect(new TextEncoder().encode(markup).length).toBeLessThan(30 * 1024);
  expect(markup).not.toMatch(/<text|<image|href=|font-family|#[0-9a-f]{3,8}\b|rgba?\(/i);
  const fills = [...markup.matchAll(/class="([^"]+)"/g)].map(match => match[1]).filter(name => name !== "block h-full w-full");
  expect(fills.length).toBeGreaterThanOrEqual(6);
  for (const fill of fills) expect(fill).toMatch(/^fill-neutral-\d+$/);
});

it("fills every image-ratio specimen frame with the fixture, cropped to cover that ratio", () => {
  for (const [width, height] of [[3, 2], [1, 1], [9, 16]] as const) {
    const { container, unmount } = render(<RatioSpecimen width={width} height={height} />);
    const frame = [...container.querySelectorAll<HTMLElement>("*")].find(element => element.style.aspectRatio.replace(/\s/g, "") === `${width}/${height}`)!;
    const image = frame.querySelector("svg[data-ratio-fixture]")!;
    expect(image.getAttribute("preserveAspectRatio")).toBe("xMidYMid slice");
    expect(image.querySelectorAll("path")).toHaveLength(4);
    expect(frame.classList).toContain("overflow-hidden");
    unmount();
  }
});
