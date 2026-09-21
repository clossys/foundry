/**
 * `checkHeroCss` — verifies a built Tailwind stylesheet actually contains the
 * utility rules `Hero` and primary `Button` depend on. A consumer can import
 * `theme.css` and still render unstyled blocks when `@source` never scanned
 * this package — this gate answers that question from the CSS file alone.
 *
 * Pure, no I/O: pass the stylesheet text (or grep a path in the CLI).
 */

/** Class names `Hero` and primary `Button` emit — see `src/blocks/Hero.tsx` and `src/atoms/Button.tsx`. */
export const HERO_BUTTON_REQUIRED_UTILITIES = [
  "text-display-l",
  "font-display",
  "bg-accent",
  "rounded-control",
  "tablet:grid-cols-2",
] as const;

export type HeroCssRequiredUtility = (typeof HERO_BUTTON_REQUIRED_UTILITIES)[number];

export interface HeroCssFinding {
  rule: "missing-utility";
  utility: HeroCssRequiredUtility;
  message: string;
}

export interface HeroCssResult {
  utilitiesChecked: number;
  findings: HeroCssFinding[];
}

/** True when `css` contains a rule for `.utility` (Tailwind v4 writes `:` as `\:` in selectors). */
export function utilityRulePresent(css: string, utility: string): boolean {
  const selector = `.${utility.replace(/:/g, "\\:")}`;
  return css.includes(`${selector} {`) || css.includes(`${selector}{`);
}

export function checkHeroCss(css: string): HeroCssResult {
  const findings: HeroCssFinding[] = [];
  for (const utility of HERO_BUTTON_REQUIRED_UTILITIES) {
    if (!utilityRulePresent(css, utility)) {
      findings.push({
        rule: "missing-utility",
        utility,
        message: `No .${utility.replace(/:/g, "\\:")} rule found — Hero/Button will render as unstyled HTML.`,
      });
    }
  }
  return {
    utilitiesChecked: HERO_BUTTON_REQUIRED_UTILITIES.length,
    findings,
  };
}
