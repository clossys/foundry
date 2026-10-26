import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDeclarationsForSelector, parseRootDeclarations } from "./internal/parse-css.js";
import { contrastRatio, luminanceOf, oklchToLinearSRGB, parseOklch } from "./color.js";

/*
 * Visual pass (VF-1) pins for the colour pairs whose values or bindings it
 * changed, in both themes: the dark muted ink moved up one neutral ramp step
 * (0.66 -> 0.7763, `--color-neutral-300`) so it reads at APCA Lc 60 or more
 * on the dark page and raised surfaces while keeping WCAG AA; the dark
 * surfaces keep a strict sunken < base < raised order with no pure-black
 * well; and the translucent tonal hover that ghost, secondary and icon-only
 * controls now use lifts toward the ink (lighter on a dark ground).
 */
const tokensCss = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "styles", "tokens.css"), "utf8");
const light = parseRootDeclarations(tokensCss);
const darkMedia = parseDeclarationsForSelector(tokensCss, ':root:not([data-theme="light"])');
const darkExplicit = parseDeclarationsForSelector(tokensCss, ':root[data-theme="dark"]');
const themes = { light, "dark (media)": darkMedia, "dark (explicit)": darkExplicit } as const;

function value(theme: Map<string, string>, property: string): string {
  const raw = theme.get(property);
  if (raw === undefined) throw new Error(`${property} is not declared`);
  return raw;
}

/** APCA-W3 0.0.98G lightness contrast (Lc) of text on a background, both opaque oklch values. */
function apcaLc(text: string, background: string): number {
  const y = (color: string): number => {
    const encoded = oklchToLinearSRGB(parseOklch(color)).map((c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
    const [r, g, b] = encoded.map((c) => c ** 2.4) as [number, number, number];
    const raw = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
    return raw > 0.022 ? raw : raw + (0.022 - raw) ** 1.414;
  };
  const yt = y(text), yb = y(background);
  if (Math.abs(yb - yt) < 0.0005) return 0;
  const sapc = yb > yt ? (yb ** 0.56 - yt ** 0.57) * 1.14 : (yb ** 0.65 - yt ** 0.62) * 1.14;
  if (Math.abs(sapc) < 0.1) return 0;
  return (sapc > 0 ? sapc - 0.027 : sapc + 0.027) * 100;
}

describe("visual pass: muted ink", () => {
  for (const [name, theme] of Object.entries(themes)) {
    // Light is unchanged by this pass and pinned on its contracted grounds;
    // dark, whose value changed, is checked on every surface it can sit on.
    const surfaces = name === "light" ? ["--color-surface-base", "--color-surface-raised"] : ["--color-surface-base", "--color-surface-sunken", "--color-surface-raised", "--color-surface-aside"];
    for (const surface of surfaces) {
      it(`${name}: --color-ink-muted holds WCAG AA (4.5:1) on ${surface}`, () => {
        expect(contrastRatio(value(theme, "--color-ink-muted"), value(theme, surface))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  for (const [name, theme] of [["dark (media)", darkMedia], ["dark (explicit)", darkExplicit]] as const) {
    it(`${name}: --color-ink-muted reaches APCA Lc 60 on the page and raised surfaces`, () => {
      for (const surface of ["--color-surface-base", "--color-surface-raised"]) {
        expect(Math.abs(apcaLc(value(theme, "--color-ink-muted"), value(theme, surface))), surface).toBeGreaterThanOrEqual(60);
      }
    });

    it(`${name}: --color-ink-muted is the neutral-300 ramp step and stays below secondary ink`, () => {
      expect(value(theme, "--color-ink-muted")).toBe(value(light, "--color-neutral-300"));
      expect(parseOklch(value(theme, "--color-ink-muted")).L).toBeLessThan(parseOklch(value(theme, "--color-ink-secondary")).L);
    });
  }

  it("the APCA helper reproduces the published reference pair (#888 on #fff is Lc 63.1)", () => {
    expect(apcaLc("oklch(0.6268 0 0)", "oklch(1 0 0)")).toBeCloseTo(63.1, 0);
  });
});

describe("visual pass: dark surface order and hover step", () => {
  for (const [name, theme] of [["dark (media)", darkMedia], ["dark (explicit)", darkExplicit]] as const) {
    it(`${name}: sunken < base < raised, and the sunken well is not pure black`, () => {
      const l = (property: string) => parseOklch(value(theme, property)).L;
      expect(l("--color-surface-sunken")).toBeGreaterThan(0);
      expect(l("--color-surface-sunken")).toBeLessThan(l("--color-surface-base"));
      expect(l("--color-surface-base")).toBeLessThan(l("--color-surface-raised"));
    });

    it(`${name}: the tonal hover is lighter than the surface it sits on`, () => {
      for (const surface of ["--color-surface-base", "--color-surface-raised"]) {
        const ground = value(theme, surface);
        expect(luminanceOf(value(theme, "--color-control-tonal-hover"), ground), surface).toBeGreaterThan(luminanceOf(ground));
      }
    });
  }

  it("light: the tonal hover is a visible step on the page and raised surfaces", () => {
    for (const surface of ["--color-surface-base", "--color-surface-raised"]) {
      const ground = value(light, surface);
      expect(luminanceOf(value(light, "--color-control-tonal-hover"), ground), surface).toBeLessThan(luminanceOf(ground));
    }
  });
});

/*
 * VF-8: `--color-line-control` is the resting boundary of a form control or
 * outlined button. WCAG 1.4.11 asks 3:1 for a boundary needed to identify the
 * control, so it is pinned against every surface a control sits on (page,
 * sunken well, raised panel, right rail) in both themes. `--color-line-base`
 * stays a decorative hairline with its value unchanged.
 */
describe("visual pass: control boundary line (VF-8)", () => {
  const CONTROL_SURFACES = ["--color-surface-base", "--color-surface-sunken", "--color-surface-raised", "--color-surface-aside"];
  for (const [name, theme] of Object.entries(themes)) {
    it(`${name}: --color-line-control clears 3:1 (WCAG 1.4.11) on every control surface`, () => {
      const ratios = CONTROL_SURFACES.map((surface) => contrastRatio(value(theme, "--color-line-control"), value(theme, surface)));
      expect(Math.min(...ratios)).toBeGreaterThanOrEqual(3);
    });

    it(`${name}: --color-line-control stays the lightest-weight line that clears 3:1 (within 0.15 of the floor)`, () => {
      const ratios = CONTROL_SURFACES.map((surface) => contrastRatio(value(theme, "--color-line-control"), value(theme, surface)));
      expect(Math.min(...ratios)).toBeLessThan(3.15);
    });
  }

  it("--color-line-base stays the decorative hairline it was (light 0.8761, dark 0.30)", () => {
    expect(value(light, "--color-line-base")).toBe("oklch(0.8761 0 0)");
    expect(value(darkMedia, "--color-line-base")).toBe("oklch(0.30 0 0)");
    expect(value(darkExplicit, "--color-line-base")).toBe("oklch(0.30 0 0)");
  });
});
