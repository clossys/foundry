/**
 * The `--tier` and `--basis` values a candidate submit takes (`clossys next <agent>/<slot> --submit`), shared with every
 * caller that submits through that verb (`init --publication` checks them before it writes anything), so the two cannot
 * drift. Not a step entry: the submit itself runs only through the pipeline runner (pipeline/runner.ts runStep).
 */
export const SUBMIT_TIERS = ["low", "mid", "high"] as const;
export const SUBMIT_BASES = ["agent", "owner", "planner"] as const;

/** The usage problem with a submit's `--tier` or `--basis` value, or undefined. */
export function submitValueIssue(flags: { readonly tier?: string; readonly basis?: string }): string | undefined {
  if (!(SUBMIT_TIERS as readonly string[]).includes(flags.tier!)) return `--tier must be ${SUBMIT_TIERS.join(", ")}, got ${flags.tier}`;
  if (!(SUBMIT_BASES as readonly string[]).includes(flags.basis!)) return `--basis must be ${SUBMIT_BASES.join(", ")}, got ${flags.basis}`;
  return undefined;
}
