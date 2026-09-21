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

/**
 * Closed selector needles for each required utility. Tailwind v4 writes `:`
 * as `\:` in the stylesheet. These strings are literals, not derived from
 * caller input — a replace-based escape of `utility` is the exact shape
 * CodeQL `js/bad-code-sanitization` refuses (backslash not escaped first).
 */
const UTILITY_RULE_NEEDLES: Record<HeroCssRequiredUtility, readonly [string, string]> = {
  "text-display-l": [".text-display-l {", ".text-display-l{"],
  "font-display": [".font-display {", ".font-display{"],
  "bg-accent": [".bg-accent {", ".bg-accent{"],
  "rounded-control": [".rounded-control {", ".rounded-control{"],
  "tablet:grid-cols-2": [".tablet\\:grid-cols-2 {", ".tablet\\:grid-cols-2{"],
};

/** True when `css` contains a rule for that required utility. */
export function utilityRulePresent(css: string, utility: HeroCssRequiredUtility): boolean {
  const [spaced, compact] = UTILITY_RULE_NEEDLES[utility];
  return css.includes(spaced) || css.includes(compact);
}

export function checkHeroCss(css: string): HeroCssResult {
  const findings: HeroCssFinding[] = [];
  for (const utility of HERO_BUTTON_REQUIRED_UTILITIES) {
    if (!utilityRulePresent(css, utility)) {
      findings.push({
        rule: "missing-utility",
        utility,
        message: `No ${UTILITY_RULE_NEEDLES[utility][0].trimEnd()} rule found — Hero/Button will render as unstyled HTML.`,
      });
    }
  }
  return {
    utilitiesChecked: HERO_BUTTON_REQUIRED_UTILITIES.length,
    findings,
  };
}
