/**
 * Company overview template (#1207): "Company overview: short, medium,
 * long." The pack's opinion of what a good overview contains, per length
 * (#1206's own definitions — short for cold outreach, medium for
 * follow-ups, long for diligence and press) — expressed as an ordered list
 * of section ids, so every client starts from the same expert default
 * section order. This is structure, not copy: filling each section's
 * actual prose is Writer's job, referenced by these same ids (#1205).
 */
export type CompanyOverviewLength = "short" | "medium" | "long";

export const COMPANY_OVERVIEW_TEMPLATES: Readonly<Record<CompanyOverviewLength, readonly string[]>> = {
  short: ["one-liner", "problem", "solution", "call-to-action"],
  medium: ["one-liner", "problem", "solution", "traction", "team", "call-to-action"],
  long: [
    "one-liner",
    "problem",
    "solution",
    "market",
    "product",
    "traction",
    "business-model",
    "team",
    "roadmap",
    "call-to-action",
  ],
};

export function overviewSectionIds(length: CompanyOverviewLength): readonly string[] {
  return COMPANY_OVERVIEW_TEMPLATES[length];
}
