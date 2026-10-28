import type { CatalogData, FillDoc, Placement, Slot } from '../catalog-core/types.js';
import slots from '../catalog/slots/assets.json' with {type:'json'};
import placement from '../catalog/ia/assets.json' with {type:'json'};
import lockup from '../catalog/fills/foundry/assets.lockup.json' with {type:'json'};
import mark from '../catalog/fills/foundry/assets.mark.json' with {type:'json'};
import favicon from '../catalog/fills/foundry/assets.favicon.json' with {type:'json'};
import app from '../catalog/fills/foundry/assets.app-icon.json' with {type:'json'};
import image from '../catalog/fills/foundry/assets.image.json' with {type:'json'};
import video from '../catalog/fills/foundry/assets.video.json' with {type:'json'};
import pattern from '../catalog/fills/foundry/assets.pattern.json' with {type:'json'};
import { importLucide, LUCIDE_SOURCE } from '../importers/lucide.js';
import { importPhosphor, PHOSPHOR_SOURCE } from '../importers/phosphor.js';
import { importOpenPropsImageRatio, OPEN_PROPS_SOURCE } from '../importers/open-props-image-ratio.js';
import { IDENTITY_RULES, identityRuleDefinition } from './identity.js';
/** Extend the token catalog without changing its loader or the public entrypoint. */
export function withAssetCatalog(catalog:CatalogData):CatalogData {
 const assetFills=[lockup,mark,favicon,app,pattern,image,video] as unknown as FillDoc[];
 return {...catalog,slots:[...catalog.slots.filter(slot=>slot.layer!=='assets'),...slots as unknown as Slot[]],placements:[...catalog.placements.filter(row=>row.layer!=='assets'),placement as Placement],sources:[...catalog.sources.filter(source=>!['lucide','phosphor','open-props'].includes(source.id)),LUCIDE_SOURCE,PHOSPHOR_SOURCE,OPEN_PROPS_SOURCE],fills:[...catalog.fills.filter(fill=>!fill.assets),...assetFills,...importLucide(),...importPhosphor(),...importOpenPropsImageRatio()],rules:[...(catalog.rules??[]).filter(rule=>!IDENTITY_RULES.includes(rule.id as typeof IDENTITY_RULES[number])),...IDENTITY_RULES.map(id=>identityRuleDefinition(id)!)]};
}
