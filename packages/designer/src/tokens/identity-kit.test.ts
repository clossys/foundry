import { describe, expect, it } from "vitest";
import {
  adoptSuppliedMark,
  deriveInitials,
  generateIdentityDirections,
  IdentityKitValidationError,
  recolorSvg,
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
});

describe("recolorSvg", () => {
  it("replaces fill and stroke attribute values, leaving none/transparent untouched", () => {
    const svg = '<svg><path fill="#fff" stroke="none" /><rect fill="none" stroke="#000" /></svg>';
    expect(recolorSvg(svg, "red")).toBe('<svg><path fill="red" stroke="none" /><rect fill="none" stroke="red" /></svg>');
  });
});

describe("adoptSuppliedMark", () => {
  const suppliedSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#112233" d="M0 0h24v24H0z" /></svg>';

  it("throws IdentityKitValidationError for a non-svg document", () => {
    expect(() => adoptSuppliedMark({ brand: { name: "Acme" }, suppliedSvg: "<div>not svg</div>", tokens: TOKENS })).toThrow(IdentityKitValidationError);
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
});
