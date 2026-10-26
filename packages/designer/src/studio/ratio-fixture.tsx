import type { ReactElement } from "react";

/**
 * The image an image-ratio specimen crops: an abstract landscape generated here from a fixed
 * seed, so it is this package's own work (no photograph or font licence) and identical on every
 * render. It is drawn in the fixed neutral references, which do not flip with the theme, the way
 * a photograph would not, and it covers its frame (`slice`), so each ratio shows the crop that
 * ratio makes of one picture.
 */
export const RATIO_FIXTURE_VIEWBOX = { width: 1200, height: 800 } as const;
const SEED = 0x5eed;
/** Ridges back to front, each lighter behind the next: aerial perspective on the neutral ramp. */
const RIDGES = [
  { base: 0.5, amplitude: 0.09, fill: "fill-neutral-300" },
  { base: 0.62, amplitude: 0.08, fill: "fill-neutral-400" },
  { base: 0.74, amplitude: 0.07, fill: "fill-neutral-600" },
  { base: 0.86, amplitude: 0.05, fill: "fill-neutral-800" },
] as const;
const SAMPLES = 24;

/** A small deterministic generator (mulberry32): the same seed always yields the same picture. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RatioFixtureShapes {
  readonly sun: { readonly cx: number; readonly cy: number; readonly r: number };
  readonly ridges: readonly { readonly d: string; readonly fill: string }[];
}

/** The picture as plain shape data: a sun and four ridges, integer coordinates in the view box. */
export function ratioFixtureShapes(seed: number = SEED): RatioFixtureShapes {
  const next = random(seed), { width, height } = RATIO_FIXTURE_VIEWBOX;
  const sun = { cx: Math.round(width * (0.58 + next() * 0.16)), cy: Math.round(height * (0.26 + next() * 0.08)), r: Math.round(height * 0.09) };
  const ridges = RIDGES.map(({ base, amplitude, fill }) => {
    const waves = [1, 2, 5].map(frequency => ({ frequency, phase: next() * Math.PI * 2, weight: next() / frequency }));
    const total = waves.reduce((sum, wave) => sum + wave.weight, 0);
    const points = Array.from({ length: SAMPLES + 1 }, (_, index) => {
      const x = index / SAMPLES;
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
