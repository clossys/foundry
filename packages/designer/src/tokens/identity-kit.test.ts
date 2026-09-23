import { describe, expect, it } from "vitest";
import {
  adoptSuppliedMark,
  deriveInitials,
  generateIdentityDirections,
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
