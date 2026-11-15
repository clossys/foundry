/**
 * Copy field roles, budgets and binding kinds (foundry-build-0018; absorbs foundry-audit-0014 and 0015).
 * Every `copy.fields` entry a Designer unit declares names a role from the Writer role vocabulary. The role
 * fixes the source-locale budget: `maxLength.en` may be lower than the budget (a tighter contract) but never
 * higher. A field that admits a Director binding (for example `{brand}`) declares it in `bindings` and is ICU,
 * so Writer can interpolate it; a plain field never carries a binding.
 */
export const COPY_ROLES = ["eyebrow", "heading", "lead", "body", "action", "label", "alt"] as const;
export type CopyRole = (typeof COPY_ROLES)[number];

/** Source-locale (en) budgets in Unicode code points, one per role. ia-target designer.md 9.4.3 fixes eyebrow, heading,
 * lead, action and alt; label and body are package defaults (body admits long-form document text). */
export const ROLE_BUDGET: Readonly<Record<CopyRole, number>> = {
  eyebrow: 48, heading: 60, lead: 200, body: 48_000, action: 24, label: 80, alt: 140,
};
export const BUDGET_LOCALE = "en";

export interface RoleCopyField {
  key: string;
  role?: unknown;
  kind?: unknown;
  maxLength?: Readonly<Record<string, number>>;
  bindings?: unknown;
}
export interface CopyUnit {
  id: string;
  contract: { copy?: { sourceLocale?: string; fields?: readonly RoleCopyField[] } };
}
export interface CopyFieldRoleFinding {
  code: "COPY_ROLE_MISSING" | "COPY_ROLE_UNKNOWN" | "COPY_BUDGET" | "COPY_BINDING_KIND" | "COPY_BINDING_SHAPE";
  subject: string;
  message: string;
}

const isRole = (value: unknown): value is CopyRole => typeof value === "string" && (COPY_ROLES as readonly string[]).includes(value);
const BINDING = /^[a-z][a-zA-Z0-9]*$/;

/** Findings for every copy field of the given units; empty means every field has a known role, fits its budget,
 * and every binding sits on an ICU field. */
export function checkCopyFieldRoles(units: readonly CopyUnit[]): CopyFieldRoleFinding[] {
  const findings: CopyFieldRoleFinding[] = [];
  for (const unit of units) {
    for (const field of unit.contract.copy?.fields ?? []) {
      const subject = `${unit.id}#${field.key}`;
      const add = (code: CopyFieldRoleFinding["code"], message: string) => findings.push({ code, subject, message: `${subject}: ${message}` });
      if (field.role === undefined) add("COPY_ROLE_MISSING", "copy field has no role");
      else if (!isRole(field.role)) add("COPY_ROLE_UNKNOWN", `role ${String(field.role)} is not one of ${COPY_ROLES.join(", ")}`);
      else {
        const limit = field.maxLength?.[BUDGET_LOCALE];
        const budget = ROLE_BUDGET[field.role];
        if (typeof limit !== "number") add("COPY_BUDGET", `maxLength.${BUDGET_LOCALE} is missing`);
        else if (limit > budget) add("COPY_BUDGET", `maxLength.${BUDGET_LOCALE} ${limit} is over the ${field.role} budget ${budget}`);
      }
      if (field.bindings !== undefined) {
        if (!Array.isArray(field.bindings) || !field.bindings.length || field.bindings.some(name => typeof name !== "string" || !BINDING.test(name))) add("COPY_BINDING_SHAPE", "bindings must be a nonempty list of binding names");
        if (field.kind !== "icu") add("COPY_BINDING_KIND", `a field that admits a binding must be kind icu, not ${field.kind === undefined ? "missing" : String(field.kind)}`);
      }
    }
  }
  return findings;
}

/** Deterministic role a key takes when a unit is first given roles; the committed data, not this, is authoritative. */
export function defaultRoleFor(key: string, maxLengthEn: number): CopyRole {
  const parts = key.replace(/\[\]/g, "").split(".");
  const last = parts[parts.length - 1]!;
  if (last === "eyebrow") return "eyebrow";
  if (last === "heading" || last === "title") return "heading";
  if (key === "header.description") return "lead";
  if (last === "alt") return "alt";
  if (parts[0] === "actions" || last === "action") return "action";
  if (maxLengthEn >= 480) return "body";
  return "label";
}
