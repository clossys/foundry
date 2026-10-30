import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import {
  checkMarkConformance,
  MarkGeometryError,
  measureMarkGeometry,
  normalizeMark,
} from "./mark-normalize.js";
import { adoptSuppliedMark } from "./identity-kit.js";

const tokens = {
  ink: "#000000", onInverse: "#ffffff", surfaceBase: "#ffffff",
  surfaceInverse: "#000000", accent: "#000000", onAccent: "#ffffff",
  fontFamily: "sans-serif",
};
const shape = '<rect x="30" y="30" width="40" height="40"/>';
const wrap = (body: string, attributes = "") => `<svg viewBox="0 0 100 100"${attributes}>${body}</svg>`;
const readers = [
  measureMarkGeometry,
  checkMarkConformance,
  (glyphSvg: string) => normalizeMark({ glyphSvg, tokens }),
  (suppliedSvg: string) => adoptSuppliedMark({ brand: { name: "Example Co." }, suppliedSvg, tokens, normalize: true }),
];

function expectRefusal(input: string, feature: string): void {
  for (const read of readers) {
    let failure: unknown;
    try { read(input); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(MarkGeometryError);
    expect((failure as MarkGeometryError).feature).toBe(feature);
  }
}

describe("mark normalizer sweep boundaries", () => {
  it.each(['"', "'"])("refuses a literal less-than inside %s quoted attributes", quote => {
    const attribute = `data-note=${quote}left<right${quote}`;
    const inputs = [
      wrap(shape, ` ${attribute}`),
      wrap(`<g ${attribute}>${shape}</g>`),
      wrap(shape.replace("/>", ` ${attribute}/>`)),
    ];
    for (const input of inputs) {
      expect(new DOMParser().parseFromString(input, "image/svg+xml").querySelector("parsererror")).not.toBeNull();
      expectRefusal(input, "XML attribute");
    }
  });

  it("retains escaped less-than and ampersands at every metadata occurrence", () => {
    const encoded = "first&lt;&amp;middle&lt;&amp;last";
    const decoded = "first<&middle<&last";
    const input = wrap(shape.replace("/>", ` id="${encoded}"/>`), ` aria-label="${encoded}"`);
    const normalized = normalizeMark({ glyphSvg: input, tokens });
    const parsed = new DOMParser().parseFromString(normalized, "image/svg+xml");
    expect(parsed.querySelector("parsererror")).toBeNull();
    expect(parsed.documentElement.getAttribute("aria-label")).toBe(decoded);
    expect(parsed.querySelector("[id]")?.getAttribute("id")).toBe(decoded);
    expect(normalized.match(/&lt;/g)).toHaveLength(4);
    expect(normalized.match(/&amp;/g)).toHaveLength(4);
    expect(checkMarkConformance(normalized)).toEqual([]);
  });

  it("charges inherited color and stroke even when fill is short", () => {
    const paint = `rgb(${'0'.repeat(4087)} 0 0)`;
    expect(paint).toHaveLength(4096);
    // This remains below the parser's element limit. Charging only fill
    // would miss the expensive inherited color and stroke on each group.
    const input = wrap('<g/>'.repeat(16381) + shape, ` color="${paint}" stroke="${paint}" fill="#000"`);
    for (const read of readers) {
      const start = performance.now();
      let failure: unknown;
      try { read(input); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(MarkGeometryError);
      expect((failure as MarkGeometryError).feature).toBe("paint parsing complexity");
      expect(performance.now() - start).toBeLessThan(100);
    }
  });

  it.each([false, true])("reserves the exact generated-element room with plate=%s", plate => {
    const generated = 3 + (plate ? 1 : 0);
    const groups = 16384 - generated - 1;
    const input = wrap('<g/>'.repeat(groups) + shape);
    const output = normalizeMark({ glyphSvg: input, tokens, plate });
    const document = new DOMParser().parseFromString(output, "image/svg+xml");
    expect(document.querySelector("parsererror")).toBeNull();
    expect(document.querySelectorAll("*")).toHaveLength(16384);
    expect(() => normalizeMark({ glyphSvg: input.replace("</svg>", "<g/></svg>"), tokens, plate }))
      .toThrow("element complexity");
  });

});
