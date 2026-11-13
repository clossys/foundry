import { CatalogError } from './api.js';
import { identityRuleDefinition, instantiateIdentityRule, type IdentityRuleId } from '../catalog-assets/identity.js';
import { compare } from './model.js';
import { stableStringify } from './stable.js';
import type { CatalogData, CatalogRule, LibraryData } from './types.js';

export function matchesRuleInputs(rule: CatalogRule, inputs: readonly string[]): boolean {
  return rule.inputs === undefined || stableStringify([...rule.inputs].sort(compare)) === stableStringify([...new Set(inputs)].sort(compare));
}
/** The saved registry must admit a builtin and preserve its versioned input contract. */
export function registeredRule(catalog: CatalogData, id: string, slot: string): CatalogRule {
  const rule=catalog.rules?.find(rule=>rule.id===id&&rule.slot===slot);
  if(!rule) throw new CatalogError(`derive: unknown rule ${id} for ${slot}`);
  const builtin=identityRuleDefinition(id);
  if(builtin && (rule.slot!==builtin.slot || rule.inputs===undefined || !matchesRuleInputs(builtin,rule.inputs))) throw new CatalogError(`derive: ${id} registry differs from declared inputs`);
  return rule;
}
/** Only explicit derive instantiates values. Resolve and check never refresh saved outputs. */
export function materializeRule(catalog: CatalogData, library: LibraryData, id: string, slot: string): CatalogRule {
  const rule=registeredRule(catalog,id,slot);
  return identityRuleDefinition(id) ? instantiateIdentityRule(catalog,library,id as IdentityRuleId).rule : rule;
}
