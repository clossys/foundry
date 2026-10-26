import type { CatalogData, FillDoc, Placement, Slot } from '../catalog-core/types.js';
import slots from '../catalog/slots/assets.json' with {type:'json'};
import placement from '../catalog/ia/assets.json' with {type:'json'};
import pattern from '../catalog/fills/foundry/assets.pattern.json' with {type:'json'};
import { importLucide, LUCIDE_SOURCE } from '../importers/lucide.js';
import { importPhosphor, PHOSPHOR_SOURCE } from '../importers/phosphor.js';
import { IDENTITY_RULES, identityRuleDefinition } from './identity.js';
/** Extend the token catalog without changing its loader or the public entrypoint. */
export function withAssetCatalog(catalog:CatalogData):CatalogData {
 /** Brand rows offer nothing: their values are authored Custom fills (the identity-kit Generate starter), never a Foundry fill. */
 const assetFills=[pattern] as unknown as FillDoc[];
 return {...catalog,slots:[...catalog.slots.filter(slot=>slot.layer!=='assets'),...slots as unknown as Slot[]],placements:[...catalog.placements.filter(row=>row.layer!=='assets'),placement as Placement],sources:[...catalog.sources.filter(source=>!['lucide','phosphor'].includes(source.id)),LUCIDE_SOURCE,PHOSPHOR_SOURCE],fills:[...catalog.fills.filter(fill=>!fill.assets),...assetFills,...importLucide(),...importPhosphor()],rules:[...(catalog.rules??[]).filter(rule=>!IDENTITY_RULES.includes(rule.id as typeof IDENTITY_RULES[number])),...IDENTITY_RULES.map(id=>identityRuleDefinition(id)!)]};
}
