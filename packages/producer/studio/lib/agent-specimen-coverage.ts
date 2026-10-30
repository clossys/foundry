import type { AgentSpecimenPlan } from './agent-specimen-data';

export interface ResolvedSpecimenEvidence {
  sectionId: string;
  registered: boolean;
  items: readonly unknown[];
  variantIds: readonly string[];
}
export interface AgentSpecimenCoverage {
  cellId: string; ready: boolean; boundSectionId?: string; registered: boolean; itemCount: number;
  expectedVariantIds: string[];
  variants: { id: string; renderable: boolean; reason?: string }[];
  issues: string[];
}
/** Expected identities come from the source plan, independently of the leaf adapter. */
export function agentSpecimenCoverage(plan: AgentSpecimenPlan, binding?: ResolvedSpecimenEvidence): AgentSpecimenCoverage {
  const issues = [...plan.issues];
  const registered = !!binding?.registered && /^sections\.specimen-[a-z][a-z0-9-]*$/.test(binding.sectionId);
  if (!registered) issues.push('A registered bound specimen leaf is unavailable.');
  const itemCount = Array.isArray(binding?.items) ? binding.items.length : 0;
  if (!itemCount) issues.push('A specimen leaf requires at least one item.');
  if (!plan.expectedVariantIds.length) issues.push('The source has no specimen variants.');
  if (new Set(plan.expectedVariantIds).size !== plan.expectedVariantIds.length) issues.push('The source repeats a variant identity.');
  const declarations = binding?.variantIds ?? [];
  if (new Set(declarations).size !== declarations.length) issues.push('The leaf adapter repeats a variant identity.');
  for (const id of declarations) if (!plan.expectedVariantIds.includes(id)) issues.push(`The leaf adapter declares an unknown variant: ${id}.`);
  const variants = plan.expectedVariantIds.map(id => {
    const renderable = registered && itemCount > 0 && declarations.filter(value => value === id).length === 1;
    return { id, renderable, ...(!renderable ? { reason: 'The actual source variant has no registered leaf item.' } : {}) };
  });
  if (variants.some(variant => !variant.renderable)) issues.push('One or more source variants are unrendered.');
  return { cellId: plan.cellId, ready: issues.length === 0, ...(binding ? { boundSectionId: binding.sectionId } : {}), registered, itemCount, expectedVariantIds: [...plan.expectedVariantIds], variants, issues };
}
