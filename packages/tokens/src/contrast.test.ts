import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { parseRootDeclarations, parseDeclarationsForSelector } from "./internal/parse-css.js";
import { contrastRatio } from "./internal/color.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokensCss = readFileSync(join(packageRoot, "styles", "tokens.css"), "utf8");

const light = parseRootDeclarations(tokensCss);
const dark = parseDeclarationsForSelector(tokensCss, ':root[data-theme="dark"]');

function value(map: Map<string, string>, name: string): string {
  const v = map.get(name);
  if (v === undefined) throw new Error(`contrast.test: no declaration found for ${name}`);
  return v;
}

/**
 * AA (WCAG 2.x, normal text): 4.5:1. AA-large (18px+, or 14px+ bold —
 * "large/secondary text" in the task this test was written for): 3:1.
 */
const AA = 4.5;
const AA_LARGE = 3.0;

interface Theme {
  readonly name: string;
  readonly surfaceBase: string;
  readonly surfaceRaised: string;
  readonly surfaceSunken: string;
  readonly surfaceInverse: string;
  readonly inkPrimary: string;
  readonly inkSecondary: string;
  readonly inkMuted: string;
  readonly inkLink: string;
  readonly inkOnInverse: string;
  /**
   * `--color-ink-on-accent` is a `var(--color-ink-on-inverse, ...)` ALIAS
   * (see tokens.css) with no declaration of its own in either dark block —
   * by design (see tokens.css's and tokens.ts's header comments). Its
   * resolved value in both themes is exactly `inkOnInverse`'s, which is
   * what a real cascade would compute; using `inkOnInverse` directly here
   * is that resolution, not a shortcut around it.
   */
  readonly accent: string;
  readonly successText: string;
  readonly successTint: string;
  readonly warningText: string;
  readonly warningTint: string;
  readonly dangerText: string;
  readonly dangerTint: string;
  readonly infoText: string;
  readonly infoTint: string;
}

function themeFrom(map: Map<string, string>, name: string): Theme {
  return {
    name,
    surfaceBase: value(map, "--color-surface-base"),
    surfaceRaised: value(map, "--color-surface-raised"),
    surfaceSunken: value(map, "--color-surface-sunken"),
    surfaceInverse: value(map, "--color-surface-inverse"),
    inkPrimary: value(map, "--color-ink-primary"),
    inkSecondary: value(map, "--color-ink-secondary"),
    inkMuted: value(map, "--color-ink-muted"),
    inkLink: value(map, "--color-ink-link"),
    inkOnInverse: value(map, "--color-ink-on-inverse"),
    accent: value(map, "--color-accent"),
    successText: value(map, "--color-status-success-text"),
    successTint: value(map, "--color-status-success-tint"),
    warningText: value(map, "--color-status-warning-text"),
    warningTint: value(map, "--color-status-warning-tint"),
    dangerText: value(map, "--color-status-danger-text"),
    dangerTint: value(map, "--color-status-danger-tint"),
    infoText: value(map, "--color-status-info-text"),
    infoTint: value(map, "--color-status-info-tint"),
  };
}

const THEMES: readonly Theme[] = [themeFrom(light, "light"), themeFrom(dark, "dark")];

describe.each(THEMES)("contrast — $name theme", (theme) => {
  describe("ink-primary (body text) on every surface: AA", () => {
    it.each([
      ["surface-base", theme.surfaceBase],
      ["surface-raised", theme.surfaceRaised],
      ["surface-sunken", theme.surfaceSunken],
    ])("ink-primary / %s", (_label, surface) => {
      expect(contrastRatio(theme.inkPrimary, surface)).toBeGreaterThanOrEqual(AA);
    });
  });

  describe("ink-secondary (large/secondary text) on every surface: AA-large", () => {
    it.each([
      ["surface-base", theme.surfaceBase],
      ["surface-raised", theme.surfaceRaised],
      ["surface-sunken", theme.surfaceSunken],
    ])("ink-secondary / %s", (_label, surface) => {
      expect(contrastRatio(theme.inkSecondary, surface)).toBeGreaterThanOrEqual(AA_LARGE);
    });
  });

  describe("ink-muted (large/secondary text) on every surface: AA-large", () => {
    it.each([
      ["surface-raised", theme.surfaceRaised],
      ["surface-sunken", theme.surfaceSunken],
    ])("ink-muted / %s", (_label, surface) => {
      expect(contrastRatio(theme.inkMuted, surface)).toBeGreaterThanOrEqual(AA_LARGE);
    });

    // ink-muted's own doc comment in tokens.css promises AA (not just
    // AA-large) specifically against surface-base — preserved here as its
    // own assertion so a future edit that only checks the general 3:1
    // sweep above can't silently relax that stronger promise.
    it("ink-muted / surface-base meets full AA, not just AA-large", () => {
      expect(contrastRatio(theme.inkMuted, theme.surfaceBase)).toBeGreaterThanOrEqual(AA);
    });
  });

  it("ink-link / surface-base: AA (a link is inline body text)", () => {
    expect(contrastRatio(theme.inkLink, theme.surfaceBase)).toBeGreaterThanOrEqual(AA);
  });

  it("ink-on-accent / accent: AA (a button label)", () => {
    expect(contrastRatio(theme.inkOnInverse, theme.accent)).toBeGreaterThanOrEqual(AA);
  });

  it("ink-on-inverse / surface-inverse: AA (primary reading text on the inverse plate)", () => {
    expect(contrastRatio(theme.inkOnInverse, theme.surfaceInverse)).toBeGreaterThanOrEqual(AA);
  });

  describe("status -text on its own -tint (composited over surface-base): AA", () => {
    it.each([
      ["success", () => [theme.successText, theme.successTint] as const],
      ["warning", () => [theme.warningText, theme.warningTint] as const],
      ["danger", () => [theme.dangerText, theme.dangerTint] as const],
      ["info", () => [theme.infoText, theme.infoTint] as const],
    ])("%s-text / %s-tint", (_status, pair) => {
      const [text, tint] = pair();
      expect(contrastRatio(text, tint, theme.surfaceBase)).toBeGreaterThanOrEqual(AA);
    });
  });
});

/**
 * A regression guard for the two light-mode values this package changed
 * while building this test (see CHANGELOG.md): both previously failed the
 * exact assertions above (`--color-ink-muted` at 4.17:1 against
 * `--color-surface-base`, `--color-status-info-text` at 3.91:1 against its
 * tint) before being darkened to the minimum change that clears AA. Pinned
 * here so a future edit that regresses either value fails with a message
 * that names the historical defect, not just a bare number.
 */
describe("light-mode contrast fixes (see CHANGELOG.md)", () => {
  it("--color-ink-muted clears AA against --color-surface-base (was 4.17:1)", () => {
    const ratio = contrastRatio(value(light, "--color-ink-muted"), value(light, "--color-surface-base"));
    expect(ratio).toBeGreaterThanOrEqual(AA);
  });

  it("--color-status-info-text clears AA against --color-status-info-tint (was 3.91:1)", () => {
    const ratio = contrastRatio(
      value(light, "--color-status-info-text"),
      value(light, "--color-status-info-tint"),
      value(light, "--color-surface-base"),
    );
    expect(ratio).toBeGreaterThanOrEqual(AA);
  });
});
