import type { ReactElement } from "react";
import { seeded, specimenDataset } from "./specimen-dataset.js";

/**
 * The image an image-ratio specimen crops: an abstract landscape generated from the shared
 * specimen dataset's fixture geometry, seed and generator, so it is this package's own work (no
 * photograph or font licence) and identical on every render. It is drawn in the fixed neutral references, which do not flip with the theme, the way
 * a photograph would not, and it covers its frame (`slice`), so each ratio shows the crop that
 * ratio makes of one picture.
 */
const FIXTURE = specimenDataset.assets.ratioFixture;
/** The fixture's view box, from the shared specimen dataset. */
export const RATIO_FIXTURE_VIEWBOX = FIXTURE.viewBox;

export interface RatioFixtureShapes {
  readonly sun: { readonly cx: number; readonly cy: number; readonly r: number };
  readonly ridges: readonly { readonly d: string; readonly fill: string }[];
}

/** The picture as plain shape data: a sun and four ridges, integer coordinates in the view box. */
export function ratioFixtureShapes(seed: number = FIXTURE.seed): RatioFixtureShapes {
  const next = seeded(seed), { width, height } = RATIO_FIXTURE_VIEWBOX, { sun: at, samples } = FIXTURE;
  const sun = { cx: Math.round(width * (at.x.from + next() * at.x.span)), cy: Math.round(height * (at.y.from + next() * at.y.span)), r: Math.round(height * at.radius) };
  const ridges = FIXTURE.ridges.map(({ base, amplitude, fill }) => {
    const waves = FIXTURE.frequencies.map(frequency => ({ frequency, phase: next() * Math.PI * 2, weight: next() / frequency }));
    const total = waves.reduce((sum, wave) => sum + wave.weight, 0);
    const points = Array.from({ length: samples + 1 }, (_, index) => {
      const x = index / samples;
      const swell = waves.reduce((sum, wave) => sum + wave.weight * Math.sin(x * Math.PI * 2 * wave.frequency + wave.phase), 0) / total;
      return `${Math.round(x * width)} ${Math.round(height * (base + amplitude * swell))}`;
    });
    return { d: `M0 ${height}L${points.join("L")}L${width} ${height}Z`, fill };
  });
  return { sun, ridges };
}

const SHAPES = ratioFixtureShapes();

/** The fixture image, decorative, covering whatever ratio frame it is placed in. */
export function RatioFixture(): ReactElement {
  const { width, height } = RATIO_FIXTURE_VIEWBOX;
  return <svg data-ratio-fixture="" aria-hidden="true" focusable="false" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid slice" className="block h-full w-full">
    <rect width={width} height={height} className="fill-neutral-100" />
    <circle cx={SHAPES.sun.cx} cy={SHAPES.sun.cy} r={SHAPES.sun.r} className="fill-neutral-50" />
    {SHAPES.ridges.map(ridge => <path key={ridge.fill} d={ridge.d} className={ridge.fill} />)}
  </svg>;
}
