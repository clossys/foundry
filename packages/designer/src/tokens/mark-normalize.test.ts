import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { measureMarkGeometry, normalizeMark, checkMarkConformance, MarkGeometryError } from "./mark-normalize.js";
import { MARK_FIXTURES } from "./mark-fixtures.js";
import { adoptSuppliedMark, recolorSvg } from "./identity-kit.js";
import { judgeIdentityKit } from "./identity-checks.js";
const tokens = { ink: "#000000", onInverse: "#ffffff", surfaceBase: "#ffffff", surfaceInverse: "#000000", accent: "#000000", onAccent: "#ffffff", fontFamily: "sans-serif" };
const svg = (body: string) => `<svg viewBox="0 0 100 100">${body}</svg>`;
const box = (body: string) => measureMarkGeometry(svg(body)).glyphBox;
describe("round-one review regressions", () => {
  it.each(['x/onclick="alert(1)"', 'TRANSFORM="translate(90)"', 'STYLE="fill:url(https://example.invalid/x)"', 'OPACITY="0"', 'MASK="url(#x)"', 'FILL="none"', 'STROKE="#000"', 'STROKE-WIDTH="99"', 'transform-origin="50 50"', 'marker-start="url(#x)"', 'marker-end="url(#x)"'])("refuses unmeasured attribute %s by name", attribute => {
    const input = svg(`<rect x="30" y="30" width="40" height="40" ${attribute}/>`);
    for (const evaluate of [measureMarkGeometry, checkMarkConformance, (value: string) => normalizeMark({ glyphSvg: value, tokens })]) {
      expect(() => evaluate(input)).toThrow(MarkGeometryError);
      expect(() => evaluate(input)).toThrow(attribute.split('=')[0]);
    }
  });
  it.each(['#336699', 'oklch(0.4 0 0)'])("retains a stroke-only knockout and its real judgment with %s", accent => {
    const paletteTokens = { ...tokens, accent };
    const direction = adoptSuppliedMark({ brand: { name: "Example" }, suppliedSvg: MARK_FIXTURES.strokeOnly, tokens: paletteTokens, normalize: true });
    for (const role of ['mono', 'light', 'dark', 'favicon'] as const) {
      const document = new DOMParser().parseFromString(direction.variants[role], 'image/svg+xml');
      const hole = document.querySelector('mask circle');
      expect(hole?.getAttribute('fill')).toBe('none');
      expect(hole?.getAttribute('stroke')).toBe('#000');
      expect(hole?.getAttribute('stroke-width')).toBe('10');
      const layers = document.querySelectorAll('svg > g[mask]');
      expect(layers).toHaveLength(2);
      expect(layers[0]?.getAttribute('mask')).toBe(`url(#${hole?.closest('mask')?.id})`);
      expect(layers[1]?.querySelector('circle')?.getAttribute('fill')).toBe('none');
      expect(layers[1]?.querySelector('circle')?.getAttribute('stroke')).toBe(role === 'dark' ? tokens.onInverse : role === 'light' ? tokens.ink : 'currentColor');
    }
    const checks = judgeIdentityKit(direction, paletteTokens).checks;
    expect(checks['single-colour-legibility'].verdict).toBe('satisfied');
    expect(checks['mark-conformance']?.verdict).toBe('satisfied');
  });
  it("preserves frozen legacy stroke variants and public recolouring bytes", () => {
    const suppliedSvg = MARK_FIXTURES.strokeOnly;
    const input = { brand: { name: "Example" }, suppliedSvg, tokens };
    const legacy = adoptSuppliedMark(input);
    expect(createHash('sha256').update(JSON.stringify(legacy.variants)).digest('hex')).toBe('06d320ef1a5f565125c948ebc8e630b01fa3272a1a70202ae0b23ef8fe541934');
    expect(adoptSuppliedMark({ ...input, normalize: false })).toEqual(legacy);
    expect(createHash('sha256').update(recolorSvg(suppliedSvg, 'currentColor')).digest('hex')).toBe('b4f61ab97d18a8e577e2a1fa7ca1a83de661e1e3afec7dba1e1ef0db051c9a55');
  });
  const lockup = (x = 73, size: number | null = 22) => `<svg viewBox="17 9 120 48" data-clear-space="0.2"><rect x="17" y="9" width="48" height="48" rx="10.5"/><rect x="25.64" y="17.64" width="30.72" height="30.72"/><text x="${x}"${size === null ? '' : ` font-size="${size}"`}>Example</text></svg>`;
  it("accepts the exact lockup frame, gap and wordmark ratios", () => {
    expect(checkMarkConformance(lockup())).toEqual([]);
  });
  it("pins measured and expected lockup values including the viewBox origin", () => {
    expect(checkMarkConformance(lockup(74, 23))).toEqual([
      { rule: 'lockup-gap', measured: 9 / 48, expected: 8 / 48 },
      { rule: 'wordmark-size', measured: 23 / 48, expected: 22 / 48 },
    ]);
  });
  it("reports undeclared clear space and wordmark size rather than passing", () => {
    expect(checkMarkConformance(lockup(73, null).replace(' data-clear-space="0.2"', ''))).toEqual([
      { rule: 'clear-space', measured: null, expected: .2 },
      { rule: 'wordmark-size', measured: null, expected: 22 / 48 },
    ]);
  });
  it("judges a single measured violation as violated", () => {
    const suppliedSvg = lockup().replace('rx="10.5"', 'rx="12"').replace(/<text.*<\/text>/, '');
    const result = judgeIdentityKit(adoptSuppliedMark({ brand: { name: "Example" }, suppliedSvg, tokens }), tokens);
    expect(result.checks['mark-conformance']).toMatchObject({ verdict: 'violated', findings: [{ rule: 'mark-conformance', message: expect.stringContaining('radius: measured 0.25; expected 0.21875') }] });
  });
  it("pins implicit relative lineto after moveto", () => {
    expect(box('<path d="m30 35 40 0 0 30 z"/>')).toEqual({ x: .3, y: .35, width: .4, height: .3 });
  });
  it("pins one-argument translation and rotation about an off-origin centre", () => {
    expect(box('<rect x="10" y="20" width="20" height="10" transform="translate(7)"/>')).toEqual({ x: .17, y: .2, width: .2, height: .1 });
    const rotated = box('<rect x="10" y="20" width="20" height="10" transform="rotate(90 30 40)"/>');
    expect(rotated).toEqual({ x: expect.closeTo(.4, 12), y: expect.closeTo(.2, 12), width: expect.closeTo(.1, 12), height: expect.closeTo(.2, 12) });
  });
  it("pins round caps and the miter-limit bevel boundary", () => {
    expect(box('<path d="M20 30H60" fill="none" stroke="#000" stroke-width="10" stroke-linecap="round"/>')).toEqual({ x: .15, y: .25, width: .5, height: .1 });
    const shape = (limit: number) => box(`<path d="M10 80L50 10L90 80" fill="none" stroke="#000" stroke-width="10" stroke-miterlimit="${limit}"/>`);
    expect(shape(1.1).y).toBeCloseTo((10 - 20 / Math.sqrt(65)) / 100, 10);
    expect(shape(2.1).y).toBeCloseTo((10 - 5 * Math.sqrt(65) / 4) / 100, 10);
  });
  it.each(['depth', 'depth-small', 'winding', 'winding-small', 'generated', 'centroid', 'crescent'] as const)("refuses %s complexity in a bounded real-source child", feature => {
    const directory = mkdtempSync(join(tmpdir(), 'mark-budget-'));
    try {
      const filename = join(directory, 'probe.cjs'), entry = resolve(process.cwd(), 'src/tokens');
      const esbuild = createRequire(resolve(process.cwd(), 'package.json')).resolve('esbuild');
      const source = `export * from ${JSON.stringify(join(entry, 'mark-normalize.ts'))}; export { judgeIdentityKit } from ${JSON.stringify(join(entry, 'identity-checks.ts'))}; export { adoptSuppliedMark } from ${JSON.stringify(join(entry, 'identity-kit.ts'))};`;
      writeFileSync(filename, `
const { buildSync } = require(${JSON.stringify(esbuild)});
const bundle = ${JSON.stringify(join(directory, 'bundle.cjs'))};
const built = buildSync({
  stdin: { contents: ${JSON.stringify(source)}, resolveDir: ${JSON.stringify(entry)} },
  bundle: true, write: false, platform: 'node', format: 'cjs',
});
require('node:fs').writeFileSync(bundle, built.outputFiles[0].text);
const n = require(bundle), tokens = ${JSON.stringify(tokens)};
n.measureMarkGeometry(${JSON.stringify(MARK_FIXTURES.small)});
console.log('ready');
const feature = ${JSON.stringify(feature)};
let body;
if (feature === 'depth' || feature === 'depth-small') {
  const depth = feature === 'depth' ? 20000 : 70;
  body = '<g>'.repeat(depth) + '<rect width="10" height="10"/>' + '</g>'.repeat(depth);
} else if (feature === 'winding' || feature === 'winding-small') {
  const count = feature === 'winding' ? 8000 : 300;
  const points = Array.from({ length: count }, (_, i) => i + ',' + (i % 2 ? 90 : 10));
  body = '<polygon points="' + points.join(' ') + '"/>';
} else if (feature === 'generated') {
  body = '<circle cx="50" cy="50" r="20"/>'.repeat(64);
} else if (feature === 'centroid') {
  body = '<rect width="10" height="10"/>'.repeat(1250);
} else {
  body = '<path d="M60 10 A40 40 0 1 0 60 90 A30 30 0 1 1 60 10 Z"/>';
}
const input = '<svg viewBox="0 0 100 100">' + body + '</svg>';
try {
  if (feature === 'centroid') n.normalizeMark({ glyphSvg: input, tokens, optical: true });
  else n.measureMarkGeometry(input);
  console.log('returned');
} catch (error) {
  if (!(error instanceof n.MarkGeometryError)) throw error;
  console.log(error.feature);
}
if (feature === 'depth' || feature === 'winding') {
  const direction = n.adoptSuppliedMark({ brand: { name: 'Example' }, suppliedSvg: input, tokens });
  console.log(n.judgeIdentityKit(direction, tokens).checks['mark-conformance'].verdict);
}
`);
      const result = spawnSync(process.execPath, ['--max-old-space-size=96', filename], { encoding: 'utf8', timeout: 3_000 });
      expect(result.stdout).toContain('ready\n');
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(feature.startsWith('depth') ? 'nesting depth' : feature === 'generated' ? 'generated geometry complexity' : feature === 'centroid' ? 'centroid complexity' : 'paint work complexity');
      if (feature === 'depth' || feature === 'winding') expect(result.stdout).toContain('indeterminate');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
describe("mark normalization", () => {
  it.each(Object.entries(MARK_FIXTURES))("normalizes %s to measured kit geometry", (_name, glyphSvg) => {
    const result = normalizeMark({ glyphSvg, tokens });
    const geometry = measureMarkGeometry(result);
    expect(geometry.viewBox).toEqual({ x: 0, y: 0, width: 48, height: 48 });
    expect(geometry.plate.present).toBe(true);
    expect(geometry.plate.radiusShare).toBeCloseTo(7 / 32, 7);
    expect(Math.max(geometry.glyphBox.width, geometry.glyphBox.height)).toBeCloseTo(0.64, 5);
    expect(geometry.glyphBox.width).toBeLessThanOrEqual(0.64001);
    expect(geometry.glyphBox.height).toBeLessThanOrEqual(0.64001);
    expect(Math.abs(geometry.centreOffset.x)).toBeLessThan(0.005);
    expect(Math.abs(geometry.centreOffset.y)).toBeLessThan(0.005);
    expect(geometry.declaredClearSpace).toBe(0.2);
    expect(checkMarkConformance(result)).toEqual([]);
  });
  it("preserves aspect and centers the actual glyph rather than its canvas", () => {
    const result = measureMarkGeometry(normalizeMark({ glyphSvg: svg('<rect x="3" y="7" width="40" height="10"/>'), tokens }));
    expect(result.glyphBox.width / result.glyphBox.height).toBeCloseTo(4, 5);
    expect(result.glyphBox).toMatchObject({ x: expect.closeTo(0.18, 5), y: expect.closeTo(0.42, 5) });
  });
  it("measures painted stroke width", () => {
    expect(measureMarkGeometry(MARK_FIXTURES.strokeOnly).glyphBox.width).toBeCloseTo(0.5, 5);
    expect(box('<path d="M20 30 H60" fill="none" stroke="#000" stroke-width="10"/>')).toEqual({ x: 0.2, y: 0.25, width: 0.4, height: 0.1 });
    expect(box('<path d="M20 30 H60" fill="none" stroke="#000" stroke-width="10" stroke-linecap="square"/>').width).toBeCloseTo(0.5, 5);
  });
  it("interprets relative commands from each current point", () => {
    expect(measureMarkGeometry(MARK_FIXTURES.relativePath).glyphBox).toEqual({ x: 0.3, y: 0.35, width: 0.4, height: 0.3 });
  });
  it("applies nested transforms in SVG order", () => {
    expect(box('<g transform="translate(10 20) scale(2 3)"><rect x="5" y="5" width="10" height="10"/></g>')).toEqual({ x: 0.2, y: 0.35, width: 0.2, height: 0.3 });
    expect(box('<g transform="rotate(90 50 50)"><ellipse cx="50" cy="50" rx="30" ry="10"/></g>').width).toBeCloseTo(0.2, 5);
  });
  it.each([
    ['M10 50 C10 10 90 10 90 50', 0.3],
    ['M10 50 Q50 10 90 50', 0.2],
    ['M10 50 C10 10 50 10 50 50 S90 90 90 50', 0.6],
    ['M10 50 Q30 10 50 50 T90 50', 0.4],
    ['M10 50 A40 20 0 0 1 90 50', 0.2],
    ['m10 50 a40 20 0 0 1 80 0', 0.2],
  ])("computes curve extrema for %s", (d, height) => expect(box(`<path d="${d}"/>`).height).toBeCloseTo(height, 4));
  it("resets smooth curve reflection after a line", () => {
    expect(box('<path d="M0 50 Q20 10 40 50 L50 50 T90 50"/>').height).toBeCloseTo(0.2, 4);
  });
  it("uses the area centroid only on request and clamps its shift to 3%", () => {
    const glyphSvg = svg('<polygon points="0,0 100,0 0,100"/>');
    const normal = measureMarkGeometry(normalizeMark({ glyphSvg, tokens }));
    const optical = measureMarkGeometry(normalizeMark({ glyphSvg, tokens, optical: true }));
    expect(normal.centreOffset).toEqual({ x: 0, y: 0 });
    expect(Math.hypot(optical.centreOffset.x, optical.centreOffset.y)).toBeCloseTo(0.03, 5);
    expect(optical.centreOffset.x).toBeCloseTo(0.03 / Math.SQRT2, 5);
    expect(optical.centreOffset.y).toBeCloseTo(0.03 / Math.SQRT2, 5);
  });
  it.each(['text', 'image', 'use', 'foreignObject', 'defs'])("names unsupported element %s", name => {
    expect(() => measureMarkGeometry(svg(`<${name}/>`))).toThrow(MarkGeometryError);
    expect(() => normalizeMark({ glyphSvg: svg(`<${name}/>`), tokens })).toThrow(name);
  });
  it.each(['skewX(20)', 'matrix(1 0 0 1 0 0)'])("names unsupported transform %s", transform => {
    expect(() => box(`<g transform="${transform}"><rect width="10" height="10"/></g>`)).toThrow(MarkGeometryError);
    expect(() => box(`<g transform="${transform}"><rect width="10" height="10"/></g>`)).toThrow(transform.split('(')[0]);
  });
  it("rejects malformed geometry rather than guessing", () => {
    for (const body of ['<path d="M0 0 L"/>', '<path d="M0 0 R2 3"/>', '<rect width="10%" height="20"/>']) {
      expect(() => box(body)).toThrow(MarkGeometryError);
    }
  });
  it("preserves all default adoption bytes", () => {
    const suppliedSvg = MARK_FIXTURES.small;
    const legacy = adoptSuppliedMark({ brand: { name: "Example" }, suppliedSvg, tokens });
    expect(legacy.variants.primary).toBe(suppliedSvg);
    expect(legacy.variants.mark).toBe(suppliedSvg);
    expect(adoptSuppliedMark({ brand: { name: "Example" }, suppliedSvg, tokens, normalize: false })).toEqual(legacy);
    const normalized = adoptSuppliedMark({ brand: { name: "Example" }, suppliedSvg, tokens, normalize: true });
    expect(normalized.variants.primary).not.toBe(suppliedSvg);
    expect(checkMarkConformance(normalized.variants.mark)).toEqual([]);
  });
});
describe("round-two alpha and arc refusals", () => {
  it.each([
    '#0000', '#1230', '#abcdef00', '#00000000',
    'rgba(0, 0, 0, 0)', 'rgb(0, 0, 0, 0)', 'RGBA(0 0 0 / 0%)',
    'rgb(0 0 0 / .0)', 'hsla(120, 100%, 50%, 0)', 'hsl(120 100% 50% / +0%)',
    'oklch(0.5 0 0 / -0)', 'color(srgb 0 0 0 / 0e0)', 'rgba(0, 0, 0, -1)',
  ])("excludes invisible %s paint from measured and normalized bounds", paint => {
    const visible = '<rect x="30" y="30" width="40" height="40"/>';
    for (const invisible of [
      `<rect x="-500" width="100" height="100" fill="${paint}"/>`,
      `<g style="fill: ${paint}"><rect x="-500" width="100" height="100"/></g>`,
      `<rect x="-500" width="100" height="100" fill="none" stroke="${paint}" stroke-width="10"/>`,
    ]) {
      const input = svg(invisible + visible);
      expect(measureMarkGeometry(input).glyphBox).toEqual({ x: .3, y: .3, width: .4, height: .4 });
      const normalized = normalizeMark({ glyphSvg: input, tokens });
      expect(measureMarkGeometry(normalized).glyphBox.width).toBeCloseTo(.64, 5);
      expect(checkMarkConformance(normalized)).toEqual([]);
    }
    expect(() => box(`<rect width="40" height="40" fill="${paint}"/>`)).toThrow(MarkGeometryError);
  });
  it.each(['#000f', '#00000001', 'rgb(0 0 0)', 'rgba(0, 0, 0, .5)', 'oklch(0.5 0 0)', 'color(srgb 0 0 0)'])("retains visible %s paint", paint => {
    expect(box(`<rect x="30" y="30" width="40" height="40" fill="${paint}"/>`)).toEqual({ x: .3, y: .3, width: .4, height: .4 });
  });
  it.each(['transparent', '#0000', 'rgba(0, 0, 0, 0)'])("resolves invisible currentColor from %s without changing visible bounds", color => {
    const visible = '<rect x="30" y="30" width="40" height="40" fill="#000"/>';
    for (const input of [
      svg(`<rect x="-500" width="100" height="100" fill="currentColor" color="${color}"/>${visible}`),
      svg(`<g style="color: ${color}; fill: currentColor"><g color="currentColor"><rect x="-500" width="100" height="100"/></g></g>${visible}`),
      `<svg viewBox="0 0 100 100" color="${color}"><rect x="-500" width="100" height="100" fill="none" stroke="currentColor" stroke-width="10"/>${visible}</svg>`,
    ]) {
      expect(measureMarkGeometry(input).glyphBox).toEqual({ x: .3, y: .3, width: .4, height: .4 });
      const normalized = normalizeMark({ glyphSvg: input, tokens });
      expect(measureMarkGeometry(normalized).glyphBox.width).toBeCloseTo(.64, 5);
      expect(checkMarkConformance(normalized)).toEqual([]);
    }
    expect(measureMarkGeometry(svg(`<rect width="100" height="100" fill="currentColor" color="${color}"/>${visible}`)).plate.present).toBe(false);
    expect(() => box(`<rect width="40" height="40" fill="currentColor" color="${color}"/>`)).toThrow(MarkGeometryError);
  });
  it.each(['#000', 'rgb(0 0 0)'])("retains opaque inherited currentColor from %s", color => {
    expect(box(`<g color="${color}" fill="currentColor"><g color="currentColor"><rect x="30" y="30" width="40" height="40"/></g></g>`)).toEqual({ x: .3, y: .3, width: .4, height: .4 });
  });
  it("retains actual normalized adoption with opaque functional token colors", () => {
    const functionalTokens = { ...tokens, accent: 'oklch(0.3 0 0)', onAccent: 'rgb(255 255 255)' };
    const adopted = adoptSuppliedMark({ brand: { name: "Example" }, suppliedSvg: MARK_FIXTURES.small, tokens: functionalTokens, normalize: true });
    expect(checkMarkConformance(adopted.variants.mark)).toEqual([]);
  });
  it.each(['rgb(from transparent r g b)', 'color(from transparent srgb r g b)'])("refuses unmeasurable relative alpha in %s", paint => {
    expect(() => box(`<rect width="40" height="40" fill="${paint}"/>`)).toThrow(MarkGeometryError);
  });
  it("refuses nonfinite arc intermediates instead of silently omitting an arc", () => {
    const input = svg('<path d="M0 0H10V10 A1e200 1e200 0 0 1 20 20 Z"/>');
    for (const evaluate of [() => measureMarkGeometry(input), () => normalizeMark({ glyphSvg: input, tokens }), () => checkMarkConformance(input)]) {
      expect(evaluate).toThrow(MarkGeometryError);
    }
  });
});
// The geometry subset refuses CSS-wide paint keywords; it does not implement the CSS cascade.
describe("CSS-wide paint boundary after inline precedence", () => {
  const keywords = ['inherit', 'unset', 'initial', 'revert', 'revert-layer'];
  const supported = { fill: '#000', stroke: 'none', color: '#000' };
  const cases = (Object.keys(supported) as (keyof typeof supported)[]).flatMap(property => keywords.flatMap(keyword =>
    ['attribute', 'style'].map(mode => [property, keyword, mode] as const)));
  const visible = '<rect x="30" y="30" width="40" height="40" fill="#000"/>';
  for (const [name, evaluate] of Object.entries({ measure: measureMarkGeometry, normalize: (input: string) => normalizeMark({ glyphSvg: input, tokens }), conformance: checkMarkConformance })) {
    it.each(['\u00a0', '\u000b'])(`${name} refuses non-CSS whitespace in paint channels, values and style keys`, whitespace => {
      for (const attribute of [`fill="rgb(0${whitespace}0${whitespace}0)"`, `fill="${whitespace}#000${whitespace}"`, `style="fill:rgb(0${whitespace}0${whitespace}0)"`, `style="${whitespace}fill${whitespace}:#000"`])
        expect(() => evaluate(svg(`<rect x="18" y="18" width="64" height="64" ${attribute}/>${visible}`))).toThrow(MarkGeometryError);
    });
    it.each(['hsl(0 0% 0%)', 'hwb(0 0% 0% / .5)', 'lab(50% 0 0)', 'lch(50% 0 0)', 'oklab(0.5 0 0)'])(`${name} retains the documented concrete %s syntax`, paint => {
      const input = svg(`<rect x="30" y="30" width="40" height="40" fill="${paint}"/>`);
      expect(() => evaluate(input)).not.toThrow();
      expect(measureMarkGeometry(input).glyphBox).toEqual({ x: .3, y: .3, width: .4, height: .4 });
    });
    it.each(cases)(`${name} refuses %s=%s in %s form`, (property, keyword, mode) => {
      const current = property === 'fill' ? '' : 'fill="currentColor"';
      const paint = mode === 'attribute' ? `${property}=" ${keyword.toUpperCase()} "` : `${property}="${supported[property]}" style="${property}: ${keyword.toUpperCase()} "`;
      const input = svg(`<g fill="none" color="transparent"><g><rect x="18" y="18" width="64" height="64" ${current} ${paint}/></g></g>${visible}`);
      expect(() => evaluate(input)).toThrow(MarkGeometryError);
      expect(() => evaluate(input)).toThrow('CSS-wide paint keyword');
    });
    it.each(Object.keys(supported) as (keyof typeof supported)[])(`${name} accepts a supported inline %s overriding the keyword attribute`, property => {
      for (const keyword of keywords) {
        const input = svg(`<g ${property}="${keyword}" style="${property}: ${supported[property]}">${visible}</g>`);
        expect(() => evaluate(input)).not.toThrow();
        expect(measureMarkGeometry(input).glyphBox).toEqual({ x: .3, y: .3, width: .4, height: .4 });
      }
    });
    it(`${name} refuses the inherited 64-square reviewer sample`, () => {
      const input = svg(`<g fill="none"><rect x="18" y="18" width="64" height="64" fill="inherit"/></g>${visible}`);
      expect(() => evaluate(input)).toThrow(MarkGeometryError);
      expect(() => evaluate(input)).toThrow('CSS-wide paint keyword');
    });
    it(`${name} retains transparent parent color with currentColor when the keyword is omitted`, () => {
      const input = svg(`<g color="transparent" fill="currentColor"><rect x="18" y="18" width="64" height="64"/></g>${visible}`);
      expect(() => evaluate(input)).not.toThrow();
      expect(measureMarkGeometry(input).glyphBox).toEqual({ x: .3, y: .3, width: .4, height: .4 });
    });
  }
});
describe("closed computed paint shared by geometry and output", () => {
  const visible = '<rect x="30" y="30" width="40" height="40" fill="#000"/>';
  const invalid = ['currentColor', 'context-fill', 'context-stroke', 'notacolor', '#00', '#12345', '#1234567', 'rgb()', 'rgb(0 0)', 'rgb(0,0,0 / .5)', 'rgba(0 0 0 .5)', 'transparent !important', '/*comment*/none'];
  const effects = ['clip-path', 'mask', 'filter', 'vector-effect', 'stroke-dasharray', 'stroke-dashoffset', 'display', 'visibility', 'opacity', 'fill-opacity', 'stroke-opacity'];
  const atEveryLevel = (attribute: string) => [
    `<svg viewBox="0 0 100 100" ${attribute}>${visible}</svg>`,
    svg(`<g ${attribute}><rect x="18" y="18" width="64" height="64"/></g>${visible}`),
    svg(`<rect x="18" y="18" width="64" height="64" ${attribute}/>${visible}`),
    svg(`<rect width="100" height="100" rx="21.875" ${attribute}/>${visible}`),
  ];
  for (const [name, evaluate] of Object.entries({ measure: measureMarkGeometry, normalize: (input: string) => normalizeMark({ glyphSvg: input, tokens }), conformance: checkMarkConformance })) {
    it.each(['rgb(0. 0 0)', 'rgb(0 0 0 / 0.)', 'rgba(0.,0,0,1)', 'hsl(0. 0% 0%)', 'hwb(0 0.% 0%)', 'lab(0. 0 0)', 'oklch(0 0 0.)', 'color(srgb 0 0 0 / 0.)'])(`${name} refuses trailing decimal paint numbers in channels and alpha`, paint => {
      for (const attribute of [`fill="${paint}"`, `style="fill:${paint}"`]) {
        expect(() => evaluate(svg(`<rect x="18" y="18" width="64" height="64" ${attribute}/>${visible}`))).toThrow(MarkGeometryError);
        expect(() => evaluate(svg(`<rect x="18" y="18" width="64" height="64" ${attribute}/>${visible}`))).toThrow('paint arity');
      }
    });
    it.each(['rgb(0 0 0)', 'rgb(0.0 0 0 / 1.0)', 'hsl(0.0 0.0% 0%)', 'color(srgb 0.0 0 0 / 1)'])(`${name} retains valid integer and decimal paint numbers in %s`, paint => {
      expect(() => evaluate(svg(`<rect x="30" y="30" width="40" height="40" fill="${paint}"/>`))).not.toThrow();
    });
    it.each(invalid)(`${name} refuses unsupported paint %s in attributes and styles`, paint => {
      for (const property of ['fill', 'stroke', 'color']) for (const style of [false, true]) {
        const fill = property === 'fill' ? '' : property === 'stroke' ? 'fill="none"' : 'fill="currentColor"';
        const attribute = style ? `style="${property}: ${paint}"` : `${property}="${paint}"`;
        expect(() => evaluate(svg(`<rect x="18" y="18" width="64" height="64" ${fill} ${attribute}/>${visible}`))).toThrow(MarkGeometryError);
      }
    });
    it(`${name} refuses none as color and priority declarations before a later override`, () => {
      for (const attribute of ['color="none" fill="currentColor"', 'style="fill:transparent !important;fill:#000"'])
        expect(() => evaluate(svg(`<rect x="18" y="18" width="64" height="64" ${attribute}/>${visible}`))).toThrow(MarkGeometryError);
    });
    it.each(effects)(`${name} refuses effect %s at every level including the plate`, property => {
      const value = property === 'display' ? 'none' : property === 'visibility' ? 'hidden' : '0';
      for (const attribute of [`${property}="${value}"`, `style="${property}:${value}"`])
        for (const input of atEveryLevel(attribute)) expect(() => evaluate(input)).toThrow(MarkGeometryError);
    });
    it(`${name} refuses paint URLs on roots, groups, leaves and plates`, () => {
      for (const property of ['fill', 'stroke']) for (const input of atEveryLevel(`${property}="url(#paint) #000"`)) {
        expect(() => evaluate(input)).toThrow(MarkGeometryError);
        expect(() => evaluate(input)).toThrow('paint reference');
      }
    });
    it(`${name} keeps inherited currentColor symbolic until an opaque child overrides a transparent parent`, () => {
      const input = svg('<g color="#ff0000" fill="currentColor"><rect x="18" y="18" width="64" height="64" color="transparent"/><g color="currentColor"><rect x="30" y="30" width="40" height="40" color="#123456"/></g></g>');
      expect(() => evaluate(input)).not.toThrow();
      expect(measureMarkGeometry(input).glyphBox).toEqual({ x: .3, y: .3, width: .4, height: .4 });
      const output = normalizeMark({ glyphSvg: input, tokens });
      const document = new DOMParser().parseFromString(output, 'image/svg+xml');
      expect([...document.querySelectorAll('g rect')].map(node => node.getAttribute('fill'))).toEqual(['transparent', '#123456']);
      expect(output).not.toMatch(/(?:fill|stroke)="currentColor"/i);
    });
  }
  it.each([['accent', 'transparent'], ['onAccent', 'transparent'], ['accent', 'currentColor'], ['onAccent', 'currentColor'], ['accent', '#1234567'], ['onAccent', 'rgb()']] as const)("refuses actually-used generated %s paint %s", (field, paint) => {
    const input = field === 'accent' ? svg(visible) : svg('<rect x="30" y="30" width="40" height="40"/>');
    expect(() => normalizeMark({ glyphSvg: input, tokens: { ...tokens, [field]: paint } })).toThrow(MarkGeometryError);
  });
  it.each(['transparent', 'currentColor'])("allows unused generated paint %s", paint => {
    expect(() => normalizeMark({ glyphSvg: svg(visible), tokens: { ...tokens, accent: paint }, plate: false })).not.toThrow();
    const output = normalizeMark({ glyphSvg: svg(visible), tokens: { ...tokens, onAccent: paint } });
    expect(new DOMParser().parseFromString(output, 'image/svg+xml').querySelector('g rect')?.getAttribute('fill')).toBe('#000');
    expect(checkMarkConformance(output)).toEqual([]);
  });
  it("refuses an invisible required generated glyph even beside an explicit visible glyph", () => {
    expect(() => normalizeMark({ glyphSvg: svg(`<rect x="18" y="18" width="64" height="64"/>${visible}`), tokens: { ...tokens, onAccent: 'transparent' } })).toThrow('generated glyph paint');
  });
  it.each(['currentColor', 'rgb()'])("does not consume unused generated fill %s on a stroke-only path", paint => {
    expect(() => normalizeMark({ glyphSvg: svg('<path d="M30 50H70" stroke="#000" stroke-width="4"/>'), tokens: { ...tokens, onAccent: paint } })).not.toThrow();
    const output = normalizeMark({ glyphSvg: svg('<path d="M30 50H70" stroke="#000" stroke-width="4"/>'), tokens: { ...tokens, onAccent: paint } });
    const path = new DOMParser().parseFromString(output, 'image/svg+xml').querySelector('path');
    expect(path?.getAttribute('fill')).toBe('none');
    expect(path?.getAttribute('stroke')).toBe('#000');
    expect(checkMarkConformance(output)).toEqual([]);
  });
});
describe("mark conformance", () => {
  it.each(['small', 'oversized', 'offCentre', 'wrongRadius'] as const)("flags off-kit %s with measured and expected values", name => {
    const findings = checkMarkConformance(MARK_FIXTURES[name]);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding).toHaveProperty('measured');
      expect(finding).toHaveProperty('expected');
    }
  });
  it("reports radius, inset, centre, clear space, gap and wordmark in order", () => {
    const input = '<svg viewBox="0 0 200 100" data-clear-space="0.1"><rect width="100" height="100" rx="24"/><rect x="1" y="2" width="40" height="40"/><text x="140" font-size="10">Example</text></svg>';
    expect(checkMarkConformance(input).map(f => f.rule)).toEqual(['radius', 'inset', 'centre', 'clear-space', 'lockup-gap', 'wordmark-size']);
  });
});
describe("geometry edge cases", () => {
  it("scans comments and long whitespace without ambiguous tag matching", () => {
    expect(() => measureMarkGeometry('<!--'.repeat(10000))).toThrow(MarkGeometryError);
    expect(box(`<!--${'<!--'.repeat(10000)}--><rect width="10" height="20"${' '.repeat(40000)}/>`).width).toBe(0.1);
    expect(() => box('<rect width="10" height="20"></rect extra>')).toThrow(MarkGeometryError);
  });
  it("keeps quoted tag delimiters intact when measuring and normalizing", () => {
    const glyphSvg = '<svg viewBox="0 0 100 100" data-label="a > b"><rect width="10" height="20" data-label="x > y"/></svg>';
    expect(measureMarkGeometry(glyphSvg).glyphBox).toEqual({ x: 0, y: 0, width: 0.1, height: 0.2 });
    expect(checkMarkConformance(normalizeMark({ glyphSvg, tokens }))).toEqual([]);
  });
  it("measures overlapping painted area once for optical centring", () => {
    const glyphSvg = svg('<g><rect x="0" y="0" width="100" height="100"/><rect x="0" y="0" width="50" height="100"/></g>');
    const result = measureMarkGeometry(normalizeMark({ glyphSvg, tokens, optical: true }));
    expect(result.centreOffset.x).toBeCloseTo(0, 4);
  });
  it("does not cancel separately painted shapes with opposite windings", () => {
    const glyphSvg = svg('<polygon points="0,0 20,0 20,100 0,100"/><polygon points="80,0 80,100 100,100 100,0"/>');
    expect(measureMarkGeometry(normalizeMark({ glyphSvg, tokens, optical: true })).centreOffset.x).toBeCloseTo(0, 4);
  });
  it("finds the area centroid of asymmetric stroke-only geometry", () => {
    const glyphSvg = svg('<path d="M0 0 H100 V20" fill="none" stroke="#000" stroke-width="10"/>');
    const geometry = measureMarkGeometry(normalizeMark({ glyphSvg, tokens, optical: true }));
    expect(geometry.centreOffset.x).toBeLessThan(-0.01);
    expect(geometry.centreOffset.y).toBeGreaterThan(0.01);
  });
  it("accepts the measured optical correction while rejecting a forged declaration", () => {
    const normalized = normalizeMark({ glyphSvg: svg('<polygon points="0,0 100,0 0,100"/>'), tokens, optical: true });
    expect(checkMarkConformance(normalized)).toEqual([]);
    expect(checkMarkConformance(MARK_FIXTURES.offCentre.replace('<svg ', '<svg data-optical-centering="true" ')).some(f => f.rule === 'centre')).toBe(true);
  });
  it("accepts packed arc flags and coordinates", () => {
    expect(box('<path d="M10 50 A40 20 0 0190 50"/>').height).toBeCloseTo(0.2, 4);
  });
  it("starts a new contour after closepath before subsequent drawing", () => {
    expect(box('<path d="M10 10 H30 V30 Z l50 0" fill="none" stroke="#000" stroke-width="2"/>').width).toBeCloseTo(0.524142, 4);
  });
  it("names unsupported live text with content", () => {
    expect(() => measureMarkGeometry(svg('<text>Example</text>'))).toThrow('text');
  });
  it("refuses transformed or nested live lockup text instead of ignoring its placement", () => {
    const mark = MARK_FIXTURES.small.replace('</svg>', '<g transform="translate(20)"><text x="100" font-size="22">Example</text></g></svg>');
    expect(() => checkMarkConformance(mark)).toThrow(MarkGeometryError);
  });
});
describe("paint geometry regressions", () => {
  it.each(['fill="none"', 'style="fill: none"'])("keeps a border with inherited %s in the glyph", fill => {
    const input = `<svg viewBox="0 0 100 100" ${fill} stroke="#000" stroke-width="2"><rect width="100" height="100"/><path d="M40 40 H60 V60 H40 Z"/></svg>`;
    const measured = measureMarkGeometry(input);
    expect(measured.plate.present).toBe(false);
    expect(measured.glyphBox).toEqual({ x: -0.01, y: -0.01, width: 1.02, height: 1.02 });
    expect(checkMarkConformance(normalizeMark({ glyphSvg: input, tokens }))).toEqual([]);
  });
  it.each(['M0 0', 'M0 0 L10 0', 'M0 0 L5 0 L10 0'])("excludes unpainted contour %s from fill bounds", prefix => {
    const input = svg(`<path d="${prefix} M20 20 H40 V40 H20 Z"/>`);
    expect(measureMarkGeometry(input).glyphBox).toEqual({ x: 0.2, y: 0.2, width: 0.2, height: 0.2 });
    const normalized = normalizeMark({ glyphSvg: input, tokens }).replace(prefix + ' ', '');
    expect(measureMarkGeometry(normalized).glyphBox).toEqual({ x: expect.closeTo(0.18, 12), y: expect.closeTo(0.18, 12), width: 0.64, height: 0.64 });
    expect(checkMarkConformance(normalized)).toEqual([]);
  });
  it("refuses numerical overflow rather than returning nonfinite geometry or SVG", () => {
    const input = svg('<g transform="scale(1e308)"><rect width="10" height="10"/></g>');
    expect(() => measureMarkGeometry(input)).toThrow(MarkGeometryError);
    expect(() => normalizeMark({ glyphSvg: input, tokens })).toThrow('numeric overflow');
    expect(() => measureMarkGeometry('<svg viewBox="0 0 1e-308 1e-308"><rect width="10" height="10"/></svg>')).toThrow('numeric overflow');
  });
  it("preserves a finite small fitting scale instead of rounding it to zero", () => {
    const normalized = normalizeMark({ glyphSvg: svg('<rect width="1e20" height="1e20"/>'), tokens });
    expect(measureMarkGeometry(normalized).glyphBox.width).toBeCloseTo(0.64, 10);
    expect(checkMarkConformance(normalized)).toEqual([]);
  });
  it("checks both plate radii and measures SVG radius clamping", () => {
    const anisotropic = MARK_FIXTURES.small.replace('rx="21.875"', 'rx="21.875" ry="40"');
    expect(checkMarkConformance(anisotropic).some(f => f.rule === 'radius')).toBe(true);
    expect(measureMarkGeometry(MARK_FIXTURES.small.replace('rx="21.875"', 'rx="80"')).plate.radiusShare).toBe(0.5);
  });
  it("measures ordinary round-joined circle strokes without an array spread overflow", () => {
    const geometry = box('<circle cx="50" cy="50" r="30" fill="none" stroke="#000" stroke-width="4" stroke-linejoin="round"/>');
    expect(geometry.width).toBeCloseTo(0.64, 4);
    expect(geometry.height).toBeCloseTo(0.64, 4);
  });
  it.each(['opacity', 'fill-opacity', 'stroke-opacity'])("refuses unmeasured %s rendering", attr => {
    expect(() => box(`<g ${attr}="0"><rect width="40" height="40"/></g>`)).toThrow(attr);
    expect(() => box(`<g ${attr}="0"><rect width="40" height="40"/></g>`)).toThrow(MarkGeometryError);
  });
});
it.each([
  ['M10 50 C10 10 50 10 50 50 S90 90 90 50', 'm10 50 c0 -40 40 -40 40 0 s40 40 40 0'],
  ['M10 50 Q30 10 50 50 T90 50', 'm10 50 q20 -40 40 0 t40 0'],
])("matches relative and absolute curve bounds", (absolute, relative) => {
  expect(box(`<path d="${relative}"/>`)).toEqual(box(`<path d="${absolute}"/>`));
});
it("measures large arc extrema", () => {
  const geometry = box('<path d="M20 50 A30 10 0 1 0 50 60"/>');
  expect(geometry.width).toBeCloseTo(0.6, 4);
  expect(geometry.height).toBeCloseTo(0.2, 4);
});
it("accounts for nonuniform transforms on stroke caps", () => {
  const geometry = box('<g transform="translate(10 20) rotate(90) scale(2 3)"><path d="M10 10 H30" fill="none" stroke="#000" stroke-width="4" stroke-linecap="square"/></g>');
  expect(geometry.width).toBeCloseTo(0.12, 5);
  expect(geometry.height).toBeCloseTo(0.48, 5);
});
it("refuses a lockup text offset it cannot evaluate", () => {
  const mark = MARK_FIXTURES.small.replace('</svg>', '<text x="116.6667" dx="40" font-size="45.8333">Example</text></svg>');
  expect(() => checkMarkConformance(mark)).toThrow('lockup text positioning');
});

it("keeps the normalized app icon at kit geometry without nesting another badge", () => {
  const direction = adoptSuppliedMark({ brand: { name: "Example" }, suppliedSvg: MARK_FIXTURES.small, tokens, normalize: true });
  expect(checkMarkConformance(direction.variants.appIcon)).toEqual([]);
  expect(direction.variants.appIcon).toBe(direction.variants.mark);
});

describe("reviewed paint and document boundaries", () => {
  it("refuses an unbounded round join in a bounded child using the current source", () => {
    const directory = mkdtempSync(join(tmpdir(), "mark-round-join-"));
    try {
      const input = svg('<path d="M0 0H10V10" fill="none" stroke="#000" stroke-width="1e20" stroke-linejoin="round"/>');
      const control = svg('<path d="M0 0H10V10" fill="none" stroke="#000" stroke-width="2" stroke-linejoin="round"/>');
      const filename = join(directory, "normalizer.cjs");
      const entry = resolve(process.cwd(), "src/tokens/mark-normalize.ts");
      const esbuild = createRequire(resolve(process.cwd(), "package.json")).resolve("esbuild");
      writeFileSync(filename, `const { buildSync } = require(${JSON.stringify(esbuild)}); const bundle = ${JSON.stringify(join(directory, "bundle.cjs"))};\nrequire("node:fs").writeFileSync(bundle, buildSync({ entryPoints: [${JSON.stringify(entry)}], bundle: true, write: false, platform: "node", format: "cjs" }).outputFiles[0].text);\nconst normalizer = require(bundle); normalizer.measureMarkGeometry(${JSON.stringify(control)}); process.stdout.write("ready\\n");\ntry { normalizer.measureMarkGeometry(${JSON.stringify(input)}); process.stdout.write("returned"); } catch (error) { if (!(error instanceof normalizer.MarkGeometryError)) throw error; process.stdout.write(error.name + ":" + error.feature); }`);
      const result = spawnSync(process.execPath, [filename], { encoding: "utf8", timeout: 2_000 });
      expect(result.stdout).toContain("ready\n");
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("MarkGeometryError:round join complexity");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it.each([
    'fill="url(https://example.invalid/paint.svg#x)"',
    'fill="&#x75;rl(https://example.invalid/paint.svg#x)"',
    String.raw`fill="u\72l(https://example.invalid/paint.svg#x)"`,
    'style="fill: url(https://example.invalid/paint.svg#x)"',
    'fill="none" stroke="url(https://example.invalid/paint.svg#x)"',
  ])("refuses unresolved paint references in %s", paint => {
    const input = svg(`<rect width="40" height="40" ${paint}/>`);
    expect(() => measureMarkGeometry(input)).toThrow(/paint reference/);
    expect(() => normalizeMark({ glyphSvg: input, tokens })).toThrow(MarkGeometryError);
    expect(() => checkMarkConformance(input)).toThrow(MarkGeometryError);
  });
  it.each([
    '<svg viewBox="0 0 100 100" onload="handleEvent()"><rect width="40" height="40"/></svg>',
    svg('<g onclick="handleEvent()"><rect width="40" height="40"/></g>'),
    svg('<rect width="40" height="40" onfocus="handleEvent()"/>'),
  ])("refuses event attributes before retaining any supplied markup", input => {
    expect(() => measureMarkGeometry(input)).toThrow(/event attribute/);
    expect(() => normalizeMark({ glyphSvg: input, tokens })).toThrow(MarkGeometryError);
    expect(() => checkMarkConformance(input)).toThrow(MarkGeometryError);
  });
  it("retains two-tone knockout recolouring after actual normalized adoption", () => {
    const input = svg('<rect width="100" height="100" rx="21.875" fill="#000"/><rect x="30" y="30" width="40" height="40" fill="#fff"/>');
    const adopted = adoptSuppliedMark({ brand: { name: "Example" }, suppliedSvg: input, tokens, normalize: true });
    for (const role of ["mono", "favicon", "light", "dark"] as const) {
      expect(adopted.variants[role]).toContain("<mask ");
      expect(adopted.variants[role].match(/ mask="url\(#recolor-/g)).toHaveLength(2);
    }
    expect(checkMarkConformance(adopted.variants.mark)).toEqual([]);
  });
  it("preserves root accessibility metadata without defeating normalized two-tone adoption", () => {
    const input = '<svg viewBox="0 0 100 100" role="img" aria-label="Example mark"><rect width="100" height="100" rx="21.875" fill="#000"/><rect x="30" y="30" width="40" height="40" fill="#fff"/></svg>';
    const adopted = adoptSuppliedMark({ brand: { name: "Example" }, suppliedSvg: input, tokens, normalize: true });
    expect(adopted.variants.mark).toMatch(/^<svg\b[^>]* role="img" aria-label="Example mark"/);
    for (const role of ["mono", "favicon", "light", "dark"] as const) {
      expect(adopted.variants[role].match(/ mask="url\(#recolor-/g)).toHaveLength(2);
    }
    expect(checkMarkConformance(adopted.variants.mark)).toEqual([]);
  });
  it.each([50, 70])("bounds only nonzero-winding paint with an inner square ending at %s", end => {
    const input = svg(`<path d="M0 0H100V100H0Z M0 0V100H100V0Z M30 30H${end}V${end}H30Z"/>`);
    expect(measureMarkGeometry(input).glyphBox).toEqual({ x: .3, y: .3, width: (end - 30) / 100, height: (end - 30) / 100 });
    const normalized = normalizeMark({ glyphSvg: input, tokens, optical: true });
    expect(measureMarkGeometry(normalized).glyphBox.width).toBeCloseTo(.64, 5);
    expect(checkMarkConformance(normalized)).toEqual([]);
  });
  it("excludes evenodd-cancelled contours without cancelling separately painted shapes", () => {
    expect(box('<path fill-rule="evenodd" d="M0 0H100V100H0Z M0 0H100V100H0Z M30 30H70V70H30Z"/>')).toEqual({ x: .3, y: .3, width: .4, height: .4 });
  });
  it.each([
    '<rect x="-500" width="100" height="100" fill="transparent"/>',
    '<g style="fill: transparent"><rect x="-500" width="100" height="100"/></g>',
    '<rect x="-500" width="100" height="100" fill="none" stroke="transparent" stroke-width="10"/>',
  ])("excludes transparent paint from fitting bounds", transparent => {
    expect(box(transparent + '<rect x="30" y="30" width="40" height="40"/>')).toEqual({ x: .3, y: .3, width: .4, height: .4 });
  });
  it("refuses an entirely transparent glyph", () => {
    expect(() => box('<rect width="40" height="40" fill="transparent"/>')).toThrow(MarkGeometryError);
  });
  it("uses the parsed root boundary before a valid trailing closing-tag comment", () => {
    const input = MARK_FIXTURES.small + '<!-- </svg -->';
    const normalized = normalizeMark({ glyphSvg: input, tokens });
    expect(() => measureMarkGeometry(normalized)).not.toThrow();
    expect(checkMarkConformance(normalized)).toEqual([]);
  });
});
describe("zero-length drawn stroke caps", () => {
  const visible = '<rect x="30" y="30" width="40" height="40"/>';
  const capPath = (d: string, cap: string) => `<path d="${d}" fill="none" stroke="#000" stroke-width="20" stroke-linecap="${cap}"/>`;
  it("fits the reviewer square-cap point together with the visible glyph", () => {
    const input = svg(capPath('M10 10h0', 'square') + visible);
    expect(measureMarkGeometry(input).glyphBox).toEqual({ x: 0, y: 0, width: .7, height: .7 });
    expect(checkMarkConformance(input).find(finding => finding.rule === 'inset')?.measured).toBe(.7);
    const normalized = normalizeMark({ glyphSvg: input, tokens });
    const document = new DOMParser().parseFromString(normalized, 'image/svg+xml');
    expect(document.querySelector('svg > g')?.getAttribute('transform')).toBe('translate(8.64 8.64) scale(0.438857142857)');
    expect(document.querySelector('path')?.getAttribute('d')).toBe('M10 10h0');
    expect(measureMarkGeometry(normalized).glyphBox).toMatchObject({ x: expect.closeTo(.18, 5), y: expect.closeTo(.18, 5), width: expect.closeTo(.64, 5), height: expect.closeTo(.64, 5) });
    expect(checkMarkConformance(normalized)).toEqual([]);
  });
  it.each(['M10 10h0', 'M10 10h0Z'])("paints a square at the drawn zero-length subpath %s", d => {
    expect(() => box(capPath(d, 'square'))).not.toThrow();
    expect(box(capPath(d, 'square'))).toEqual({ x: 0, y: 0, width: .2, height: .2 });
  });
  it.each(['M10 10h0', 'M10 10h0Z'])("retains round and butt behavior at %s", d => {
    expect(() => box(capPath(d, 'round') + visible)).not.toThrow();
    expect(box(capPath(d, 'round') + visible)).toEqual({ x: 0, y: 0, width: .7, height: .7 });
    expect(box(capPath(d, 'butt') + visible)).toEqual({ x: .3, y: .3, width: .4, height: .4 });
  });
  it("measures every zero-length subpath without joining separate points", () => {
    expect(() => box(capPath('M10 10h0 M90 90h0', 'square'))).not.toThrow();
    expect(box(capPath('M10 10h0 M90 90h0', 'square'))).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });
  it("constructs the square before nonuniform scale and rotation", () => {
    const input = `<g transform="translate(10 20) rotate(90) scale(2 3)">${capPath('M10 10h0', 'square')}</g>`;
    expect(() => box(input)).not.toThrow();
    expect(box(input)).toMatchObject({ x: expect.closeTo(-.5, 5), y: expect.closeTo(.2, 5), width: expect.closeTo(.6, 5), height: expect.closeTo(.4, 5) });
  });
  it.each(['M10 10', 'M10 10A5 5 0 0 0 10 10'])("does not add a square to an undrawn subpath %s", d => {
    expect(box(capPath(d, 'square') + visible)).toEqual({ x: .3, y: .3, width: .4, height: .4 });
  });
  it.each(['square', 'round', 'butt'])("retains nonzero closed backtracking with %s caps", cap => {
    expect(box(capPath('M10 10H40H10Z', cap))).toEqual({ x: .1, y: 0, width: .3, height: .2 });
  });
});
