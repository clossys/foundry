/**
 * The hero-backdrop contract: one sanctioned place for a per-brand hero
 * visual, and the two checks that hold a backdrop to it.
 *
 * A hero backdrop is decoration behind the hero's own text. Built ad hoc it
 * has needed the same five fixes every time: text that stays readable over
 * the worst frame of the visual, a layer that never steals pointer events,
 * a layer that assistive technology skips, a still frame for people who
 * ask for reduced motion, and a load cost that cannot block the first
 * paint. This module states those five as data (`BackdropContract`) and as
 * two checks, so a backdrop is judged against the same rules wherever it
 * is built.
 *
 * TWO CHECKS, TWO SUBJECTS
 * -------------------------
 *   - `checkBackdropContract(contract, { tokens?, darkTokens? })` judges the DECLARATION:
 *     the contrast of the scrim and its text token over a stated worst-case
 *     backdrop color, the `ariaHidden` and `pointerEvents` promises, the
 *     reduced-motion fallback, and the lazy-loading budget. It is pure
 *     data in, data out.
 *   - `checkBackdropElement(element)` judges the RENDERED element a consumer
 *     built from it: `aria-hidden="true"`, `pointer-events: none` on the
 *     layer and on every descendant, and no focusable descendant.
 *
 * Both return a report and never throw. Both fail closed: anything they
 * cannot evaluate (a token the registry does not hold, a value that is not
 * a parseable color, a malformed contract, a value that is not an element)
 * is listed under `unchecked` and makes `ok` false. A finding means a
 * rule was evaluated and broken; `unchecked` means it could not be
 * evaluated. Neither is a pass.
 *
 * THE FIVE RULES (Check A)
 * -------------------------
 *   - `scrim-contrast`: `scrim.token` is composited over
 *     `scrim.worstCaseBackdrop`, and `scrim.textToken` must reach AA
 *     (`AA`, 4.5) against the result, in the light AND the dark theme (see
 *     BOTH THEMES). Both tokens are resolved through the token registry
 *     (default `TOKENS`, so the default light values), the same alias-chain
 *     walk the contrast gate uses. The text token must be opaque: a
 *     translucent text color has no single background to measure against
 *     here, so it is `unchecked`.
 *   - `aria-hidden`: `ariaHidden` is `true`. A `chart` backdrop must also be
 *     `illustrative: true` — no information lives only in a layer that
 *     assistive technology skips — and that is reported under this rule.
 *   - `pointer-events`: `pointerEvents` is `"none"`.
 *   - `reduced-motion-fallback`: `video`, `canvas` and `chart` need a
 *     non-empty `reducedMotion.fallbackFrame`. An `image` is its own still
 *     frame, so it does not need one.
 *   - `lazy-loading-budget`: `loading.strategy` is `"lazy"` or `"idle"`,
 *     never eager, and `loading.budgetBytes` is a positive integer at or
 *     under `BACKDROP_BUDGET_CEILING_BYTES`.
 *
 * BOTH THEMES
 * -----------
 * The scrim pairing must hold in the light and the dark theme, the same
 * two themes the contrast gate checks. `TOKENS` holds light values only,
 * and this module reads no stylesheet, so the dark theme is checked
 * against `darkTokens` when the caller supplies it: a registry of the dark
 * theme's values, layered over the light one the way the contrast gate
 * layers its dark block. Without `darkTokens`, a scrim or text token whose
 * alias chain touches a `themeDependent` token (in the supplied registry
 * or in `TOKENS`) is `unchecked` with `theme-unchecked`: its dark value is
 * unknown here, and a pairing that passes in light can fail in dark. A
 * pairing whose tokens are all theme-invariant is the same in both themes
 * and needs no `darkTokens`. A light-theme failure is still a finding.
 *
 * `--color-overlay-scrim` is the scrim token to use; it darkens in the dark
 * theme. For the text, use a token that stays light in both themes, such
 * as `--color-neutral-50`. `--color-ink-on-inverse` is not a hero-text
 * token: it is the ink for the inverse plate, which turns light in the
 * dark theme, so it turns dark there and fails over a darkened scrim.
 *
 * WHAT THIS DOES NOT DO
 * ----------------------
 * It does not render a backdrop, load one, measure a real asset's size, or
 * find the worst-case backdrop color for the caller: `worstCaseBackdrop` is
 * a statement the author makes, and the check holds the scrim to it. Check
 * B reads the attributes and inline or computed style the element
 * reports; it does not follow shadow roots or run script. There is no
 * Publisher slot, block or CSS here — the contract is the data a later
 * wiring step consumes.
 *
 * Pure TypeScript. No React, and no DOM module is imported or touched at
 * module scope; `checkBackdropElement` only calls methods on the element it
 * is handed.
 */

import { AA } from "../tokens/contrast-pairs.js";
import { luminanceOf } from "../tokens/color.js";
import { resolveTokenValue } from "../tokens/internal/resolve-token-value.js";
import { TOKENS } from "../tokens/tokens.js";
import type { TokenDefinition } from "../tokens/tokens.js";

/** The four kinds of hero backdrop the contract covers. */
export const BACKDROP_KINDS = ["image", "video", "canvas", "chart"] as const;

export type BackdropKind = (typeof BACKDROP_KINDS)[number];

/**
 * The largest `loading.budgetBytes` a backdrop may declare: 2 MiB
 * (2,097,152 bytes) of transferred bytes for the whole backdrop. A larger
 * budget is a `lazy-loading-budget` finding; raise it here only with a
 * reason, because every consumer's hero inherits it.
 */
export const BACKDROP_BUDGET_CEILING_BYTES = 2 * 1024 * 1024;

/** The scrim between the backdrop and the hero text, and the worst case it is judged against. */
export interface BackdropScrim {
  /** A registry token naming the scrim color, for example `--color-overlay-scrim`. */
  token: string;
  /**
   * A registry token naming the hero text color. Use one that stays light in
   * both themes, for example `--color-neutral-50`; `--color-ink-on-inverse`
   * turns dark in the dark theme and fails over a darkened scrim.
   */
  textToken: string;
  /** The lightest or busiest color the backdrop can show behind the text: an opaque hex or `oklch()` value. */
  worstCaseBackdrop: string;
}

/** What a reduced-motion visitor sees instead of the moving backdrop. */
export interface BackdropReducedMotion {
  /** A reference to the still frame, such as an asset path or id. Must be non-empty. */
  fallbackFrame: string;
}

/** When the backdrop loads and how many bytes it may cost. */
export interface BackdropLoading {
  strategy: "lazy" | "idle";
  /** A positive integer no larger than `BACKDROP_BUDGET_CEILING_BYTES`. */
  budgetBytes: number;
}

interface BackdropBase {
  scrim: BackdropScrim;
  ariaHidden: true;
  pointerEvents: "none";
  loading: BackdropLoading;
}

/** A hero backdrop declaration. `kind` selects the variant; every variant carries the same promises. */
export type BackdropContract =
  | (BackdropBase & { kind: "image"; reducedMotion?: BackdropReducedMotion })
  | (BackdropBase & { kind: "video"; reducedMotion: BackdropReducedMotion })
  | (BackdropBase & { kind: "canvas"; reducedMotion: BackdropReducedMotion })
  | (BackdropBase & { kind: "chart"; reducedMotion: BackdropReducedMotion; illustrative: true });

/** The five rule ids of `checkBackdropContract`. */
export type BackdropRuleId =
  | "scrim-contrast"
  | "aria-hidden"
  | "pointer-events"
  | "reduced-motion-fallback"
  | "lazy-loading-budget";

/** The three rule ids of `checkBackdropElement`. */
export type BackdropElementRuleId = "element-aria-hidden" | "element-pointer-events" | "element-focusable-descendant";

/** Why a rule could not be evaluated. */
export type BackdropUncheckedReason =
  | "malformed-contract"
  | "unknown-kind"
  | "unresolvable-token"
  | "unparseable-token"
  | "theme-unchecked"
  | "unparseable-backdrop"
  | "not-an-element";

/** A rule that was evaluated and broken. */
export interface BackdropFinding<Rule extends string = BackdropRuleId> {
  rule: Rule;
  /** A developer-facing message; not shipped copy. */
  message: string;
}

/** A rule that could not be evaluated. Counts against `ok`. */
export interface BackdropUnchecked<Rule extends string = BackdropRuleId> {
  rule: Rule;
  reason: BackdropUncheckedReason;
  message: string;
}

/** The result of either check. `ok` is true only with no findings and nothing unchecked. */
export interface BackdropReport<Rule extends string = BackdropRuleId> {
  ok: boolean;
  findings: BackdropFinding<Rule>[];
  unchecked: BackdropUnchecked<Rule>[];
}

export interface BackdropCheckOptions {
  /**
   * The light-theme token registry the scrim and text tokens resolve
   * against. Defaults to this package's own `TOKENS`, which holds the
   * default (light) values.
   */
  tokens?: Readonly<Record<string, TokenDefinition>>;
  /**
   * The dark-theme token registry: the dark theme's values layered over the
   * light registry. When given, the scrim pairing is checked in both themes.
   * When absent, a scrim or text token that changes with the theme is
   * `unchecked` (`theme-unchecked`), because its dark value is unknown. A
   * page with no dark theme states that by passing its light registry here.
   */
  darkTokens?: Readonly<Record<string, TokenDefinition>>;
}

const CONTRACT_RULES: readonly BackdropRuleId[] = [
  "scrim-contrast",
  "aria-hidden",
  "pointer-events",
  "reduced-motion-fallback",
  "lazy-loading-budget",
];

const MOTION_KINDS: ReadonlySet<string> = new Set<BackdropKind>(["video", "canvas", "chart"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean" || value === undefined || value === null) return String(value);
  return typeof value;
}

function contrastOfLuminances(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Resolves a registry token to its literal value, or reports why it cannot. */
function resolveColorToken(
  property: string,
  role: string,
  tokens: Readonly<Record<string, TokenDefinition>>,
): { value: string } | BackdropUnchecked {
  const resolved = resolveTokenValue(property, tokens);
  if (resolved.value === undefined) {
    const why = resolved.cycle !== undefined ? `its alias chain loops at ${resolved.cycle}` : `${resolved.missingProperty ?? property} is not in the token registry`;
    return {
      rule: "scrim-contrast",
      reason: "unresolvable-token",
      message: `The ${role} token ${property} could not be resolved: ${why}.`,
    };
  }
  return { value: resolved.value };
}

type Registry = Readonly<Record<string, TokenDefinition>>;

type ScrimResult = BackdropFinding | BackdropUnchecked;

/**
 * Evaluates the scrim pairing against one theme's registry. `theme` only
 * labels the messages. Returns `undefined` when the pairing reaches AA.
 */
function checkScrimInTheme(
  scrim: { token: string; textToken: string; worstCaseBackdrop: string },
  tokens: Registry,
  theme: string,
): ScrimResult | undefined {
  const { token, textToken, worstCaseBackdrop } = scrim;

  const scrimValue = resolveColorToken(token, `${theme} scrim`, tokens);
  if (!("value" in scrimValue)) return scrimValue;
  const textValue = resolveColorToken(textToken, `${theme} text`, tokens);
  if (!("value" in textValue)) return textValue;

  let composited: number;
  try {
    composited = luminanceOf(scrimValue.value, worstCaseBackdrop);
  } catch {
    return {
      rule: "scrim-contrast",
      reason: "unparseable-token",
      message: `The ${theme} scrim token ${token} resolves to ${describe(scrimValue.value)}, which is not a color this check can read.`,
    };
  }
  let text: number;
  try {
    text = luminanceOf(textValue.value);
  } catch {
    return {
      rule: "scrim-contrast",
      reason: "unparseable-token",
      message: `The ${theme} text token ${textToken} resolves to ${describe(textValue.value)}, which is not an opaque color this check can read.`,
    };
  }
  if (!Number.isFinite(composited) || !Number.isFinite(text)) {
    return {
      rule: "scrim-contrast",
      reason: "unparseable-token",
      message: `The ${theme} scrim ${token} or text ${textToken} did not produce a luminance.`,
    };
  }

  const ratio = contrastOfLuminances(composited, text);
  if (ratio >= AA) return undefined;
  return {
    rule: "scrim-contrast",
    message: `In the ${theme} theme, ${textToken} over ${token} composited on ${worstCaseBackdrop} has contrast ${ratio.toFixed(2)}:1; at least ${AA}:1 is required.`,
  };
}

/**
 * True when `property`'s alias chain touches a token that changes with the
 * theme, according to the supplied registry or this package's `TOKENS`
 * (so a registry that drops the flag cannot hide a known theme token).
 */
function isThemeDependent(property: string, tokens: Registry): boolean {
  return resolveTokenValue(property, tokens).chain.some(
    (name) => tokens[name]?.themeDependent === true || TOKENS[name]?.themeDependent === true,
  );
}

function checkScrim(scrim: unknown, tokens: Registry, darkTokens: Registry | undefined): ScrimResult[] {
  if (
    !isRecord(scrim) ||
    typeof scrim.token !== "string" ||
    typeof scrim.textToken !== "string" ||
    typeof scrim.worstCaseBackdrop !== "string"
  ) {
    return [{
      rule: "scrim-contrast",
      reason: "malformed-contract",
      message: "scrim must name token, textToken and worstCaseBackdrop, each as a string.",
    }];
  }
  const pairing = scrim as { token: string; textToken: string; worstCaseBackdrop: string };
  const { token, textToken, worstCaseBackdrop } = pairing;

  let backdropLuminance: number;
  try {
    backdropLuminance = luminanceOf(worstCaseBackdrop);
  } catch {
    return [{
      rule: "scrim-contrast",
      reason: "unparseable-backdrop",
      message: `worstCaseBackdrop ${describe(worstCaseBackdrop)} is not an opaque six-digit hex or OKLCH color.`,
    }];
  }
  if (!Number.isFinite(backdropLuminance)) {
    return [{
      rule: "scrim-contrast",
      reason: "unparseable-backdrop",
      message: `worstCaseBackdrop ${describe(worstCaseBackdrop)} did not produce a luminance.`,
    }];
  }

  const results: ScrimResult[] = [];
  const light = checkScrimInTheme(pairing, tokens, "light");
  if (light !== undefined) results.push(light);

  if (darkTokens !== undefined) {
    const dark = checkScrimInTheme(pairing, darkTokens, "dark");
    if (dark !== undefined) results.push(dark);
  } else if (light === undefined || !("reason" in light)) {
    const varying = [token, textToken].filter((name) => isThemeDependent(name, tokens));
    if (varying.length > 0) {
      results.push({
        rule: "scrim-contrast",
        reason: "theme-unchecked",
        message: `${varying.join(" and ")} change${varying.length === 1 ? "s" : ""} with the theme, so the dark-theme pairing was not checked; pass darkTokens to check it.`,
      });
    }
  }
  return results;
}

function checkLoading(loading: unknown): BackdropFinding[] {
  if (!isRecord(loading)) {
    return [{ rule: "lazy-loading-budget", message: "loading must declare a strategy and a budgetBytes." }];
  }
  const findings: BackdropFinding[] = [];
  if (loading.strategy !== "lazy" && loading.strategy !== "idle") {
    findings.push({
      rule: "lazy-loading-budget",
      message: `loading.strategy is ${describe(loading.strategy)}; it must be "lazy" or "idle", never eager.`,
    });
  }
  const budget = loading.budgetBytes;
  if (typeof budget !== "number" || !Number.isInteger(budget) || budget <= 0) {
    findings.push({
      rule: "lazy-loading-budget",
      message: `loading.budgetBytes is ${describe(budget)}; it must be a positive integer.`,
    });
  } else if (budget > BACKDROP_BUDGET_CEILING_BYTES) {
    findings.push({
      rule: "lazy-loading-budget",
      message: `loading.budgetBytes is ${budget}, over the ceiling of ${BACKDROP_BUDGET_CEILING_BYTES} bytes.`,
    });
  }
  return findings;
}

function allUnchecked(reason: BackdropUncheckedReason, message: string): BackdropReport {
  return {
    ok: false,
    findings: [],
    unchecked: CONTRACT_RULES.map((rule) => ({ rule, reason, message })),
  };
}

/**
 * Checks a `BackdropContract` against the five rules. Never throws; an
 * input it cannot evaluate is reported under `unchecked` and `ok` is false.
 */
export function checkBackdropContract(contract: BackdropContract, options: BackdropCheckOptions = {}): BackdropReport {
  try {
    if (!isRecord(contract)) {
      return allUnchecked("malformed-contract", "The contract must be an object.");
    }
    const tokens = options.tokens ?? TOKENS;
    const findings: BackdropFinding[] = [];
    const unchecked: BackdropUnchecked[] = [];

    for (const scrim of checkScrim(contract.scrim, tokens, options.darkTokens)) {
      if ("reason" in scrim) unchecked.push(scrim);
      else findings.push(scrim);
    }

    if (contract.ariaHidden !== true) {
      findings.push({ rule: "aria-hidden", message: `ariaHidden is ${describe(contract.ariaHidden)}; it must be true.` });
    }
    if (contract.kind === "chart" && (contract as { illustrative?: unknown }).illustrative !== true) {
      findings.push({
        rule: "aria-hidden",
        message: "A chart backdrop must be illustrative: true, because assistive technology skips it and no information may live only there.",
      });
    }

    if (contract.pointerEvents !== "none") {
      findings.push({ rule: "pointer-events", message: `pointerEvents is ${describe(contract.pointerEvents)}; it must be "none".` });
    }

    const kind = contract.kind;
    if (typeof kind !== "string" || !(BACKDROP_KINDS as readonly string[]).includes(kind)) {
      unchecked.push({
        rule: "reduced-motion-fallback",
        reason: "unknown-kind",
        message: `kind is ${describe(kind)}; it must be one of ${BACKDROP_KINDS.join(", ")}, so whether a fallback frame is required is unknown.`,
      });
    } else if (MOTION_KINDS.has(kind)) {
      const frame = isRecord(contract.reducedMotion) ? contract.reducedMotion.fallbackFrame : undefined;
      if (typeof frame !== "string" || frame.trim() === "") {
        findings.push({
          rule: "reduced-motion-fallback",
          message: `A ${kind} backdrop needs reducedMotion.fallbackFrame, a non-empty reference to a still frame.`,
        });
      }
    }

    findings.push(...checkLoading(contract.loading));

    const order = (rule: BackdropRuleId): number => CONTRACT_RULES.indexOf(rule);
    findings.sort((a, b) => order(a.rule) - order(b.rule));
    unchecked.sort((a, b) => order(a.rule) - order(b.rule));
    return { ok: findings.length === 0 && unchecked.length === 0, findings, unchecked };
  } catch {
    return allUnchecked("malformed-contract", "The contract could not be read.");
  }
}

const NATIVE_FOCUSABLE =
  "a[href], area[href], button, input, select, textarea, summary, iframe, video[controls], audio[controls], " +
  "[contenteditable]:not([contenteditable=\"false\"])";

function tabindexOf(node: Element): number | undefined {
  const raw = node.getAttribute("tabindex");
  if (raw === null) return undefined;
  const text = raw.trim();
  if (!/^[+-]?\d+$/.test(text)) return undefined;
  return Number.parseInt(text, 10);
}

/** True when `node` is in the keyboard focus order: a native control, link or editable, or an element with `tabindex` 0 or more. */
function isFocusable(node: Element): boolean {
  const tabindex = tabindexOf(node);
  if (tabindex !== undefined && tabindex < 0) return false;
  if (tabindex !== undefined) return true;
  if (node.localName === "input" && (node.getAttribute("type") ?? "").toLowerCase() === "hidden") return false;
  return node.matches(NATIVE_FOCUSABLE);
}

function pointerEventsOf(element: Element): string {
  const view = element.ownerDocument?.defaultView;
  const computed = view?.getComputedStyle?.(element)?.getPropertyValue("pointer-events") ?? "";
  if (computed.trim() !== "") return computed.trim().toLowerCase();
  const inline = (element as Element & { style?: { getPropertyValue(name: string): string } }).style?.getPropertyValue("pointer-events") ?? "";
  return inline.trim().toLowerCase();
}

/**
 * Checks a rendered backdrop element: `aria-hidden="true"`,
 * `pointer-events: none` on the element with no descendant setting it to
 * anything else, and no focusable descendant (a link, button,
 * form control, or an element with `tabindex` 0 or more). Never throws; a
 * value that is not an element is `unchecked`.
 */
export function checkBackdropElement(element: Element): BackdropReport<BackdropElementRuleId> {
  const rules: readonly BackdropElementRuleId[] = ["element-aria-hidden", "element-pointer-events", "element-focusable-descendant"];
  const notChecked = (message: string): BackdropReport<BackdropElementRuleId> => ({
    ok: false,
    findings: [],
    unchecked: rules.map((rule) => ({ rule, reason: "not-an-element" as const, message })),
  });
  try {
    if (
      !isRecord(element) ||
      typeof element.getAttribute !== "function" ||
      typeof element.querySelectorAll !== "function" ||
      typeof element.matches !== "function"
    ) {
      return notChecked("The value is not a DOM element.");
    }
    const findings: BackdropFinding<BackdropElementRuleId>[] = [];

    const hidden = element.getAttribute("aria-hidden");
    if (hidden !== "true") {
      findings.push({ rule: "element-aria-hidden", message: `aria-hidden is ${describe(hidden)}; it must be "true".` });
    }

    const descendants = Array.from(element.querySelectorAll("*"));
    const pointer = pointerEventsOf(element);
    if (pointer !== "none") {
      findings.push({
        rule: "element-pointer-events",
        message: `pointer-events is ${pointer === "" ? "not set" : describe(pointer)}; it must be "none".`,
      });
    } else {
      // pointer-events inherits, so a descendant that sets nothing (or "inherit") stays "none";
      // one that sets any other value takes pointer events back through the hidden layer.
      const reclaiming = descendants.filter((node) => {
        const value = pointerEventsOf(node);
        return value !== "" && value !== "none" && value !== "inherit";
      });
      if (reclaiming.length > 0) {
        const names = reclaiming.slice(0, 3).map((node) => `${node.localName} (${pointerEventsOf(node)})`).join(", ");
        findings.push({
          rule: "element-pointer-events",
          message: `${reclaiming.length} descendant(s) set pointer-events back on (${names}); every descendant must leave it "none".`,
        });
      }
    }

    const focusable = descendants.filter(isFocusable);
    if (focusable.length > 0) {
      const names = focusable.slice(0, 3).map((node) => node.localName).join(", ");
      findings.push({
        rule: "element-focusable-descendant",
        message: `The backdrop holds ${focusable.length} focusable descendant(s) (${names}); a hidden layer must not be in the focus order.`,
      });
    }
    return { ok: findings.length === 0, findings, unchecked: [] };
  } catch {
    return notChecked("The element could not be read.");
  }
}
