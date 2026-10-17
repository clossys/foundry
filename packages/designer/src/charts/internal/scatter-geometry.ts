/** Finite numeric domains and unit-area marker geometry for a static scatter plot. */
export type ScatterMark = "circle" | "square" | "diamond" | "triangle";
const canonical = (value: number) => value === 0 ? 0 : value;

function reconstruct(value: number, decade: number) {
  const result = value * decade;
  return canonical(Number.isFinite(result) ? result : Math.sign(value) * Number.MAX_VALUE);
}
/** Parse generated decimal steps directly, avoiding two noisy binary products. */
function niceCandidate(index: number, step: number, decade: number) {
  const stepExponent = Math.floor(Math.log10(step));
  const factor = Math.round(step / 10 ** stepExponent);
  const coefficient = index * factor;
  const decadeExponent = Math.round(Math.log10(decade));
  const physicalStep = step * decade;
  if (Number.isSafeInteger(coefficient) && 10 ** decadeExponent === decade &&
      Number.isFinite(physicalStep) && physicalStep >= 2 ** -1022) {
    const value = Number(`${coefficient}e${stepExponent + decadeExponent}`);
    return canonical(Number.isFinite(value) ? value : Math.sign(coefficient) * Number.MAX_VALUE);
  }
  return reconstruct(index * step, decade);
}
function stepFor(low: number, high: number) {
  const raw = (high - low) / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  return power * (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10);
}
function normalization(low: number, high: number) {
  const magnitude = Math.max(Math.abs(low), Math.abs(high));
  const decade = 10 ** Math.floor(Math.log10(magnitude)) || Number.MIN_VALUE;
  return { magnitude, decade, low: low / decade, high: high / decade };
}

export function scatterAxis(observations: readonly number[], min?: number, max?: number) {
  if (observations.some(value => !Number.isFinite(value)) ||
      min !== undefined && !Number.isFinite(min) || max !== undefined && !Number.isFinite(max)) {
    throw new RangeError("ScatterChart requires finite coordinates and bounds.");
  }
  const dataLow = Math.min(...observations), dataHigh = Math.max(...observations);
  if (min !== undefined && dataLow < min || max !== undefined && dataHigh > max ||
      min !== undefined && max !== undefined && min >= max) {
    throw new RangeError("ScatterChart bounds must increase and contain every coordinate.");
  }
  let low = min ?? dataLow, high = max ?? dataHigh;
  if (low === high) {
    const value = low;
    if (value === 0) {
      if (min === undefined) low = -1;
      if (max === undefined) high = 1;
    } else {
      const delta = Math.abs(value) / 10;
      if (min === undefined && Number.isFinite(value - delta) && value - delta < value) low = value - delta;
      if (max === undefined && Number.isFinite(value + delta) && value + delta > value) high = value + delta;
      if (min === undefined && low === value) {
        const candidate = value > 0 ? value / 2 : value * 2;
        if (Number.isFinite(candidate) && candidate < value) low = candidate;
      }
      if (max === undefined && high === value) {
        const candidate = value > 0 ? value * 2 : value / 2;
        if (Number.isFinite(candidate) && candidate > value) high = candidate;
      }
    }
  }
  if (!(Number.isFinite(low) && Number.isFinite(high) && low < high)) {
    throw new RangeError("ScatterChart bounds need a finite increasing interval.");
  }
  const initial = normalization(low, high);
  const step = stepFor(initial.low, initial.high);
  if (initial.low < initial.high && step > 0 && Number.isFinite(step)) {
    if (min === undefined) low = Math.min(low, niceCandidate(Math.floor(initial.low / step), step, initial.decade));
    if (max === undefined) high = Math.max(high, niceCandidate(Math.ceil(initial.high / step), step, initial.decade));
  }
  low = canonical(low); high = canonical(high);
  const normalized = normalization(low, high);
  const tickStep = stepFor(normalized.low, normalized.high);
  // Include the adjacent candidates before filtering exact reconstructed values;
  // binary division must not drop a decimal endpoint such as 120 / 5.
  const first = Math.floor(normalized.low / tickStep), last = Math.ceil(normalized.high / tickStep);
  let ticks: number[] = [];
  if (tickStep > 0 && Number.isFinite(tickStep) && Number.isSafeInteger(first) &&
      Number.isSafeInteger(last) && last >= first && last - first < 16) {
    for (let index = first; index <= last; index++) {
      const value = niceCandidate(index, tickStep, normalized.decade);
      if (Number.isFinite(value) && value >= low && value <= high) ticks.push(value);
    }
    ticks = [...new Set(ticks)];
  }
  if (ticks.length < 2) {
    const span = high - low;
    ticks = [...new Set([0, .25, .5, .75, 1].map(fraction => canonical(
      fraction === 0 ? low : fraction === 1 ? high : Number.isFinite(span)
        ? low + fraction * span
        : reconstruct((low / normalized.magnitude) * (1 - fraction) + (high / normalized.magnitude) * fraction, normalized.magnitude),
    )).filter(value => Number.isFinite(value) && value >= low && value <= high))];
  }
  ticks.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const span = high - low;
  function position(value: number, start: number, end: number) {
    const fraction = value === low ? 0 : value === high ? 1 : Number.isFinite(span)
      ? (value - low) / span
      : (value / normalized.magnitude - low / normalized.magnitude) / (high / normalized.magnitude - low / normalized.magnitude);
    return start + Math.max(0, Math.min(1, fraction)) * (end - start);
  }
  return { low, high, ticks, position };
}

/** All four contours have area one and their geometric centroid at the origin. */
export function scatterGlyph(mark: ScatterMark, x: number, y: number, scale: number) {
  if (mark === "circle") {
    const radius = scale / Math.sqrt(Math.PI);
    return { radius, path: undefined, left: radius, right: radius, top: radius, bottom: radius };
  }
  let vertices: readonly (readonly [number, number])[];
  if (mark === "square") vertices = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]];
  else if (mark === "diamond") {
    const diagonal = 1 / Math.sqrt(2);
    vertices = [[0, -diagonal], [diagonal, 0], [0, diagonal], [-diagonal, 0]];
  } else {
    const edge = Math.sqrt(4 / Math.sqrt(3)), height = Math.sqrt(3) * edge / 2;
    vertices = [[0, -2 * height / 3], [edge / 2, height / 3], [-edge / 2, height / 3]];
  }
  const scaled = vertices.map(([dx, dy]) => [dx * scale, dy * scale] as const);
  const path = scaled.map(([dx, dy], index) => `${index ? "L" : "M"} ${canonical(x + dx)} ${canonical(y + dy)}`).join(" ") + " Z";
  return { radius: undefined, path,
    left: -Math.min(...scaled.map(([dx]) => dx)), right: Math.max(...scaled.map(([dx]) => dx)),
    top: -Math.min(...scaled.map(([, dy]) => dy)), bottom: Math.max(...scaled.map(([, dy]) => dy)) };
}
