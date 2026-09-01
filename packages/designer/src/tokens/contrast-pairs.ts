/**
 * `CONTRAST_PAIRS` — this package's checked-in WCAG contrast policy: an
 * EXPLICIT list of (foreground, background[, composited-over]) token pairs
 * and the minimum ratio each must clear, ratified from
 * `contrast.test.ts`'s own hand-curated pair map rather than re-derived.
 *
 * WHY A CHECKED-IN LIST, NOT NAMING-DRIVEN DERIVATION — an earlier design
 * for this gate assumed it could auto-derive one pair per
 * `--<role>-on-<ground>`-shaped token name. Counted directly against
 * `tokens.ts`'s real 154 entries (every property containing an `-on-`
 * segment at all): **5 of 154** actually follow that pattern, where
 * `<ground>` names a real, distinct role with no further suffix —
 * `--color-ink-on-accent`, `--color-ink-on-inverse`, `--color-accent-on-
 * inverse`, `--color-line-on-inverse`, `--ui-ring-on-inverse`. A 6th
 * property, `--color-ink-on-inverse-muted`, also contains `-on-` but is a
 * MUTED VARIANT of `--color-ink-on-inverse` rather than a distinct
 * role-on-ground pairing — there is no `--color-surface-inverse-muted`
 * ground for it to name, so its trailing `-muted` modifies the ROLE, not
 * the ground; excluded from the strict count above for that reason, and
 * called out here rather than silently rounded into either bucket. 5 (or,
 * generously, 6) of 154 is nowhere close to universal. The pairs that
 * actually matter for reading this package's own UI — body text on the
 * page ground, status text on its own tint, a categorical chart mark on
 * the chart surface — are not spelled out in any token NAME at all;
 * knowing `--color-ink-primary` is meant to sit on `--color-surface-base`
 * (among others) requires the same domain knowledge `contrast.test.ts`
 * already encodes by hand. A gate built on name-derivation would have checked
 * almost nothing while reading, at a glance, as though it checked
 * everything. This file is the fix: the pairs below are lifted directly
 * from `contrast.test.ts`'s real assertions (see each entry's own
 * `description` for the corresponding `it(...)` this mirrors), ratified as
 * GATE POLICY a CI run can enforce mechanically, not just a test a human
 * has to remember to keep in sync by hand.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY NOT HERE — decorative roles, excluded per WCAG
 * 1.4.11 (Non-text Contrast)
 * ============================================================================
 *
 * WCAG 1.4.11 scopes "non-text contrast" to graphical objects and UI
 * components REQUIRED to understand content or operate the interface — and
 * separately excludes anything "that is essential to the information being
 * conveyed" losing its exemption, but also excludes purely decorative
 * elements with no informational value of their own. Applying that scope
 * test to this package's own token families, the following are
 * deliberately NOT contrast pairs here:
 *
 *   - `--color-line-base` / `--color-line-strong` / `--color-line-on-
 *     inverse` (hairlines, dividers) — a divider communicates visual
 *     separation, not information; removing it changes layout aesthetics,
 *     never comprehension. No 1.4.11 obligation attaches to a hairline.
 *   - `--color-chart-grid` — a gridline is a supplementary reading aid,
 *     not itself required to read a chart's data (the marks, the axis,
 *     and the axis labels are — all three ARE checked below). This
 *     package's own `chart-vars.ts`/README already document gridlines as
 *     deliberately recessive, "visible but quiet"; `contrast.test.ts`
 *     encodes that as a design invariant (a comparison against
 *     `--color-chart-axis`, and a "stays under AA-large" band), which is
 *     a different SHAPE of check than this gate's threshold-pair model
 *     and stays in that test file rather than being force-fit here.
 *   - `--color-overlay-scrim` — the dimming backdrop behind a modal/
 *     popover carries no information of its own; it is pure visual
 *     emphasis for the content it sits behind.
 *   - `--ui-elevation-none` / `-raised` / `-floating` — shadows are a
 *     depth cue, not content.
 *   - `--color-skeleton-fill` — a loading placeholder's shimmer; by
 *     definition nothing is there yet to read.
 *   - `--ui-ring-focus` / `--ui-ring-on-inverse` — each is a COMPOSITE
 *     `box-shadow`-shaped value (`"0 0 0 2px var(--color-accent, ...)"`),
 *     not a bare parseable color `color.ts` can score on its own (see
 *     `internal/resolve-token-value.ts`'s "WHAT COUNTS AS A WHOLE-VALUE
 *     ALIAS" for why this walker does not reach into a value like that).
 *     A focus indicator's own WCAG obligation is SC 2.4.13 (Focus
 *     Appearance), a different success criterion than the text/graphical-
 *     object contrast this gate checks — genuinely out of scope, not
 *     merely inconvenient to parse.
 *
 * ============================================================================
 * EXCEPTIONS — WCAG 1.4.11's OWN relief, carried as DATA, never a bare
 * comment
 * ============================================================================
 *
 * Some graphical objects legitimately sit under their nominal floor and
 * are still WCAG-compliant, because 1.4.11 permits relief when a
 * compensating mechanism means color is never the only channel carrying
 * the information. `contrast.test.ts`'s `WARN_SLOTS_BY_THEME` already
 * encodes exactly this for this package's own categorical chart palette —
 * light-mode slots 3/4/5 sit under the 3:1 floor on purpose, legal only
 * because `ChartFrame` ships a mandatory direct label/legend and a
 * table-view fallback for every chart, so color is never load-bearing on
 * its own. `contrastPairsForTheme` (below) ports that SAME map — same
 * theme keys, same slot numbers — as gate policy: a `ContrastPair` may
 * carry an `exception: ContrastException`, and `checkTokenContrast`
 * (`contrast-gate.ts`) treats an excepted pair specially in BOTH
 * directions, which is what keeps this from becoming a rubber stamp:
 *
 *   - Still under the floor -> legitimate, documented relief. Reported as
 *     `relieved`, not `findings` — visible in every report, never hidden,
 *     but not a failure.
 *   - Now CLEARS the floor -> a STALE exception. The relief this pair
 *     claims is no longer needed, and a stale claim left in place is
 *     exactly how an exception silently outlives the condition that
 *     justified it — nobody would ever notice to remove it. Reported as
 *     a real finding (`"stale-exception"`), same as any other threshold
 *     problem.
 *   - `exception` present but missing/blank ANY of its three required
 *     fields -> ALSO a real finding (`"invalid-exception"`), regardless
 *     of the measured ratio. An exception mechanism that accepts
 *     unjustified entries is indistinguishable from no mechanism at all —
 *     see `ContrastException`'s own fields for what "justified" requires.
 *
 * ============================================================================
 * HOW A CONSUMER ADDS A PAIR
 * ============================================================================
 *
 * Push a `ContrastPair` onto this array (or, for a consumer's OWN token
 * registry rather than this package's, build an equivalent array and pass
 * it to `checkTokenContrast` directly — see that function's own doc
 * comment for its full signature): name the two token properties, the
 * WCAG level, and — only when either color carries alpha < 1, like this
 * package's own status `-tint` family — the token to composite over
 * (`compositeOver`). `checkTokenContrast` resolves every property through
 * `resolveTokenValue` (so an alias like `--color-chart-surface` or
 * `--color-ink-on-accent` needs no manual "what does this actually point
 * at" step) and reports a named finding — never a silent skip — for a
 * property missing from the registry, an alias cycle, an unparseable
 * color value, or a ratio below `minimumRatio` with no (or an invalid)
 * exception. Add an `exception` only with a real WCAG clause, a real
 * compensating mechanism, and a real rationale — see "EXCEPTIONS" above.
 */

export type ContrastLevel = "AA" | "AA-large";

/** WCAG 2.x normal-text minimum (4.5:1). */
export const AA = 4.5;
/** WCAG 2.x large-text (18px+, or 14px+ bold) / graphical-object minimum (3:1). */
export const AA_LARGE = 3.0;

/**
 * The justification an excepted pair MUST carry, as data — never a bare
 * comment a reader has to trust without a place for a machine to check
 * it. `checkTokenContrast` requires all three fields non-blank before it
 * will treat a below-threshold ratio as relieved; missing any one is
 * itself a finding (`"invalid-exception"`) — see `contrast-pairs.ts`'s
 * own header, "EXCEPTIONS".
 */
export interface ContrastException {
  /** The WCAG success criterion this relief relies on, e.g. `"WCAG 2.2 SC 1.4.11 (Non-text Contrast)"`. */
  readonly wcagClause: string;
  /** What makes the relief legal — the mechanism that keeps color from being the only channel carrying the information. */
  readonly compensatingMechanism: string;
  /** Human-readable rationale for why THIS pair specifically qualifies. */
  readonly rationale: string;
}

export interface ContrastPair {
  /** Stable, human-readable id for a report — e.g. `"ink-primary/surface-base"`. */
  readonly id: string;
  /** The token whose resolved value is the foreground/text/mark color. */
  readonly foreground: string;
  /** The token whose resolved value is the background/surface it sits on. */
  readonly background: string;
  readonly level: ContrastLevel;
  /** The ratio `foreground`/`background` must meet or exceed. Usually `AA`/`AA_LARGE` verbatim. */
  readonly minimumRatio: number;
  /**
   * When set, both `foreground` and `background` are composited over THIS
   * token first (matching `color.ts`'s `contrastRatio`'s own third
   * argument) — required whenever either carries alpha < 1, e.g. this
   * package's status `-tint` family, which is always translucent.
   */
  readonly compositeOver?: string;
  /** Human-readable rationale, referencing the `contrast.test.ts` assertion this pair ratifies. */
  readonly description: string;
  /**
   * When set, a ratio below `minimumRatio` is legitimate, documented
   * relief (`relieved`) rather than a finding — but ONLY while the ratio
   * actually STAYS below `minimumRatio`. See this file's header,
   * "EXCEPTIONS", for the full contract, including why a pair that
   * clears its floor anyway while still carrying this field is a
   * (different) real finding, not a pass.
   */
  readonly exception?: ContrastException;
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  // ── ink-primary (body text) on every surface: AA ──────────────────────
  {
    id: "ink-primary/surface-base",
    foreground: "--color-ink-primary",
    background: "--color-surface-base",
    level: "AA",
    minimumRatio: AA,
    description: "Body text on the page ground. Mirrors contrast.test.ts's \"ink-primary / surface-base\".",
  },
  {
    id: "ink-primary/surface-raised",
    foreground: "--color-ink-primary",
    background: "--color-surface-raised",
    level: "AA",
    minimumRatio: AA,
    description: "Body text on a card/modal/popover surface. Mirrors contrast.test.ts's \"ink-primary / surface-raised\".",
  },
  {
    id: "ink-primary/surface-sunken",
    foreground: "--color-ink-primary",
    background: "--color-surface-sunken",
    level: "AA",
    minimumRatio: AA,
    description: "Body text on a well/input surface. Mirrors contrast.test.ts's \"ink-primary / surface-sunken\".",
  },

  // ── ink-secondary (large/secondary text) on every surface: AA-large ───
  {
    id: "ink-secondary/surface-base",
    foreground: "--color-ink-secondary",
    background: "--color-surface-base",
    level: "AA-large",
    minimumRatio: AA_LARGE,
    description: "Secondary/large text on the page ground. Mirrors contrast.test.ts's \"ink-secondary / surface-base\".",
  },
  {
    id: "ink-secondary/surface-raised",
    foreground: "--color-ink-secondary",
    background: "--color-surface-raised",
    level: "AA-large",
    minimumRatio: AA_LARGE,
    description: "Secondary/large text on a raised surface. Mirrors contrast.test.ts's \"ink-secondary / surface-raised\".",
  },
  {
    id: "ink-secondary/surface-sunken",
    foreground: "--color-ink-secondary",
    background: "--color-surface-sunken",
    level: "AA-large",
    minimumRatio: AA_LARGE,
    description: "Secondary/large text on a sunken surface. Mirrors contrast.test.ts's \"ink-secondary / surface-sunken\".",
  },

  // ── ink-muted: AA-large on raised/sunken, full AA on surface-base ─────
  {
    id: "ink-muted/surface-raised",
    foreground: "--color-ink-muted",
    background: "--color-surface-raised",
    level: "AA-large",
    minimumRatio: AA_LARGE,
    description: "Muted text on a raised surface. Mirrors contrast.test.ts's \"ink-muted / surface-raised\".",
  },
  {
    id: "ink-muted/surface-sunken",
    foreground: "--color-ink-muted",
    background: "--color-surface-sunken",
    level: "AA-large",
    minimumRatio: AA_LARGE,
    description: "Muted text on a sunken surface. Mirrors contrast.test.ts's \"ink-muted / surface-sunken\".",
  },
  {
    id: "ink-muted/surface-base",
    foreground: "--color-ink-muted",
    background: "--color-surface-base",
    level: "AA",
    minimumRatio: AA,
    description:
      "ink-muted's own doc comment in tokens.css promises full AA (not just AA-large) specifically against surface-base. Mirrors contrast.test.ts's \"ink-muted / surface-base meets full AA, not just AA-large\".",
  },

  // ── links, buttons, and the inverse plate ──────────────────────────────
  {
    id: "ink-link/surface-base",
    foreground: "--color-ink-link",
    background: "--color-surface-base",
    level: "AA",
    minimumRatio: AA,
    description: "A link is inline body text. Mirrors contrast.test.ts's \"ink-link / surface-base\".",
  },
  {
    id: "ink-on-accent/accent",
    foreground: "--color-ink-on-accent",
    background: "--color-accent",
    level: "AA",
    minimumRatio: AA,
    description:
      "A button label on the accent fill. --color-ink-on-accent is a var() alias of --color-ink-on-inverse, resolved by resolveTokenValue. Mirrors contrast.test.ts's \"ink-on-accent / accent\".",
  },
  {
    id: "ink-on-inverse/surface-inverse",
    foreground: "--color-ink-on-inverse",
    background: "--color-surface-inverse",
    level: "AA",
    minimumRatio: AA,
    description: "Primary reading text on the inverse plate. Mirrors contrast.test.ts's \"ink-on-inverse / surface-inverse\".",
  },
  {
    id: "ink-on-inverse-muted/surface-inverse",
    foreground: "--color-ink-on-inverse-muted",
    background: "--color-surface-inverse",
    level: "AA",
    minimumRatio: AA,
    description: "Secondary and muted site-block text on the inverse section ground.",
  },

  // ── status -text on its own -tint, composited over surface-base: AA ───
  {
    id: "status-success-text/status-success-tint",
    foreground: "--color-status-success-text",
    background: "--color-status-success-tint",
    compositeOver: "--color-surface-base",
    level: "AA",
    minimumRatio: AA,
    description: "A success banner/badge. -tint is translucent, composited over the page ground. Mirrors contrast.test.ts's \"success-text / success-tint\".",
  },
  {
    id: "status-warning-text/status-warning-tint",
    foreground: "--color-status-warning-text",
    background: "--color-status-warning-tint",
    compositeOver: "--color-surface-base",
    level: "AA",
    minimumRatio: AA,
    description: "A warning banner/badge. Mirrors contrast.test.ts's \"warning-text / warning-tint\".",
  },
  {
    id: "status-danger-text/status-danger-tint",
    foreground: "--color-status-danger-text",
    background: "--color-status-danger-tint",
    compositeOver: "--color-surface-base",
    level: "AA",
    minimumRatio: AA,
    description: "A danger banner/badge. Mirrors contrast.test.ts's \"danger-text / danger-tint\".",
  },
  {
    id: "status-info-text/status-info-tint",
    foreground: "--color-status-info-text",
    background: "--color-status-info-tint",
    compositeOver: "--color-surface-base",
    level: "AA",
    minimumRatio: AA,
    description: "An info banner/badge. Mirrors contrast.test.ts's \"info-text / info-tint\".",
  },

  // ── status dots on the page ground: WCAG non-text contrast ───────────
  {
    id: "status-success/surface-base",
    foreground: "--color-status-success",
    background: "--color-surface-base",
    level: "AA-large",
    minimumRatio: AA_LARGE,
    description: "A status-list available dot on the page ground; its adjacent state label uses ink-primary rather than this display token.",
  },
  {
    id: "status-warning/surface-base",
    foreground: "--color-status-warning",
    background: "--color-surface-base",
    level: "AA-large",
    minimumRatio: AA_LARGE,
    description: "A status-list partial dot on the page ground; its adjacent state label uses ink-primary rather than this display token.",
  },
  {
    id: "status-info/surface-base",
    foreground: "--color-status-info",
    background: "--color-surface-base",
    level: "AA-large",
    minimumRatio: AA_LARGE,
    description: "A status-list planned dot on the page ground; its adjacent state label uses ink-primary rather than this display token.",
  },

  // ── chart chrome: axis-label text on the chart surface: AA-large ──────
  {
    id: "chart-axis-label/chart-surface",
    foreground: "--color-chart-axis-label",
    background: "--color-chart-surface",
    level: "AA-large",
    minimumRatio: AA_LARGE,
    description:
      "Muted axis/tick text on a chart's own surface (--color-chart-surface aliases --color-surface-raised; --color-chart-axis-label aliases --color-ink-muted — both resolved by resolveTokenValue). Mirrors contrast.test.ts's \"chart-axis-label / chart-surface\".",
  },

  // ── categorical chart marks vs the chart surface: AA-large ────────────
  // Every one of the 8 fixed-order categorical marks is a graphical
  // object required to read a categorical chart's data — squarely inside
  // WCAG 1.4.11's scope, unlike the chrome excluded above. This BASELINE
  // array carries no `exception` on any slot — `contrastPairsForTheme`
  // below is what attaches the real, theme-scoped WARN-slot relief (see
  // this file's header, "EXCEPTIONS") to the matching slots for a given
  // theme, ported from contrast.test.ts's own `WARN_SLOTS_BY_THEME`.
  ...([1, 2, 3, 4, 5, 6, 7, 8] as const).map((n) => ({
    id: `chart-categorical-${n}/chart-surface`,
    foreground: `--color-chart-categorical-${n}`,
    background: "--color-chart-surface",
    level: "AA-large" as const,
    minimumRatio: AA_LARGE,
    description: `Categorical chart mark slot ${n} on the chart surface. Mirrors the per-slot sweep in contrast.test.ts's "every categorical slot either clears the 3:1 mark-contrast floor, or is a documented WARN slot".`,
  })),
];

/**
 * The compensating mechanism and WCAG clause behind this package's own
 * categorical-mark relief — ONE justification object, reused by every
 * slot/theme combination `CATEGORICAL_EXCEPTION_SLOTS_BY_THEME` names,
 * because the reason is the same reason in every case: this package's
 * chart layer never lets color carry a data channel alone.
 */
const CATEGORICAL_WARN_EXCEPTION: ContrastException = {
  wcagClause: "WCAG 2.2 SC 1.4.11 (Non-text Contrast)",
  compensatingMechanism:
    "This package's chart layer (ChartFrame, the container BarChart/LineChart/Sparkline all share) ships a mandatory direct label/legend AND a table-view fallback for every chart it renders — color is never the only channel carrying which series a mark belongs to, which is what 1.4.11's relief for a compensated graphical object requires.",
  rationale:
    "The dataviz skill's validate_palette.js PASS/WARN report (see this token family's introducing PR description) accepted these specific categorical steps below the 3:1 mark-contrast floor for exactly this reason. contrast.test.ts pins the same slots, per theme, as WARN_SLOTS_BY_THEME — this map ports that same data as gate policy rather than re-deriving it.",
};

/**
 * The EXACT shape (and, for light mode, the exact slot numbers)
 * `contrast.test.ts`'s own `WARN_SLOTS_BY_THEME` uses — ported here as
 * gate policy data rather than re-derived. `dark` is empty because the
 * dark palette's own steps were chosen to clear 3:1 outright, so it
 * carries no relief at all; `light`'s `[3, 4, 5]` (aqua/yellow/magenta)
 * is the one real, currently-known-and-accepted WARN band. If a future
 * palette edit moves a slot in or out of this list without ALSO updating
 * `contrast.test.ts`'s own copy, the two now disagree about policy —
 * `theme-parity.test.ts`-style drift this gate cannot catch by itself
 * (each file owns its own copy, the same way `tokens.css`'s two dark
 * blocks are hand-kept-identical rather than shared), but a stale entry
 * on EITHER side still gets caught the moment it stops matching reality:
 * a slot removed here that still fails on the palette becomes a real
 * `"below-threshold"` finding; a slot left here that no longer fails
 * becomes a real `"stale-exception"` finding. Neither direction can
 * silently drift forever.
 */
const CATEGORICAL_EXCEPTION_SLOTS_BY_THEME: Readonly<Record<string, readonly number[]>> = {
  light: [3, 4, 5],
  dark: [],
};

/**
 * `CONTRAST_PAIRS` with the theme-scoped categorical relief (see this
 * file's header, "EXCEPTIONS") attached to the matching
 * `chart-categorical-<n>/chart-surface` pairs' `exception` field for
 * `theme`, and every other pair untouched. `contrast-cli.ts` calls this
 * once per theme it checks (light, and dark when the file being checked
 * declares one) instead of using the bare `CONTRAST_PAIRS` array
 * directly — that bare array stays theme-agnostic on purpose (a caller
 * building their OWN pairs against their OWN palette has no reason to
 * inherit THIS package's specific relief), and this function is the one
 * place that reunites the two for THIS package's real, checked-in
 * policy.
 */
export function contrastPairsForTheme(theme: "light" | "dark"): readonly ContrastPair[] {
  const exceptedSlots = new Set(CATEGORICAL_EXCEPTION_SLOTS_BY_THEME[theme] ?? []);
  const slotOf = (id: string): number | undefined => {
    const match = /^chart-categorical-(\d+)\/chart-surface$/.exec(id);
    return match ? Number(match[1]) : undefined;
  };
  return CONTRAST_PAIRS.map((pair) => {
    const slot = slotOf(pair.id);
    if (slot === undefined || !exceptedSlots.has(slot)) return pair;
    return { ...pair, exception: CATEGORICAL_WARN_EXCEPTION };
  });
}
