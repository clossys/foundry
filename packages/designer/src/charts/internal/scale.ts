/**
 * Minimal, dependency-free scale helpers — internal to this package, not a
 * public numerical library (see this package's README: "Dependency-free
 * SVG. Do not add a charting library."). Each scale is a pure function from
 * a data domain to a pixel range; every chart in this layer computes its
 * own marks by calling one of these rather than reaching for d3-scale or
 * similar.
 */

/** A linear (continuous, numeric) scale: `[domainMin, domainMax] -> [rangeMin, rangeMax]`. */
export interface LinearScale {
  (value: number): number;
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
}

/**
 * Magnitude -> pixel. Boundary behavior: `domain[0]` maps exactly to
 * `range[0]`, `domain[1]` maps exactly to `range[1]` — the property every
 * scale boundary test in this layer checks. A degenerate domain
 * (`domainMin === domainMax`) maps every value to `range[0]` rather than
 * dividing by zero.
 */
export function linearScale(domain: readonly [number, number], range: readonly [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const scale = ((value: number) => {
    if (span === 0) return r0;
    const t = (value - d0) / span;
    return r0 + t * (r1 - r0);
  }) as LinearScale;
  Object.assign(scale, { domain, range });
  return scale;
}

/** A band (discrete, categorical) scale: one fixed-width slot per category, with a padding gap. */
export interface BandScale {
  /** Left edge (in `range` units) of `key`'s band. Throws if `key` is not in the domain. */
  (key: string): number;
  readonly bandwidth: number;
  readonly domain: readonly string[];
  readonly range: readonly [number, number];
}

/**
 * Category -> pixel band. `paddingRatio` (default 0.2) is the fraction of
 * each step reserved as inter-band gap, split evenly on both sides of every
 * band — the same shape d3's `scaleBand` uses, reimplemented here without
 * the dependency. An empty domain produces a scale whose `bandwidth` is the
 * full range width and which throws for any key (nothing to index into).
 */
export function bandScale(
  domain: readonly string[],
  range: readonly [number, number],
  paddingRatio = 0.2,
): BandScale {
  const [r0, r1] = range;
  const total = r1 - r0;
  const n = domain.length;
  const step = n > 0 ? total / n : total;
  const bandwidth = step * (1 - paddingRatio);
  const sidePad = (step - bandwidth) / 2;
  const index = new Map(domain.map((key, i) => [key, i]));

  const scale = ((key: string) => {
    const i = index.get(key);
    if (i === undefined) {
      throw new RangeError(`bandScale: "${key}" is not in the domain (${domain.join(", ") || "<empty>"})`);
    }
    return r0 + i * step + sidePad;
  }) as BandScale;
  Object.assign(scale, { bandwidth, domain, range });
  return scale;
}

/** A time scale: `[startDate, endDate] -> [rangeMin, rangeMax]`, implemented as a linear scale over millisecond timestamps. */
export interface TimeScale {
  (value: Date | number): number;
  readonly domain: readonly [Date, Date];
  readonly range: readonly [number, number];
}

export function timeScale(domain: readonly [Date, Date], range: readonly [number, number]): TimeScale {
  const numeric = linearScale([domain[0].getTime(), domain[1].getTime()], range);
  const scale = ((value: Date | number) => numeric(typeof value === "number" ? value : value.getTime())) as TimeScale;
  Object.assign(scale, { domain, range });
  return scale;
}

/**
 * "Nice" round tick values spanning `[min, max]` — 0, a clean step, up to a
 * round number at or past `max` (see the visualization reference: "Y-axis
 * ticks: round to clean numbers... thousands-comma'd"). `count` is a
 * target, not a guarantee — the actual number of ticks is whatever the
 * nicest step produces.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min];
  const span = max - min;
  const rawStep = span / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const niceNormalized = normalized >= 5 ? 10 : normalized >= 2 ? 5 : normalized >= 1 ? 2 : 1;
  const step = niceNormalized * magnitude;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) {
    ticks.push(Math.round(v * 1e10) / 1e10); // guard against float drift (0.1 + 0.2 style)
  }
  return ticks;
}

/** Thousands-comma formatting for an axis tick or direct label — the default `valueFormat` every chart in this layer falls back to. */
export function formatTickValue(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
