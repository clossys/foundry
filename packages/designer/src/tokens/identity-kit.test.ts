import { describe, expect, it } from "vitest";
import { contrastRatio } from "./color.js";
import { checkSingleColourLegibility, IDENTITY_MIN_CONTRAST } from "./identity-checks.js";
import {
  adoptSuppliedMark,
  deriveInitials,
  generateIdentityDirections,
  IDENTITY_VARIANT_ROLES,
  IdentityKitValidationError,
  isValidCssColor,
  isValidCssFontFamily,
  recolorSvg,
  validateIdentityTokenInput,
  type IdentityTokenInput,
} from "./identity-kit.js";

const TOKENS: IdentityTokenInput = {
  ink: "oklch(0.2178 0 0)",
  onInverse: "oklch(0.9702 0 0)",
  surfaceBase: "oklch(0.9702 0 0)",
  surfaceInverse: "oklch(0.2178 0 0)",
  accent: "oklch(0.2178 0 0)",
  onAccent: "oklch(0.9702 0 0)",
  fontFamily: "system-ui, sans-serif",
};

const SVG_DOCUMENT_RE = /^<svg[\s>][\s\S]*<\/svg>$/;

describe("deriveInitials", () => {
  it("takes the first letter of each of the first two words", () => {
    expect(deriveInitials("Acme Rockets")).toBe("AR");
    expect(deriveInitials("  acme   rockets  co  ")).toBe("AR");
  });

  it("takes the first two letters of a single-word name", () => {
    expect(deriveInitials("Acme")).toBe("AC");
  });

  it("returns the whole word uppercased when it is a single letter", () => {
    expect(deriveInitials("A")).toBe("A");
  });

  it("returns an empty string for an empty/whitespace name", () => {
    expect(deriveInitials("   ")).toBe("");
  });

  it("does not split an astral character (e.g. an emoji) into a broken surrogate half (issue #1320 item 3)", () => {
    // U+1F680 ROCKET is outside the Basic Multilingual Plane: as UTF-16 it
    // is a surrogate PAIR (`.length === 2`), so `.charAt(0)`/`.slice(0, 2)`
    // (UTF-16-code-unit operations) would split it into one lone, invalid
    // surrogate half instead of the whole character. Code-point iteration
    // (`Array.from`) keeps it whole.
    const rocket = "\u{1F680}";
    expect(rocket.length).toBe(2); // sanity check: this really is a surrogate pair
    expect(deriveInitials(`${rocket} Rockets`)).toBe(`${rocket}R`);
    const twoRockets = deriveInitials(`${rocket}${rocket}Ship`);
    expect(twoRockets).toBe(`${rocket}${rocket}`);
    expect(twoRockets.length).toBe(4); // two whole astral characters, four UTF-16 code units — never a lone unpaired surrogate
  });
});

describe("generateIdentityDirections", () => {
  const directions = generateIdentityDirections({ name: "Acme Rockets" }, TOKENS);

  it("returns exactly three directions: one wordmark, two monograms", () => {
    expect(directions).toHaveLength(3);
    expect(directions.map((d) => d.id)).toEqual(["wordmark", "monogram-circle", "monogram-square"]);
    expect(directions.map((d) => d.kind)).toEqual(["wordmark", "monogram", "monogram"]);
  });

  it("is deterministic: the same input produces byte-identical output", () => {
    const again = generateIdentityDirections({ name: "Acme Rockets" }, TOKENS);
    expect(again).toEqual(directions);
  });

  it("every variant in every direction is a complete <svg> document", () => {
    for (const direction of directions) {
      for (const svg of Object.values(direction.variants)) {
        expect(svg.trim()).toMatch(SVG_DOCUMENT_RE);
      }
    }
  });

  it("derives initials from the name when none are supplied", () => {
    expect(directions[0]!.variants.primary).toContain(">AR<");
  });

  it("uses explicit initials over the derived ones", () => {
    const [explicit] = generateIdentityDirections({ name: "Acme Rockets", initials: "ZZ" }, TOKENS);
    expect(explicit!.variants.primary).toContain(">ZZ<");
  });

  it("escapes a name containing XML-sensitive characters", () => {
    const [wordmark] = generateIdentityDirections({ name: 'Ac&me <Rockets>' }, TOKENS);
    expect(wordmark!.variants.primary).toContain("Ac&amp;me &lt;Rockets&gt;");
    expect(wordmark!.variants.primary).not.toContain("<Rockets>");
  });

  it("mono and favicon variants paint through currentColor only", () => {
    for (const direction of directions) {
      expect(direction.variants.mono).toContain('style="color:currentColor"');
      expect(direction.variants.favicon).toContain('style="color:currentColor"');
    }
  });

  it("declares data-clear-space on every root <svg>", () => {
    for (const direction of directions) {
      for (const svg of Object.values(direction.variants)) {
        expect(svg).toMatch(/data-clear-space="0\.2"/);
      }
    }
  });

  it("primary and light are the same lockup; dark is recoloured to the inverse ink token", () => {
    const [wordmark] = directions;
    expect(wordmark!.variants.primary).toBe(wordmark!.variants.light);
    expect(wordmark!.variants.dark).not.toBe(wordmark!.variants.primary);
    expect(wordmark!.variants.dark).toContain(`color:${TOKENS.onInverse}`);
  });

  it("composes the appIcon badge from the accent and onAccent tokens", () => {
    for (const direction of directions) {
      expect(direction.variants.appIcon).toContain(`fill="${TOKENS.accent}"`);
      expect(direction.variants.appIcon).toContain(`color:${TOKENS.onAccent}`);
    }
  });

  it("a generated mark (already drawn in the badge's own 0 0 48 48 viewBox) gets an identity transform, not a scaled one", () => {
    for (const direction of directions) {
      expect(direction.variants.appIcon).toContain('transform="translate(0,0) scale(1)"');
    }
  });
});

describe("recolorSvg", () => {
  it("replaces fill and stroke attribute values, leaving none/transparent untouched", () => {
    const svg = '<svg><path fill="#fff" stroke="none" /><rect fill="none" stroke="#000" /></svg>';
    expect(recolorSvg(svg, "red")).toBe('<svg><path fill="red" stroke="none" /><rect fill="none" stroke="red" /></svg>');
  });

  it("recolours a single-quoted or spaced fill/stroke attribute, and never touches data-fill (issue #1320 item 5)", () => {
    const svg = "<svg><path fill = '#fff' data-fill=\"#000\" stroke='none' /></svg>";
    expect(recolorSvg(svg, "red")).toBe('<svg><path fill="red" data-fill="#000" stroke=\'none\' /></svg>');
  });

  const TWO_TONE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#1a1a1a" /><path d="M8 8h8v8H8z" fill="#f5f5f5" stroke="none" /></svg>';

  it("recolours a two-tone document as a knockout: two masks, and only the target colour or none as paint outside them (issue #1537)", () => {
    const out = recolorSvg(TWO_TONE, "currentColor");
    expect(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">')).toBe(true);
    expect(out.endsWith("</svg>")).toBe(true);
    const masks = out.match(/<mask\b[\s\S]*?<\/mask>/g) ?? [];
    expect(masks).toHaveLength(2);
    for (const mask of masks) expect(mask).toContain('<rect x="0" y="0" width="24" height="24" fill="#fff" />');
    const ids = [...out.matchAll(/<mask id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([expect.stringMatching(/^recolor-[0-9a-f]{8}-a$/), expect.stringMatching(/^recolor-[0-9a-f]{8}-b$/)]);
    for (const id of ids) expect(out).toContain(`mask="url(#${id})"`);
    const outside = out.replace(/<mask\b[\s\S]*?<\/mask>/g, "");
    const paints = new Set([...outside.matchAll(/(?<![\w-])(?:fill|stroke)="([^"]*)"/g)].map((m) => m[1]));
    expect([...paints].sort()).toEqual(["currentColor", "none"]);
    expect(checkSingleColourLegibility(out).ok).toBe(true);
  });

  it("is deterministic for a two-tone document, and gives each colour variant its own mask ids", () => {
    expect(recolorSvg(TWO_TONE, "red")).toBe(recolorSvg(TWO_TONE, "red"));
    const idOf = (svg: string): string | undefined => svg.match(/<mask id="([^"]+)"/)?.[1];
    expect(idOf(recolorSvg(TWO_TONE, "red"))).not.toBe(idOf(recolorSvg(TWO_TONE, "blue")));
  });
});

describe("adoptSuppliedMark", () => {
  const suppliedSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#112233" d="M0 0h24v24H0z" /></svg>';

  it("throws IdentityKitValidationError for a non-svg document", () => {
    expect(() => adoptSuppliedMark({ brand: { name: "Acme" }, suppliedSvg: "<div>not svg</div>", tokens: TOKENS })).toThrow(IdentityKitValidationError);
  });

  it("throws for trailing content after the closing </svg> tag (issue #1320 item 4)", () => {
    // Before the fix, isSvgDocument only checked that a </svg> closing tag
    // existed SOMEWHERE in the string, not that it was the final
    // non-whitespace content — so this payload passed as a "complete <svg>
    // document" and its <script> would have been adopted as primary/mark.
    const trailingContent = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z" /></svg><script>alert(1)</script>';
    expect(() => adoptSuppliedMark({ brand: { name: "Acme" }, suppliedSvg: trailingContent, tokens: TOKENS })).toThrow(IdentityKitValidationError);
  });

  it("keeps primary/mark as the supplied SVG unchanged", () => {
    const direction = adoptSuppliedMark({ brand: { name: "Acme" }, suppliedSvg, tokens: TOKENS });
    expect(direction.variants.primary).toBe(suppliedSvg);
    expect(direction.variants.mark).toBe(suppliedSvg);
    expect(direction.kind).toBe("adopted");
  });

  it("derives mono via currentColor and light/dark via the ink/onInverse tokens", () => {
    const direction = adoptSuppliedMark({ brand: { name: "Acme" }, suppliedSvg, tokens: TOKENS });
    expect(direction.variants.mono).toContain('fill="currentColor"');
    expect(direction.variants.light).toContain(`fill="${TOKENS.ink}"`);
    expect(direction.variants.dark).toContain(`fill="${TOKENS.onInverse}"`);
    expect(direction.variants.favicon).toContain('fill="currentColor"');
  });

  it("composes appIcon from the supplied mark's inner content on an accent badge", () => {
    const direction = adoptSuppliedMark({ brand: { name: "Acme" }, suppliedSvg, tokens: TOKENS });
    expect(direction.variants.appIcon).toContain(`fill="${TOKENS.accent}"`);
    expect(direction.variants.appIcon).toContain("M0 0h24v24H0z");
  });

  it("scales and centres a supplied mark's own 0 0 24 24 viewBox to fill the fixed 0 0 48 48 badge (issue #1320 item 6)", () => {
    // Before the fix, wrapBadge dropped the supplied mark's inner markup
    // straight into the fixed 0 0 48 48 badge coordinate system with no
    // reconciliation: a 0 0 24 24 mark occupied only a quarter of the
    // badge, pinned to the top-left corner. A uniform scale of 48/24 = 2,
    // centred (translate(0,0) here, since the source viewBox's own origin
    // is already 0,0), fixes that.
    const direction = adoptSuppliedMark({ brand: { name: "Acme" }, suppliedSvg, tokens: TOKENS });
    expect(direction.variants.appIcon).toContain('transform="translate(0,0) scale(2)"');
  });

  it("falls back to an untransformed (scale-1) badge when the supplied mark declares no parseable viewBox", () => {
    const noViewBox = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#112233" d="M0 0h24v24H0z" /></svg>';
    const direction = adoptSuppliedMark({ brand: { name: "Acme" }, suppliedSvg: noViewBox, tokens: TOKENS });
    expect(direction.variants.appIcon).toContain('transform="translate(0,0) scale(1)"');
  });
});

describe("isValidCssColor", () => {
  it("accepts every colour form this repository's own tokens use", () => {
    for (const value of ["oklch(0.2178 0 0)", "oklch(0.9702 0.05 250 / 0.5)", "#fff", "#ffffff", "#ffffffff", "rgb(0 0 0)", "rgba(0, 0, 0, 0.5)", "hsl(0 0% 0%)", "currentColor", "CURRENTCOLOR", "transparent"]) {
      expect(isValidCssColor(value), value).toBe(true);
    }
  });

  it("rejects attribute-breakout and element-injection payloads", () => {
    for (const value of [
      '"><script>alert(1)</script><rect fill="',
      '"/><image href="x" onerror="alert(document.domain)"/><rect fill="',
      "red; background: url(javascript:alert(1))",
      "expression(alert(1))",
      "javascript:alert(1)",
      "red</style><script>alert(1)</script>",
      "",
      "   ",
      "not-a-colour",
      "oklch(0.2178 0 0); }</style><script>alert(1)</script>",
    ]) {
      expect(isValidCssColor(value), value).toBe(false);
    }
  });

  it("rejects a non-string value and an oversized string", () => {
    expect(isValidCssColor(undefined as unknown as string)).toBe(false);
    expect(isValidCssColor(`#${"f".repeat(300)}`)).toBe(false);
  });
});

describe("isValidCssFontFamily", () => {
  it("accepts a real font stack, including quoted multi-word names", () => {
    expect(isValidCssFontFamily('system-ui, ui-sans-serif, -apple-system, "Segoe UI", sans-serif')).toBe(true);
  });

  it("rejects attribute-breakout and element-injection payloads", () => {
    for (const value of [
      '"><script>alert(1)</script><text font-family="',
      "sans-serif; } </style><script>alert(1)</script>",
      "sans-serif<image onerror=alert(1)>",
      "sans-serif & co",
      "",
    ]) {
      expect(isValidCssFontFamily(value), value).toBe(false);
    }
  });
});

describe("validateIdentityTokenInput", () => {
  it("does not throw for a fully valid token set", () => {
    expect(() => validateIdentityTokenInput(TOKENS)).not.toThrow();
  });

  it("throws IdentityKitValidationError naming every invalid field, not just the first", () => {
    const badTokens: IdentityTokenInput = {
      ...TOKENS,
      ink: '"><script>alert(1)</script>',
      accent: '"/><image onerror="alert(1)"/><rect fill="',
      fontFamily: '"><script>alert(2)</script>',
    };
    expect(() => validateIdentityTokenInput(badTokens)).toThrow(IdentityKitValidationError);
    try {
      validateIdentityTokenInput(badTokens);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(IdentityKitValidationError);
      const reasons = (error as IdentityKitValidationError).reasons;
      expect(reasons.some((r) => r.includes("ink"))).toBe(true);
      expect(reasons.some((r) => r.includes("accent") && !r.includes("onAccent"))).toBe(true);
      expect(reasons.some((r) => r.includes("fontFamily"))).toBe(true);
    }
  });
});

describe("injection resistance (issue: unescaped token interpolation)", () => {
  const injectionTokens: IdentityTokenInput = {
    ...TOKENS,
    fontFamily: '"><image href="x" onerror="alert(document.domain)"/><text font-family="',
    accent: '"/><script>alert(1)</script><rect fill="',
  };

  it("generateIdentityDirections refuses an injection-shaped fontFamily/accent before generating anything", () => {
    expect(() => generateIdentityDirections({ name: "Acme" }, injectionTokens)).toThrow(IdentityKitValidationError);
  });

  it("adoptSuppliedMark refuses an injection-shaped token set before deriving any variant", () => {
    const suppliedSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#112233" d="M0 0h24v24H0z" /></svg>';
    expect(() => adoptSuppliedMark({ brand: { name: "Acme" }, suppliedSvg, tokens: injectionTokens })).toThrow(IdentityKitValidationError);
  });

  it("a legitimate direction never contains an unescaped <script>, <image>, or attribute-breakout, even for a name carrying markup", () => {
    const [wordmark, circle, square] = generateIdentityDirections({ name: '<script>alert(1)</script>' }, TOKENS);
    for (const direction of [wordmark, circle, square]) {
      for (const svg of Object.values(direction.variants)) {
        expect(svg).not.toContain("<script>");
        expect(svg).not.toContain("<image");
        expect(svg).not.toMatch(/onerror\s*=/);
      }
    }
  });

  it("recolorSvg escapes its own color parameter (defense in depth for direct callers)", () => {
    const svg = '<svg><path fill="#112233" /></svg>';
    const recoloured = recolorSvg(svg, '"/><script>alert(1)</script><path fill="');
    expect(recoloured).not.toContain("<script>");
    expect(recoloured).toContain("&quot;/&gt;&lt;script&gt;");
  });
});

/**
 * `recolorSvg` exactly as released on main before #1537 (the flat recolour).
 * The oracle for "any input outside the recognised flat two-tone subset is
 * recoloured flat, byte-identical to the previous release".
 */
const MAIN_PAINT_ATTR_RE = /(?<![\w-])(fill|stroke)\s*=\s*("([^"]*)"|'([^']*)')/g;
function mainRecolorSvg(svg: string, color: string): string {
  const escapedColor = color.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  return svg.replace(MAIN_PAINT_ATTR_RE, (match, attr: string, _quoted: string, doubleQuoted: string | undefined, singleQuoted: string | undefined) => {
    const value = doubleQuoted ?? singleQuoted ?? "";
    if (value === "none" || value === "transparent" || value === "") return match;
    return `${attr}="${escapedColor}"`;
  });
}

describe("recolorSvg knocks out only a recognised flat two-tone mark (issue #1537, fail-closed)", () => {
  const NS = 'xmlns="http://www.w3.org/2000/svg"';
  const FIGURE_D = "M16 16h16v16H16z";
  const FIELD_RECT = '<rect width="48" height="48" fill="#1a1a1a" />';
  const FIGURE_PATH = `<path d="${FIGURE_D}" fill="#f5f5f5" />`;
  const doc = (inner: string, rootExtra = ""): string => `<svg ${NS} viewBox="0 0 48 48"${rootExtra}>${inner}</svg>`;
  const XLINK = ' xmlns:xlink="http://www.w3.org/1999/xlink"';
  const COLORS = ["red", "currentColor", "oklch(0.2178 0 0)"] as const;

  const FLAT_SVG = doc(FIELD_RECT + FIGURE_PATH);
  const GROUPED_SVG = doc(`<g transform="translate(0,0) scale(1)">${FIELD_RECT}${FIGURE_PATH}</g>`);

  /** Documents the recogniser accepts: each must be knocked out (two masks). */
  const RECOGNISED: [string, string][] = [
    ["flat rect + path", FLAT_SVG],
    ["grouped", GROUPED_SVG],
    ["root role/aria-label/width/height/data-clear-space", `<svg ${NS} viewBox="0 0 48 48" width="48" height="48" role="img" aria-label="Acme logo" data-clear-space="4">${FIELD_RECT}${FIGURE_PATH}</svg>`],
    ["single-quoted values and spaced attributes", `<svg ${NS} viewBox='0 0 48 48'>\n  <rect width = '48' height='48' fill='#1a1a1a'/>\n  <path d='${FIGURE_D}' fill = '#f5f5f5'/>\n</svg>`],
    ["hex normalisation (#FFF field, #000 figure)", doc(`<rect width="48" height="48" fill="#FFF" /><path d="${FIGURE_D}" fill="#000000" />`)],
    ["stroked shapes and every basic shape", doc(
      '<rect width="48" height="48" rx="4" fill="#1a1a1a" stroke="#1A1A1A" stroke-width="2" />' +
        '<circle cx="24" cy="24" r="10" fill="#1a1a1a" stroke="none" />' +
        '<ellipse cx="24" cy="24" rx="8" ry="6" fill="#f5f5f5" stroke="#f5f5f5" stroke-linejoin="round" />' +
        '<polygon points="10,10 20,10 20,20" fill="#f5f5f5" fill-rule="evenodd" clip-rule="evenodd" />' +
        '<polyline points="1,1 2,2" fill="#f5f5f5" />' +
        '<line x1="0" y1="0" x2="4" y2="4" fill="#f5f5f5" stroke="#f5f5f5" />',
    )],
  ];

  /** Documents outside the recognised subset: each must come back exactly as main's flat recolour. */
  const FLAT: [string, string][] = [
    // Injection: attribute values that would break out of a re-emitted quote (#1589 CodeQL).
    ["injection via id", doc(`${FIELD_RECT}<path id='x" onload="alert(1)' d="${FIGURE_D}" fill="#f5f5f5" />`)],
    ["injection via d", doc(`${FIELD_RECT}<path d='M0 0" onload="x' fill="#f5f5f5" />`)],
    ["injection via transform on a group", doc(`<g transform='a" onload="b'>${FIELD_RECT}${FIGURE_PATH}</g>`)],
    ["injection via root aria-label", `<svg ${NS} viewBox="0 0 48 48" aria-label='x" onload="y'>${FIELD_RECT}${FIGURE_PATH}</svg>`],
    ["ampersand in a value", doc(`${FIELD_RECT}<path d="M0 0&amp;" fill="#f5f5f5" />`)],
    ["angle bracket in a value", doc(`${FIELD_RECT}<path d="M0 0" data-x="a&lt;b" fill="#f5f5f5" />`)],
    // A reference from the root.
    ["root clip-path", doc(FIELD_RECT + FIGURE_PATH, ' clip-path="url(#c)"')],
    ["root mask", doc(FIELD_RECT + FIGURE_PATH, ' mask="url(#m)"')],
    ["root filter", doc(FIELD_RECT + FIGURE_PATH, ' filter="url(#f)"')],
    ["root style mask", doc(FIELD_RECT + FIGURE_PATH, ' style="mask:url(#m)"')],
    // Rounds 1 and 2 of the #1589 review.
    ["root fill", doc(`<rect width="48" height="48" />${FIGURE_PATH}`, ' fill="#1a1a1a"')],
    ["root style fill", doc(`<rect width="48" height="48" />${FIGURE_PATH}`, ' style="fill:#1a1a1a"')],
    ["root stroke", doc(`<rect width="48" height="48" />${FIGURE_PATH}`, ' fill="none" stroke="#1a1a1a"')],
    ["group fill", doc(`<g fill="#1a1a1a"><rect width="48" height="48" /></g>${FIGURE_PATH}`)],
    ["use href", doc(`${FIELD_RECT}<defs><path id="fig" d="${FIGURE_D}" fill="#f5f5f5" /></defs><use href="#fig" />`)],
    ["use xlink:href", doc(`${FIELD_RECT}<defs><path id="fig" d="${FIGURE_D}" fill="#f5f5f5" /></defs><use xlink:href="#fig" />`, XLINK)],
    ["aria-labelledby", doc(`<title id="t">Acme</title>${FIELD_RECT}${FIGURE_PATH}`, ' aria-labelledby="t"')],
    ["id on a shape", doc(`<rect id="bg" width="48" height="48" fill="#1a1a1a" />${FIGURE_PATH}`)],
    ["url() reference from a shape", doc(`<rect width="48" height="48" fill="#1a1a1a" />${FIGURE_PATH.replace("/>", 'clip-path="url(#c)" />')}`)],
    // Tone rules.
    ["A-B-A order", doc(`${FIELD_RECT}${FIGURE_PATH}<path d="M0 0h4v4H0z" fill="#1a1a1a" />`)],
    ["three tones", doc(`${FIELD_RECT}${FIGURE_PATH}<path d="M0 0h4v4H0z" fill="#ff0000" />`)],
    ["one tone written two ways (#fff and #FFFFFF)", doc(`<rect width="48" height="48" fill="#fff" /><path d="${FIGURE_D}" fill="#FFFFFF" />`)],
    ["one tone only", doc(`${FIELD_RECT}<path d="${FIGURE_D}" fill="#1a1a1a" />`)],
    ["alpha hex (#rrggbbaa)", doc(`${FIELD_RECT}<path d="${FIGURE_D}" fill="#f5f5f580" />`)],
    ["alpha hex (#rgba)", doc(`${FIELD_RECT}<path d="${FIGURE_D}" fill="#f5f8" />`)],
    ["named colour", doc(`${FIELD_RECT}<path d="${FIGURE_D}" fill="white" />`)],
    ["rgb() colour", doc(`${FIELD_RECT}<path d="${FIGURE_D}" fill="rgb(245,245,245)" />`)],
    ["currentColor fill", doc(`${FIELD_RECT}<path d="${FIGURE_D}" fill="currentColor" />`)],
    ["shape with fill none", doc(`${FIELD_RECT}${FIGURE_PATH}<path d="M0 0h4v4H0z" fill="none" stroke="#1a1a1a" />`)],
    ["shape with no fill", doc(`${FIELD_RECT}${FIGURE_PATH}<path d="M0 0h4v4H0z" />`)],
    ["stroke a different tone from fill", doc(`${FIELD_RECT}<path d="${FIGURE_D}" fill="#f5f5f5" stroke="#1a1a1a" />`)],
    // Markup outside the grammar.
    ["style attribute on a shape", doc(`${FIELD_RECT}<path d="${FIGURE_D}" fill="#f5f5f5" style="fill:#ff0000" />`)],
    ["class attribute", doc(`${FIELD_RECT}<path d="${FIGURE_D}" fill="#f5f5f5" class="fig" />`)],
    ["<style> element", doc(`<style>.fig{fill:red}</style>${FIELD_RECT}${FIGURE_PATH}`)],
    ["opacity attribute", doc(`${FIELD_RECT}<path d="${FIGURE_D}" fill="#f5f5f5" opacity="0.5" />`)],
    ["fill-opacity attribute", doc(`${FIELD_RECT}<path d="${FIGURE_D}" fill="#f5f5f5" fill-opacity="0.5" />`)],
    ["unknown attribute on a shape", doc(`${FIELD_RECT}<path d="${FIGURE_D}" fill="#f5f5f5" data-x="1" />`)],
    ["paint attribute on a group", doc(`<g fill="#1a1a1a">${FIELD_RECT}</g>${FIGURE_PATH}`)],
    ["own <mask>", doc(`<defs><mask id="m"><rect width="48" height="48" fill="#fff" /></mask></defs>${FIELD_RECT}${FIGURE_PATH}`)],
    ["text element", doc(`${FIELD_RECT}${FIGURE_PATH}<text fill="#f5f5f5">A</text>`)],
    ["text node between tags", doc(`${FIELD_RECT} hello ${FIGURE_PATH}`)],
    ["comment", doc(`${FIELD_RECT}<!-- note -->${FIGURE_PATH}`)],
    ["CDATA", doc(`${FIELD_RECT}<![CDATA[x]]>${FIGURE_PATH}`)],
    ["processing instruction", doc(`${FIELD_RECT}<?x y?>${FIGURE_PATH}`)],
    ["non-self-closing path", doc(`${FIELD_RECT}<path d="${FIGURE_D}" fill="#f5f5f5"></path>`)],
    ["self-closing group", doc(`${FIELD_RECT}${FIGURE_PATH}<g />`)],
    ["unbalanced group", doc(`<g>${FIELD_RECT}${FIGURE_PATH}`)],
    ["unknown element", doc(`${FIELD_RECT}${FIGURE_PATH}<image href="x.png" />`)],
    ["element named like an Object property", doc(`${FIELD_RECT}${FIGURE_PATH}<constructor fill="#f5f5f5" />`)],
    ["nested <svg>", doc(`${FIELD_RECT}<svg>${FIGURE_PATH}</svg>`)],
    ["group with id", doc(`<g id="g">${FIELD_RECT}${FIGURE_PATH}</g>`)],
    ["group with opacity", doc(`<g opacity="0.5">${FIELD_RECT}${FIGURE_PATH}</g>`)],
    ["root xmlns:xlink", doc(FIELD_RECT + FIGURE_PATH, XLINK)],
    ["root style", doc(FIELD_RECT + FIGURE_PATH, ' style="color:red"')],
    ["root class", doc(FIELD_RECT + FIGURE_PATH, ' class="x"')],
    ["duplicate attribute", doc(`${FIELD_RECT}<path d="${FIGURE_D}" d="M0 0" fill="#f5f5f5" />`)],
    ["no viewBox", `<svg ${NS}>${FIELD_RECT}${FIGURE_PATH}</svg>`],
    ["unparseable viewBox", `<svg ${NS} viewBox="0 0 wide 48">${FIELD_RECT}${FIGURE_PATH}</svg>`],
    ["not an svg document", `${FIELD_RECT}${FIGURE_PATH}`],
    ["content after </svg>", `${FLAT_SVG}<script>alert(1)</script>`],
    ["empty document", "<svg></svg>"],
  ];

  const parse = (svg: string): Document => new DOMParser().parseFromString(svg, "image/svg+xml");
  const maskCount = (svg: string): number => (svg.match(/<mask\b/g) ?? []).length;

  /**
   * The output adds no attribute name beyond the generated mask ones, and
   * every attribute value is a verbatim input value, the (escaped) colour,
   * #fff/#000/none, or a generated `recolor-<hash>` id or region.
   */
  function expectAddsNothing(input: string, output: string, color: string): void {
    const names = new Set(["mask", "maskUnits", "id", "x", "y", "width", "height"]);
    const values = new Set([color, "#fff", "#000", "none", "userSpaceOnUse"]);
    for (const el of Array.from(parse(input).querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) {
        names.add(attr.name);
        values.add(attr.value);
      }
    }
    const out = parse(output);
    expect(out.querySelector("parsererror"), `output is not well-formed: ${output}`).toBeNull();
    for (const el of Array.from(out.querySelectorAll("*"))) {
      for (const attr of Array.from(el.attributes)) {
        expect(names.has(attr.name), `attribute name "${attr.name}" is new`).toBe(true);
        const generated = /^recolor-[0-9a-f]{8}-[ab]$/.test(attr.value) || /^url\(#recolor-[0-9a-f]{8}-[ab]\)$/.test(attr.value) || /^-?\d+(\.\d+)?$/.test(attr.value);
        expect(values.has(attr.value) || generated, `attribute ${attr.name}="${attr.value}" is not a verbatim input value, the colour, or generated`).toBe(true);
        expect(attr.name.startsWith("on"), `event handler ${attr.name}`).toBe(false);
      }
    }
  }

  describe("outside the recognised subset the output is main's flat recolour, byte for byte", () => {
    it.each(FLAT)("%s", (_name, svg) => {
      for (const color of COLORS) expect(recolorSvg(svg, color)).toBe(mainRecolorSvg(svg, color));
    });

    it("an injected attribute never reaches the parsed output (jsdom parse has no onload)", () => {
      for (const [name, svg] of FLAT.filter(([n]) => n.startsWith("injection"))) {
        const out = recolorSvg(svg, "red");
        expect(out, name).toBe(mainRecolorSvg(svg, "red"));
        expect(parse(out).querySelector("[onload]"), name).toBeNull();
      }
    });

    it("paint-value escaping is unchanged: the colour is still XML-escaped", () => {
      const out = recolorSvg(doc(`${FIELD_RECT}<path d="${FIGURE_D}" fill="#1a1a1a" />`), 'red"/><script>');
      expect(out).not.toContain("<script>");
      expect(out).toContain("&quot;/&gt;&lt;script&gt;");
    });
  });

  describe("a recognised flat two-tone mark is knocked out", () => {
    it.each(RECOGNISED)("%s: two masks, well-formed, adds no attribute name or value the input lacked", (_name, svg) => {
      for (const color of COLORS) {
        const out = recolorSvg(svg, color);
        expect(out).not.toBe(mainRecolorSvg(svg, color));
        expect(maskCount(out)).toBe(2);
        expectAddsNothing(svg, out, color);
      }
    });

    it("a canonically written root start tag is carried over unchanged", () => {
      const svg = `<svg ${NS} viewBox="0 0 48 48" width="48" height="48" role="img" aria-label="Acme logo" data-clear-space="4">${FIELD_RECT}${FIGURE_PATH}</svg>`;
      expect(recolorSvg(svg, "red").startsWith(svg.slice(0, svg.indexOf(">") + 1))).toBe(true);
    });

    it("is deterministic and never renames an id the input carried (there are none in the subset)", () => {
      expect(recolorSvg(FLAT_SVG, "red")).toBe(recolorSvg(FLAT_SVG, "red"));
      for (const [, svg] of RECOGNISED) expect(svg).not.toMatch(/\bid\s*=/);
    });
  });

  describe("the recogniser's cost is bounded, and an input over a cap is flat (byte-identical to main)", () => {
    // Caps documented in the README and the changeset: 32 attributes on a
    // tag, 2000 elements in all, 32 groups deep.
    const MAX_ATTRS = 32;
    const MAX_ELEMENTS = 2000;
    const MAX_DEPTH = 32;
    const BUDGET_MS = 250;

    /** `recolorSvg(svg, color)` and how long it took, in ms. */
    function timed(svg: string, color = "red"): { out: string; ms: number } {
      const start = performance.now();
      const out = recolorSvg(svg, color);
      return { out, ms: performance.now() - start };
    }
    /** Distinct attribute names the recogniser allows on a shape: `stroke-` plus letters. */
    const strokeName = (i: number): string => `stroke-${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`;
    const shapeWithAttrs = (count: number): string => {
      // d + fill + (count - 2) distinct stroke-* attributes = `count` attributes.
      const extra = Array.from({ length: count - 2 }, (_, i) => ` ${strokeName(i)}="1"`).join("");
      return `<path d="${FIGURE_D}" fill="#f5f5f5"${extra} />`;
    };

    it("a 200 KB root with tens of thousands of attributes finishes within budget and is flat", () => {
      const attrs = Array.from({ length: 30000 }, (_, i) => ` a${i}=""`).join("");
      const svg = `<svg ${NS} viewBox="0 0 48 48"${attrs}>${FIELD_RECT}${FIGURE_PATH}</svg>`;
      expect(svg.length).toBeGreaterThan(200_000);
      const { out, ms } = timed(svg);
      expect(out).toBe(mainRecolorSvg(svg, "red"));
      expect(ms).toBeLessThan(BUDGET_MS);
    });

    it("a 200 KB shape with tens of thousands of attributes finishes within budget and is flat", () => {
      const attrs = Array.from({ length: 30000 }, (_, i) => ` a${i}=""`).join("");
      const svg = doc(`${FIELD_RECT}<path d="${FIGURE_D}" fill="#f5f5f5"${attrs} />`);
      const { out, ms } = timed(svg);
      expect(out).toBe(mainRecolorSvg(svg, "red"));
      expect(ms).toBeLessThan(BUDGET_MS);
    });

    it("a 200 KB duplicate-attribute root is flat within budget", () => {
      const attrs = Array.from({ length: 30000 }, () => ` viewBox="0 0 48 48"`).join("");
      const svg = `<svg ${NS}${attrs}>${FIELD_RECT}${FIGURE_PATH}</svg>`;
      const { out, ms } = timed(svg);
      expect(out).toBe(mainRecolorSvg(svg, "red"));
      expect(ms).toBeLessThan(BUDGET_MS);
    });

    it("a recognised mark 5,000 groups deep returns main's output and does not throw", () => {
      const svg = doc(`${"<g>".repeat(5000)}${FIELD_RECT}${FIGURE_PATH}${"</g>".repeat(5000)}`);
      let out = "";
      expect(() => {
        out = recolorSvg(svg, "red");
      }).not.toThrow();
      expect(out).toBe(mainRecolorSvg(svg, "red"));
    });

    it("adoptSuppliedMark does not throw on a 5,000-deep group mark", () => {
      const svg = doc(`${"<g>".repeat(5000)}${FIELD_RECT}${FIGURE_PATH}${"</g>".repeat(5000)}`);
      expect(() => adoptSuppliedMark({ brand: { name: "Acme" }, suppliedSvg: svg, tokens: TOKENS })).not.toThrow();
    });

    it("an input just under the attribute cap is still knocked out; one over it is flat", () => {
      const under = doc(FIELD_RECT + shapeWithAttrs(MAX_ATTRS));
      expect(maskCount(recolorSvg(under, "red"))).toBe(2);
      const over = doc(FIELD_RECT + shapeWithAttrs(MAX_ATTRS + 1));
      expect(recolorSvg(over, "red")).toBe(mainRecolorSvg(over, "red"));
    });

    it("an input just under the element cap is still knocked out; one over it is flat", () => {
      const many = (n: number): string => `${FIELD_RECT}${FIGURE_PATH.repeat(n - 1)}`;
      const under = doc(many(MAX_ELEMENTS));
      expect(maskCount(recolorSvg(under, "red"))).toBe(2);
      const over = doc(many(MAX_ELEMENTS + 1));
      expect(recolorSvg(over, "red")).toBe(mainRecolorSvg(over, "red"));
      // Groups count as elements too.
      const groups = doc(`${"<g></g>".repeat(MAX_ELEMENTS)}${FIELD_RECT}${FIGURE_PATH}`);
      expect(recolorSvg(groups, "red")).toBe(mainRecolorSvg(groups, "red"));
    });

    it("an input just under the nesting cap is still knocked out; one over it is flat", () => {
      const nested = (depth: number): string => doc(`${"<g>".repeat(depth)}${FIELD_RECT}${FIGURE_PATH}${"</g>".repeat(depth)}`);
      expect(maskCount(recolorSvg(nested(MAX_DEPTH), "red"))).toBe(2);
      expect(recolorSvg(nested(MAX_DEPTH + 1), "red")).toBe(mainRecolorSvg(nested(MAX_DEPTH + 1), "red"));
    });

    it("attribute scanning is linear: 80 KB whitespace witnesses finish within budget and are flat", () => {
      const tabs = "\t".repeat(80_000);
      const witnesses: [string, string][] = [
        ["tabs then a name with no '='", `<svg ${NS} viewBox="0 0 48 48"${tabs}x>${FIELD_RECT}${FIGURE_PATH}</svg>`],
        ["tabs around '='", `<svg ${NS} viewBox${tabs}=${tabs}"0 0 48 48"${tabs}!>${FIELD_RECT}${FIGURE_PATH}</svg>`],
        ["tabs after the last attribute, no '>'", `<svg ${NS} viewBox="0 0 48 48"${tabs}!${FIELD_RECT}${FIGURE_PATH}</svg>`],
        ["tabs then an unterminated value", `<svg ${NS} viewBox="0 0 48 48"${tabs}x="${tabs}`],
        ["tabs inside a shape tag", doc(`${FIELD_RECT}<path d="${FIGURE_D}"${tabs}fill${tabs}`)],
      ];
      for (const [name, svg] of witnesses) {
        const { out, ms } = timed(svg);
        expect(out, name).toBe(mainRecolorSvg(svg, "red"));
        expect(ms, name).toBeLessThan(BUDGET_MS);
      }
    });
  });

  describe("the root is re-emitted from its parsed attributes, not sliced from the input", () => {
    it("re-emits allowlisted root attributes canonically, values unchanged", () => {
      const svg = `<svg\n  xmlns = '${"http://www.w3.org/2000/svg"}'\tviewBox='0 0 48 48'  role="img">${FIELD_RECT}${FIGURE_PATH}</svg>`;
      const out = recolorSvg(svg, "red");
      expect(maskCount(out)).toBe(2);
      expect(out.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img"><defs>')).toBe(true);
      expectAddsNothing(svg, out, "red");
    });
  });

  describe("a recognised two-tone mark keeps contrast between its tones in every variant (issue #1537)", () => {
    // 48x48 so `appIcon`'s badge transform resolves to the identity
    // `translate(0,0) scale(1)`: the fixture's coordinates stay literal.
    type Point = { x: number; y: number };
    const FIELD: Point = { x: 4, y: 4 }; // inside the square, outside the figure
    const FIGURE: Point = { x: 24, y: 24 }; // inside the figure
    const IDENTITY_TRANSFORM = "translate(0,0) scale(1)";
    const PATH_BOXES: Record<string, [number, number, number, number]> = { [FIGURE_D]: [16, 32, 16, 32] };

    /**
     * Models SVG painting for these fixtures only (a 48x48 `rect` plus one
     * square `path`, optionally in a group with an identity transform) and
     * throws on anything else, so it can never silently mis-measure a
     * variant. Painter's algorithm in document order; `<defs>`/`<mask>`
     * contents are not painted directly.
     */
    function renderedColorAt(svg: string, point: Point, ctx: { surface: string; currentColor: string }): string {
      const document_ = parse(svg);
      const ancestors = (el: Element): Element[] => {
        const chain: Element[] = [];
        for (let node: Element | null = el; node; node = node.parentElement) chain.push(node);
        return chain;
      };
      const inside = (v: number, lo: number, hi: number): boolean => v >= lo && v <= hi;
      const covers = (shape: Element): boolean => {
        if (shape.tagName === "rect") {
          const x = Number(shape.getAttribute("x") ?? 0);
          const y = Number(shape.getAttribute("y") ?? 0);
          return inside(point.x, x, x + Number(shape.getAttribute("width"))) && inside(point.y, y, y + Number(shape.getAttribute("height")));
        }
        const box = PATH_BOXES[shape.getAttribute("d") ?? ""];
        if (box === undefined) throw new Error(`renderedColorAt: unknown path geometry ${shape.getAttribute("d")}`);
        return inside(point.x, box[0], box[1]) && inside(point.y, box[2], box[3]);
      };
      const rawFill = (el: Element): string => {
        for (const node of ancestors(el)) {
          const value = node.getAttribute("fill")?.trim();
          if (value !== undefined) return value;
        }
        return "#000000";
      };
      const shapes = (root: ParentNode): Element[] => Array.from(root.querySelectorAll("rect, path"));
      const assertIdentityTransform = (el: Element): void => {
        for (const a of ancestors(el)) {
          const t = a.getAttribute("transform");
          if (t !== null && t.trim() !== IDENTITY_TRANSFORM) throw new Error(`renderedColorAt: unsupported transform "${t}"`);
        }
      };
      const maskCoverage = (id: string): number => {
        const mask = document_.querySelector(`mask[id="${id}"]`);
        if (!mask) throw new Error(`renderedColorAt: no <mask id="${id}">`);
        let coverage = 0;
        for (const shape of shapes(mask)) {
          const paint = rawFill(shape).toLowerCase();
          if (paint === "none" || !covers(shape)) continue;
          if (paint === "#fff") coverage = 1;
          else if (paint === "#000") coverage = 0;
          else throw new Error(`renderedColorAt: unsupported mask paint ${paint}`);
        }
        return coverage;
      };

      let color = ctx.surface;
      for (const shape of shapes(document_)) {
        if (ancestors(shape).some((a) => a.tagName === "defs" || a.tagName === "mask")) continue;
        assertIdentityTransform(shape);
        if (!covers(shape)) continue;
        const maskRef = ancestors(shape)
          .map((a) => a.getAttribute("mask")?.match(/^url\(#([^)]+)\)$/)?.[1])
          .find((id) => id !== undefined);
        if (maskRef !== undefined && maskCoverage(maskRef) === 0) continue;
        const fill = rawFill(shape);
        if (fill === "none") continue;
        color = fill.toLowerCase() === "currentcolor" ? ctx.currentColor : fill;
      }
      return color;
    }

    /** Where each variant paints: the tone the field is recoloured to, and the surface the knocked-out figure shows. */
    function expectedTones(role: (typeof IDENTITY_VARIANT_ROLES)[number]): { field: string; figure: string } | undefined {
      switch (role) {
        case "primary":
        case "mark":
          return undefined; // the supplied SVG, unchanged
        case "light":
          return { field: TOKENS.ink, figure: TOKENS.surfaceBase };
        case "dark":
          return { field: TOKENS.onInverse, figure: TOKENS.surfaceInverse };
        case "mono":
        case "favicon":
          return { field: TOKENS.ink, figure: TOKENS.surfaceBase };
        case "appIcon":
          return { field: TOKENS.onAccent, figure: TOKENS.accent };
      }
    }

    const contextFor = (role: (typeof IDENTITY_VARIANT_ROLES)[number]): { surface: string; currentColor: string } =>
      role === "dark" ? { surface: TOKENS.surfaceInverse, currentColor: TOKENS.onInverse } : { surface: TOKENS.surfaceBase, currentColor: TOKENS.ink };

    describe.each([
      ["flat two-tone mark", FLAT_SVG],
      ["two-tone mark inside a transform group", GROUPED_SVG],
    ])("%s", (_name, svg) => {
      const direction = adoptSuppliedMark({ brand: { name: "Acme" }, suppliedSvg: svg, tokens: TOKENS });

      it("covers all seven variant roles", () => {
        expect(IDENTITY_VARIANT_ROLES).toHaveLength(7);
        for (const role of IDENTITY_VARIANT_ROLES) expect(Object.keys(direction.variants)).toContain(role);
      });

      it.each(IDENTITY_VARIANT_ROLES)("%s variant keeps the field/figure contrast at or above the non-text floor", (role) => {
        const ctx = contextFor(role);
        const variant = direction.variants[role];
        const field = renderedColorAt(variant, FIELD, ctx);
        const figure = renderedColorAt(variant, FIGURE, ctx);
        const ratio = contrastRatio(field, figure);
        expect(ratio, `${role}: field ${field} vs figure ${figure} has contrast ${ratio.toFixed(2)}, below ${IDENTITY_MIN_CONTRAST}`).toBeGreaterThanOrEqual(IDENTITY_MIN_CONTRAST);
      });

      it.each(IDENTITY_VARIANT_ROLES)("%s variant is recoloured onto its token colour, not left in the supplied tones", (role) => {
        const expected = expectedTones(role);
        if (expected === undefined) return;
        const ctx = contextFor(role);
        const variant = direction.variants[role];
        expect(renderedColorAt(variant, FIELD, ctx)).toBe(expected.field);
        expect(renderedColorAt(variant, FIGURE, ctx)).toBe(expected.figure);
      });

      it("the mono and favicon variants paint through currentColor alone", () => {
        expect(checkSingleColourLegibility(direction.variants.mono).ok).toBe(true);
        expect(checkSingleColourLegibility(direction.variants.favicon).ok).toBe(true);
      });
    });

    it("adoptSuppliedMark on a mark outside the subset returns the flat variants of the previous release", () => {
      const svg = doc(`<g fill="#1a1a1a"><rect width="48" height="48" /></g>${FIGURE_PATH}`);
      const { variants } = adoptSuppliedMark({ brand: { name: "Acme" }, suppliedSvg: svg, tokens: TOKENS });
      expect(variants.mono).toBe(mainRecolorSvg(svg, "currentColor"));
      expect(variants.light).toBe(mainRecolorSvg(svg, TOKENS.ink));
      expect(variants.dark).toBe(mainRecolorSvg(svg, TOKENS.onInverse));
      expect(variants.favicon).toBe(mainRecolorSvg(svg, "currentColor"));
    });
  });
});
