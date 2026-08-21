import { describe, expect, it } from "vitest";
import { TOKENS } from "@vespeneventures/designer/tokens";
import { ELEMENT_KINDS } from "../core/index.js";
import { RenderError } from "./errors.js";
import { flattenTokens } from "./tokens.js";
import {
  ELEMENT_FONT_FAMILY_ROLE,
  ELEMENT_TYPOGRAPHY_ROLE,
  resolveElementFontFamily,
  resolveElementTypography,
} from "./typography.js";

// ─────────────────────────────────────────────────────────────────────────
// THE WHOLE POINT: the mapping cannot rot silently when a token is renamed
// ─────────────────────────────────────────────────────────────────────────

describe("ELEMENT_TYPOGRAPHY_ROLE — every entry names a real, live text-size token", () => {
  it("every ElementKind has an entry, and every entry is a real TOKENS key of family \"text\"", () => {
    for (const kind of ELEMENT_KINDS) {
      const role = ELEMENT_TYPOGRAPHY_ROLE[kind];
      expect(role, `ELEMENT_TYPOGRAPHY_ROLE has no entry for ElementKind "${kind}"`).toBeDefined();
      expect(
        Object.prototype.hasOwnProperty.call(TOKENS, role),
        `ELEMENT_TYPOGRAPHY_ROLE["${kind}"] = "${role}", which does not exist in @vespeneventures/designer/tokens' TOKENS registry`,
      ).toBe(true);
      expect(
        TOKENS[role]?.family,
        `ELEMENT_TYPOGRAPHY_ROLE["${kind}"] = "${role}" exists but is not a "text" family token (got family "${TOKENS[role]?.family}")`,
      ).toBe("text");
    }
  });

  it("every value also resolves through the real flattened token map to a literal <number>px value", () => {
    const flat = flattenTokens();
    for (const kind of ELEMENT_KINDS) {
      const role = ELEMENT_TYPOGRAPHY_ROLE[kind];
      expect(flat.get(role)).toMatch(/^\d+(\.\d+)?px$/);
    }
  });
});

describe("ELEMENT_FONT_FAMILY_ROLE — every entry names a real, live font-family token", () => {
  it("every ElementKind has an entry, and every entry is a real TOKENS key of family \"font\"", () => {
    for (const kind of ELEMENT_KINDS) {
      const role = ELEMENT_FONT_FAMILY_ROLE[kind];
      expect(role, `ELEMENT_FONT_FAMILY_ROLE has no entry for ElementKind "${kind}"`).toBeDefined();
      expect(
        Object.prototype.hasOwnProperty.call(TOKENS, role),
        `ELEMENT_FONT_FAMILY_ROLE["${kind}"] = "${role}", which does not exist in @vespeneventures/designer/tokens' TOKENS registry`,
      ).toBe(true);
      expect(TOKENS[role]?.family).toBe("font");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PROOF this test actually can fail — see this package's own PR
// description for the same demonstration run manually against a
// deliberately-broken mapping entry and reverted; kept here only as the
// permanent, always-run guardrail.
// ─────────────────────────────────────────────────────────────────────────

describe("resolveElementTypography — default resolution", () => {
  it("resolves an ElementKind's default role to a real {role, css, px}", () => {
    const flat = flattenTokens();
    const result = resolveElementTypography("heading", undefined, 'slot "headline"', flat);
    expect(result.role).toBe("--text-h1");
    expect(result.css).toBe("28px");
    expect(result.px).toBe(28);
  });

  it("every ElementKind default resolves without throwing", () => {
    const flat = flattenTokens();
    for (const kind of ELEMENT_KINDS) {
      expect(() => resolveElementTypography(kind, undefined, `slot of kind "${kind}"`, flat)).not.toThrow();
    }
  });
});

describe("resolveElementTypography — StyleBinding.typography overrides the ElementKind default", () => {
  it("a real override role wins over the element's own default", () => {
    const flat = flattenTokens();
    const result = resolveElementTypography("body", { typography: "--text-display-xl" }, 'slot "hero"', flat);
    expect(result.role).toBe("--text-display-xl");
    expect(result.css).toBe("72px");
    expect(result.px).toBe(72);
  });

  it("an unknown override role throws RenderError(\"unknown-style-role\"), never a silent fallback to the default size", () => {
    const flat = flattenTokens();
    let thrown: unknown;
    try {
      resolveElementTypography("body", { typography: "--not-a-real-token" }, 'slot "hero"', flat);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as RenderError).reason).toBe("unknown-style-role");
  });

  it("a real token role that is not a pixel size (e.g. a color role) also throws \"unknown-style-role\", not a plausible-looking wrong size", () => {
    const flat = flattenTokens();
    let thrown: unknown;
    try {
      resolveElementTypography("body", { typography: "--color-accent" }, 'slot "hero"', flat);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RenderError);
    expect((thrown as RenderError).reason).toBe("unknown-style-role");
  });

  it("style.typography === undefined falls back to the ElementKind default, not an error", () => {
    const flat = flattenTokens();
    const result = resolveElementTypography("stat", {}, 'slot "big-number"', flat);
    expect(result.role).toBe("--text-display-m");
  });
});

describe("resolveElementFontFamily", () => {
  it("resolves every ElementKind to a real, non-empty font-family literal with no oklch()/var() left", () => {
    const flat = flattenTokens();
    for (const kind of ELEMENT_KINDS) {
      const family = resolveElementFontFamily(kind, flat);
      expect(family.length).toBeGreaterThan(0);
      expect(family).not.toMatch(/oklch\(/i);
      expect(family).not.toMatch(/var\(--/);
    }
  });

  it("heading/subheading/stat/logo resolve to --font-display; everything else to --font-body", () => {
    const flat = flattenTokens();
    const display = flat.get("--font-display")!;
    const body = flat.get("--font-body")!;
    expect(resolveElementFontFamily("heading", flat)).toBe(display);
    expect(resolveElementFontFamily("subheading", flat)).toBe(display);
    expect(resolveElementFontFamily("stat", flat)).toBe(display);
    expect(resolveElementFontFamily("logo", flat)).toBe(display);
    expect(resolveElementFontFamily("body", flat)).toBe(body);
    expect(resolveElementFontFamily("button", flat)).toBe(body);
  });
});
