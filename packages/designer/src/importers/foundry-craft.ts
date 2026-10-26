import recorded from "./foundry-craft.json" with { type: "json" };

/**
 * K5 craft comparison for Foundry offers whose interaction craft was never compared with the benchmark.
 *
 * The record (`foundry-craft.json`) is measured, not authored: `foundry-craft.test.tsx` renders each
 * candidate and the benchmark controls in the same harness, reads the focus-visible, disabled, target,
 * forced-colour, paint and spacing treatment each interactive part actually carries, and fails when the
 * committed record differs from a fresh measurement (`UPDATE_FOUNDRY_CRAFT=1` rewrites it). This module
 * only judges a record against its own measured benchmark; it never asserts a pass by itself.
 */
export interface CraftPart {
  /** Scenario that produced the reading, e.g. `orientation=vertical` or `nested+disabled`. */
  scenario: string;
  /** Rendered part, e.g. `row`, `remove`, `chevron`, `control`. */
  part: string;
  /** Reachable with Tab or the collection's arrow keys. */
  keyboard: boolean;
  /** A pointer or keyboard activation target (row, button). */
  pressable: boolean;
  /** Read in its disabled state (disabled key or isDisabled). */
  inDisabledState: boolean;
  /** Focus-visible indicator value (box-shadow without `inset`, or the outline shorthand); null when none renders. */
  focus: string | null;
  /** Disabled treatment value (opacity); null when the part renders none in its disabled state. */
  disabled: string | null;
  /** Target floor: min-block-size value or the control-height utility; null when the part has none. */
  target: string | null;
  /** Focus survives forced colours: an outline indicator, or a forced-colors outline utility beside a box-shadow ring. */
  forcedColors: boolean;
  /** Paint values that are neither token utilities nor var() reads (dark mode would not follow them). */
  literalPaint: readonly string[];
  /** Spacing utilities on the part (density); every one must come from the spacing scale. */
  spacing: readonly string[];
}
export interface CraftBenchmark {
  /** Focus treatments the chosen Foundry benchmark controls render (Button outline, GridList row ring). */
  focus: readonly string[];
  /** Disabled treatment the benchmark controls render. */
  disabled: readonly string[];
  /** Target floors the benchmark controls carry. */
  target: readonly string[];
}
export interface CraftComparison {
  benchmark: CraftBenchmark;
  /** Per offered leaf: the measured parts across every scenario the blocker named. */
  slots: Readonly<Record<string, { scenarios: readonly string[]; parts: readonly CraftPart[] }>>;
}

/** The Foundry leaves whose offers waited on this comparison. */
export const CRAFT_COMPARED_LEAVES = ["tag-group", "toolbar", "tree"] as const;
const SPACING = /^(?:-?(?:gap|gap-x|gap-y|p|px|py|ps|pe|pt|pb|m|mx|my|ms|me|mt|mb|space-x|space-y)-(?:none|3xs|2xs|xs|sm|md|lg|xl|2xl|3xl|4xl))$/;

/** Every reason the measured parts of one leaf fall short of the measured benchmark; empty means comparable. */
export function craftFindings(leaf: string, comparison: CraftComparison = recorded as CraftComparison): string[] {
  const measured = comparison.slots[leaf];
  if (!measured || !measured.parts.length) return [`${leaf}: no measured craft comparison`];
  const findings: string[] = [];
  const { benchmark } = comparison;
  for (const scenario of measured.scenarios) if (!measured.parts.some(part => part.scenario === scenario)) findings.push(`${leaf}: scenario ${scenario} was not measured`);
  for (const part of measured.parts) {
    const at = `${leaf} ${part.part} (${part.scenario})`;
    if (part.keyboard && (part.focus === null || !benchmark.focus.includes(part.focus))) findings.push(`${at}: focus-visible indicator ${part.focus ?? "absent"} differs from the benchmark`);
    if (part.inDisabledState && (part.disabled === null || !benchmark.disabled.includes(part.disabled))) findings.push(`${at}: disabled treatment ${part.disabled ?? "absent"} differs from the benchmark`);
    if (part.pressable && (part.target === null || !benchmark.target.includes(part.target))) findings.push(`${at}: target floor ${part.target ?? "absent"} differs from the benchmark`);
    if (part.keyboard && !part.forcedColors) findings.push(`${at}: no forced-colours focus treatment`);
    for (const paint of part.literalPaint) findings.push(`${at}: literal paint ${paint} does not follow the colour scheme`);
    for (const spacing of part.spacing) if (!SPACING.test(spacing)) findings.push(`${at}: spacing ${spacing} is off the spacing scale`);
  }
  return findings;
}

/** K5 offer blocker for a compared leaf: present exactly while its measured comparison has findings. */
export function craftBlockers(leaf: (typeof CRAFT_COMPARED_LEAVES)[number], comparison?: CraftComparison): { code: string; message: string }[] | undefined {
  const findings = craftFindings(leaf, comparison);
  return findings.length ? [{ code: "K5", message: `Offer blocked: measured craft comparison with the benchmark fails: ${findings.join("; ")}.` }] : undefined;
}
