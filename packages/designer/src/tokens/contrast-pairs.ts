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
 *     not itself required to read a chart's data. Categorical marks and
 *     axis labels are checked below; the supplementary axis baseline
 *     retains the axis-above-grid invariant in contrast.test.ts. This
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
 *     This gate does not parse composite shadows or measure focus geometry.
 *     LinkGrid's outline uses bare `--color-accent` / `--color-accent-on-
 *     inverse` colors instead: their 3:1 contrast against its grounds and
 *     plates IS explicitly checked by the scoped pairs below.
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
   *
   * A value that does not start with `--` is a literal opaque color rather
   * than a token: the backdrop a translucent surface floats over when that
   * backdrop is arbitrary page content, not a token (the glass pairs check
   * over `oklch(1 0 0)` and `oklch(0 0 0)`, the two extremes). A literal
   * must parse and be opaque, or the pair is reported unchecked. Over a
   * literal backdrop the ratio is the lower of a linear-light blend and a
   * gamma-encoded sRGB blend (the browser's); a token backdrop keeps the
   * linear blend alone. Because a literal stands for any page content, a
   * pair over one also fails at 1:1 when the foreground's luminance lies
   * between the background over black and over white (some backdrop then
   * matches it), and its foreground must be opaque or it is reported
   * unchecked.
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
  // Ledger labels are normal text on the base/sunken record ground and tile
  // plates. Raised-surface status pairs already exist below. Inverse labels
  // follow the separately checked ground-primary ink policy.
  ...["success", "warning", "danger", "info"].flatMap(tone => ["base", "sunken"].map((surface): ContrastPair => ({
    id: `ledger/status-${tone}-text/surface-${surface}`,
    foreground: `--color-status-${tone}-text`,
    background: `--color-surface-${surface}`,
    level: "AA",
    minimumRatio: AA,
    description: "Ledger small status label on its record ground or work-product/tile plate.",
  }))),
  // LinkGrid uses body-scale titles and small descriptions on these five
  // actual grounds/resting/hover plates. These scoped AA requirements do
  // not change the legacy large-text or icon-only classifications below.
  ...[
    ["ink-primary", "surface-base"],
    ["ink-primary", "surface-sunken"],
    ["ink-primary", "surface-raised"],
    ["ink-secondary", "surface-base"],
    ["ink-secondary", "surface-sunken"],
    ["ink-secondary", "surface-raised"],
    ["ink-on-inverse", "surface-inverse"],
    ["ink-on-inverse", "surface-inverse-raised"],
    ["ink-on-inverse-muted", "surface-inverse"],
    ["ink-on-inverse-muted", "surface-inverse-raised"],
  ].map(([ink, surface]): ContrastPair => ({
    id: `link-grid/${ink}/${surface}`,
    foreground: `--color-${ink}`,
    background: `--color-${surface}`,
    level: "AA",
    minimumRatio: AA,
    description: "LinkGrid body-scale titles and small supporting copy on the ground or tile plate.",
  })),
  ...[
    ["accent", "surface-base"],
    ["accent", "surface-sunken"],
    ["accent", "surface-raised"],
    ["accent-on-inverse", "surface-inverse"],
    ["accent-on-inverse", "surface-inverse-raised"],
  ].map(([accent, surface]): ContrastPair => ({
    id: `link-grid/${accent}/${surface}`,
    foreground: `--color-${accent}`,
    background: `--color-${surface}`,
    level: "AA-large",
    minimumRatio: AA_LARGE,
    description: "LinkGrid focus outline color against both its surrounding ground and tile plate (non-text 3:1).",
  })),
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

  // ── the CTA ladder: tonal (T3), quiet (T4) and icon-only controls ─────
  // The tonal fills are translucent, so each is composited over the ground
  // it sits on first. Quiet on the inverse ground uses the on-inverse ink,
  // already checked by "ink-on-inverse/surface-inverse" above.
  {
    id: "ink-primary/control-tonal@surface-base",
    foreground: "--color-ink-primary",
    background: "--color-control-tonal",
    compositeOver: "--color-surface-base",
    level: "AA",
    minimumRatio: AA,
    description: "A tonal button's label on its fill, on the page ground.",
  },
  {
    id: "ink-primary/control-tonal@surface-sunken",
    foreground: "--color-ink-primary",
    background: "--color-control-tonal",
    compositeOver: "--color-surface-sunken",
    level: "AA",
    minimumRatio: AA,
    description: "A tonal button's label on its fill, on a sunken ground.",
  },
  {
    id: "ink-primary/control-tonal-hover@surface-sunken",
    foreground: "--color-ink-primary",
    background: "--color-control-tonal-hover",
    compositeOver: "--color-surface-sunken",
    level: "AA",
    minimumRatio: AA,
    description: "A hovered tonal button's label on its denser fill, on the darker of the two light grounds.",
  },
  {
    id: "ink-on-inverse/control-tonal-inverse@surface-inverse",
    foreground: "--color-ink-on-inverse",
    background: "--color-control-tonal-inverse",
    compositeOver: "--color-surface-inverse",
    level: "AA",
    minimumRatio: AA,
    description: "A tonal button's label on its inverse fill, on the inverse ground.",
  },
  {
    id: "ink-on-inverse/control-tonal-inverse-hover@surface-inverse",
    foreground: "--color-ink-on-inverse",
    background: "--color-control-tonal-inverse-hover",
    compositeOver: "--color-surface-inverse",
    level: "AA",
    minimumRatio: AA,
    description: "A hovered tonal button's label on its denser inverse fill, on the inverse ground.",
  },
  {
    id: "control-quiet/surface-base",
    foreground: "--color-control-quiet",
    background: "--color-surface-base",
    level: "AA",
    minimumRatio: AA,
    description: "A quiet (chevron text) button's label on the page ground.",
  },
  {
    id: "control-quiet/surface-sunken",
    foreground: "--color-control-quiet",
    background: "--color-surface-sunken",
    level: "AA",
    minimumRatio: AA,
    description: "A quiet (chevron text) button's label on a sunken ground.",
  },
  {
    id: "ink-on-inverse/surface-inverse-raised",
    foreground: "--color-ink-on-inverse",
    background: "--color-surface-inverse-raised",
    level: "AA-large",
    minimumRatio: AA_LARGE,
    description:
      "An icon-only control's glyph on its inverse fill: the glyph is the only thing that says what the control does, so it meets the 3:1 non-text floor (WCAG 1.4.11). On the light grounds the glyph is ink-primary on surface-raised, checked above at AA.",
  },

  // ── glass: overlay SiteHeader ink on its translucent plate, AA ─────────
  // The backdrop under the glass is arbitrary page content, blurred. A blur
  // averages that content, so the composite stays between the glass over
  // pure white and the glass over pure black. The two extremes bound every
  // backdrop only while the ink's luminance lies outside that range; when it
  // lies inside, some backdrop matches the ink, and the gate fails the pair
  // at 1:1 (`contrast-gate.ts`, `backdropCanMatchForeground`). Over a literal
  // backdrop the gate blends the glass both in
  // linear light and in gamma-encoded sRGB (how browsers paint alpha) and
  // keeps the lower ratio, since neither space is stricter for every
  // polarity. The ink is the one the header sets for the tone; a child that
  // sets its own ink is outside these pairs.
  {
    id: "ink-primary/surface-glass@backdrop-white",
    foreground: "--color-ink-primary",
    background: "--color-surface-glass",
    compositeOver: "oklch(1 0 0)",
    level: "AA",
    minimumRatio: AA,
    description: "An overlay SiteHeader (tone base) after scrolling, over a white backdrop.",
  },
  {
    id: "ink-primary/surface-glass@backdrop-black",
    foreground: "--color-ink-primary",
    background: "--color-surface-glass",
    compositeOver: "oklch(0 0 0)",
    level: "AA",
    minimumRatio: AA,
    description: "An overlay SiteHeader (tone base) after scrolling, over a black backdrop.",
  },
  {
    id: "ink-on-inverse/surface-glass-inverse@backdrop-white",
    foreground: "--color-ink-on-inverse",
    background: "--color-surface-glass-inverse",
    compositeOver: "oklch(1 0 0)",
    level: "AA",
    minimumRatio: AA,
    description: "An overlay SiteHeader (tone inverse) after scrolling, over a white backdrop.",
  },
  {
    id: "ink-on-inverse/surface-glass-inverse@backdrop-black",
    foreground: "--color-ink-on-inverse",
    background: "--color-surface-glass-inverse",
    compositeOver: "oklch(0 0 0)",
    level: "AA",
    minimumRatio: AA,
    description: "An overlay SiteHeader (tone inverse) after scrolling, over a black backdrop.",
  },

  // ── glass: overlay SiteHeader focus indicator on its plate, 3:1 ────────
  // The focus ring (`--ui-ring-focus`) and every `:focus-visible` outline
  // inside an overlay header take the tone's ink, not `--color-accent`
  // (`theme-keys.css`, `site-header-overlay`): accent on the base glass
  // over a white backdrop is 1.55:1 in the dark theme, and on the opaque
  // light-theme inverse plate it is 2.60:1. The ring is non-text, so it is
  // held to the 3:1 floor (WCAG 1.4.11), over the same two backdrops.
  {
    id: "focus-ring/surface-glass@backdrop-white",
    foreground: "--color-ink-primary",
    background: "--color-surface-glass",
    compositeOver: "oklch(1 0 0)",
    level: "AA-large",
    minimumRatio: AA_LARGE,
    description: "The keyboard focus indicator in an overlay SiteHeader (tone base) after scrolling, over a white backdrop: the tone's ink, at the 3:1 non-text floor (WCAG 1.4.11).",
  },
  {
    id: "focus-ring/surface-glass@backdrop-black",
    foreground: "--color-ink-primary",
    background: "--color-surface-glass",
    compositeOver: "oklch(0 0 0)",
    level: "AA-large",
    minimumRatio: AA_LARGE,
    description: "The keyboard focus indicator in an overlay SiteHeader (tone base) after scrolling, over a black backdrop: the tone's ink, at the 3:1 non-text floor (WCAG 1.4.11).",
  },
  {
    id: "focus-ring/surface-glass-inverse@backdrop-white",
    foreground: "--color-ink-on-inverse",
    background: "--color-surface-glass-inverse",
    compositeOver: "oklch(1 0 0)",
    level: "AA-large",
    minimumRatio: AA_LARGE,
    description: "The keyboard focus indicator in an overlay SiteHeader (tone inverse) after scrolling, over a white backdrop: the tone's ink, at the 3:1 non-text floor (WCAG 1.4.11).",
  },
  {
    id: "focus-ring/surface-glass-inverse@backdrop-black",
    foreground: "--color-ink-on-inverse",
    background: "--color-surface-glass-inverse",
    compositeOver: "oklch(0 0 0)",
    level: "AA-large",
    minimumRatio: AA_LARGE,
    description: "The keyboard focus indicator in an overlay SiteHeader (tone inverse) after scrolling, over a black backdrop: the tone's ink, at the 3:1 non-text floor (WCAG 1.4.11).",
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

  // ── status -text on the raised surface (StatusMark, no tint): AA ──────
  {
    id: "status-success-text/surface-raised",
    foreground: "--color-status-success-text",
    background: "--color-surface-raised",
    level: "AA",
    minimumRatio: AA,
    description: "StatusMark's success label: status text with no tint behind it, on a card or panel surface.",
  },
  {
    id: "status-warning-text/surface-raised",
    foreground: "--color-status-warning-text",
    background: "--color-surface-raised",
    level: "AA",
    minimumRatio: AA,
    description: "StatusMark's warning label: status text with no tint behind it, on a card or panel surface.",
  },
  {
    id: "status-danger-text/surface-raised",
    foreground: "--color-status-danger-text",
    background: "--color-surface-raised",
    level: "AA",
    minimumRatio: AA,
    description: "StatusMark's danger label: status text with no tint behind it, on a card or panel surface.",
  },
  {
    id: "status-info-text/surface-raised",
    foreground: "--color-status-info-text",
    background: "--color-surface-raised",
    level: "AA",
    minimumRatio: AA,
    description: "StatusMark's info label: status text with no tint behind it, on a card or panel surface.",
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
  // Inline charts have transparent plots: also check their actual page grounds.
  ...(["base", "sunken"] as const).flatMap((ground): ContrastPair[] => [
    {
      id: `chart-inline-axis-label/surface-${ground}`,
      foreground: "--color-ink-secondary",
      background: `--color-surface-${ground}`,
      level: "AA",
      minimumRatio: AA,
      description: `Small axis/tick labels on an inline chart's ${ground} ground use secondary ink at the normal-text floor.`,
    },
    ...([1, 2, 3, 4, 5, 6, 7, 8] as const).map((slot): ContrastPair => ({
      id: `chart-categorical-${slot}/surface-${ground}`,
      foreground: `--color-chart-categorical-${slot}`,
      background: `--color-surface-${ground}`,
      level: "AA-large",
      minimumRatio: AA_LARGE,
      description: `Categorical slot ${slot} on an inline chart's ${ground} ground.`,
    })),
  ]),
  // Range status glyphs occupy transparent base/sunken plot grounds.
  // Success retains its display fill, with a secondary-ink perimeter because
  // that fill measures approximately 2.9733:1 on the light sunken ground.
  ...(["base", "sunken"] as const).flatMap((ground): ContrastPair[] => [
    {
      id: `range/status-danger/surface-${ground}`,
      foreground: "--color-status-danger",
      background: `--color-surface-${ground}`,
      level: "AA-large",
      minimumRatio: AA_LARGE,
      description: `Range danger diamond against the ${ground} plot ground.`,
    },
    {
      id: `range/status-success-outline/surface-${ground}`,
      foreground: "--color-ink-secondary",
      background: `--color-surface-${ground}`,
      level: "AA-large",
      minimumRatio: AA_LARGE,
      description: `Range success glyph perimeter against the ${ground} plot ground.`,
    },
  ]),
  ...(["warning", "info"] as const).map((tone): ContrastPair => ({
    id: `range/status-${tone}/surface-sunken`,
    foreground: `--color-status-${tone}`,
    background: "--color-surface-sunken",
    level: "AA-large",
    minimumRatio: AA_LARGE,
    description: `Range ${tone} glyph against the sunken plot ground.`,
  })),
  // Waterfall changes and total perimeters must clear both transparent plot grounds.
  ...(["base", "sunken"] as const).flatMap((ground): ContrastPair[] => [
    ...(["positive", "negative"] as const).map((sign): ContrastPair => ({
      id: `waterfall/diverging-${sign}/surface-${ground}`,
      foreground: `--color-chart-diverging-${sign}`,
      background: `--color-surface-${ground}`,
      level: "AA-large",
      minimumRatio: AA_LARGE,
      description: `Signed Waterfall change against the ${ground} plot ground.`,
    })),
    {
      id: `waterfall/neutral-outline/surface-${ground}`,
      foreground: "--color-ink-secondary",
      background: `--color-surface-${ground}`,
      level: "AA-large",
      minimumRatio: AA_LARGE,
      description: `Waterfall total perimeter against the ${ground} plot ground.`,
    },
  ]),
  {
    id: "waterfall/neutral-outline/diverging-neutral",
    foreground: "--color-ink-secondary",
    background: "--color-chart-diverging-neutral",
    level: "AA-large",
    minimumRatio: AA_LARGE,
    description: "Waterfall total perimeter against its neutral interior.",
  },
  // Anatomy numerals are caption-sized text; every disc needs the normal-text floor.
  ...(["base", "sunken", "raised", "inverse"] as const).map(surface => ({
    id: `anatomy/surface-${surface}/${surface === "inverse" ? "ink-on-inverse" : "ink-primary"}`,
    foreground: `--color-surface-${surface}`,
    background: surface === "inverse" ? "--color-ink-on-inverse" : "--color-ink-primary",
    level: "AA" as const,
    minimumRatio: AA,
    description: "Caption-sized numeral on an Anatomy marker or grounded key disc.",
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

type InlineChartGround = "base" | "sunken";

// Measured separately from the original raised-surface palette acceptance.
// Never infer exceptions from whichever colors happen to miss their floor.
const INLINE_CATEGORICAL_EXCEPTION_SLOTS_BY_THEME: Readonly<
  Record<"light" | "dark", Readonly<Record<InlineChartGround, readonly number[]>>>
> = {
  light: { base: [2, 3, 4, 5], sunken: [2, 3, 4, 5] },
  dark: { base: [], sunken: [] },
};
const INLINE_CATEGORICAL_WARN_EXCEPTION: ContrastException = {
  wcagClause: "WCAG 2.2 SC 1.4.11 (Non-text Contrast)",
  compensatingMechanism:
    "Inline BarChart paths retain a visible legend naming every series, independently of the title, plus direct value labels as applicable, and the required matching table fallback. ScatterChart uses distinct equal-area categorical silhouettes, complete direct point labels, matching visible shape keys for two or more declared series, and the complete native table; ScatterChart.test.tsx pins those channels. Static marks remain one accessible chart graphic; the native table disclosure works without JavaScript. BarChart.server.test.tsx pins names, categorical fills, table columns and every value for one, two and eight series.",
  rationale:
    "The real base/sunken ground sweep in chart-ground-contrast.test.ts measures light slots 2/3/4/5 below 3:1: base approximately 2.94/2.58/1.99/2.47, sunken 2.68/2.36/1.82/2.26. These exact ground/slot pairs carry the chart layer's legend/table compensation; every dark slot and the other light slots must clear 3:1 without relief. This is separate from the original raised-surface palette report.",
};

/**
 * `CONTRAST_PAIRS` with the theme-scoped categorical relief (see this
 * file's header, "EXCEPTIONS") attached to the matching
 * `chart-categorical-<n>/chart-surface` pairs' `exception` field for
 * `theme`. Inline base/sunken pairs use their separately measured ground map;
 * every other pair is untouched. `contrast-cli.ts` calls this
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
    if (slot !== undefined && exceptedSlots.has(slot)) {
      return { ...pair, exception: CATEGORICAL_WARN_EXCEPTION };
    }
    const inline = /^chart-categorical-([1-8])\/surface-(base|sunken)$/.exec(pair.id);
    if (inline) {
      const ground = inline[2] as InlineChartGround;
      if (INLINE_CATEGORICAL_EXCEPTION_SLOTS_BY_THEME[theme][ground].includes(Number(inline[1]))) {
        return { ...pair, exception: INLINE_CATEGORICAL_WARN_EXCEPTION };
      }
    }
    return pair;
  });
}
