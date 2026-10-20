import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { measureMarkGeometry, normalizeMark, checkMarkConformance, MarkGeometryError } from "./mark-normalize.js";
import { MARK_FIXTURES } from "./mark-fixtures.js";
import { adoptSuppliedMark } from "./identity-kit.js";
const tokens = { ink: "#000000", onInverse: "#ffffff", surfaceBase: "#ffffff", surfaceInverse: "#000000", accent: "#000000", onAccent: "#ffffff", fontFamily: "sans-serif" };
const svg = (body: string) => `<svg viewBox="0 0 100 100">${body}</svg>`;
const box = (body: string) => measureMarkGeometry(svg(body)).glyphBox;
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
