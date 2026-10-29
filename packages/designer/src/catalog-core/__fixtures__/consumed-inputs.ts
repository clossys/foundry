import { loadCatalog, loadComponentRegistry } from "../index.js";
import { completedCatalogLibrary } from "./completed-catalog-library.js";
import { emittedTokenProperties } from "../emit.js";
import { resolve } from "../api.js";
import { loadCatalogBundles, installedHeadlessLibrary } from "../../catalog-bundles.js";
import { loadComponentCompositionRules } from "../component-compositions.js";
import { planComponentDefaults } from "../component-defaults.js";
import { applyDecisions } from "../../library-cli/apply-decisions.js";
import { resolveComponents } from "../resolve-components.js";
import type { CompositeLibraryData } from "../types.js";

export const consumedInputLeaves = ["text-field", "search-field", "tag-group", "toolbar", "link", "native-action", "toast", "status-mark", "grid-list"] as const;
/** A consumer requests the consumed input/feedback closure; parked controls are not installed as incidental defaults. */
export function consumedInputFixture() {
  const values = loadCatalog(), bundles = loadCatalogBundles(), registry = loadComponentRegistry();
  const source = { id:"consumed-inputs",kind:"consumer" as const,author:"consumer" as const,license:"MIT" };
  const library = completedCatalogLibrary(values, source, "2026-10-29");
  const resolvedValues = resolve({catalog:values,library});
  const literal = (id:string):string => {
    let member=resolvedValues.members[id]!;
    while(member.alias.light) member=resolvedValues.members[member.alias.light]!;
    return member.css.light;
  };
  const tokens = Object.fromEntries([...emittedTokenProperties(resolvedValues)].map(([id,row]) => [id,{property:row.property,light:literal(id)}]));
  const assets = [...new Set(Object.values(resolvedValues.members).filter(row => row.slot.startsWith("assets.")).map(row=>row.slot))];
  const catalog = {slots:registry.slots,fills:bundles.componentFills,rules:loadComponentCompositionRules()};
  const slots = new Set(consumedInputLeaves.map(leaf=>`components.${leaf}`));
  for (const slot of slots) {
    const offer = catalog.fills.find(doc=>doc.$extensions["com.clossys.fill"].slot===slot && doc.$extensions["com.clossys.fill"].source==="shadcn@aria");
    const descriptor = offer && Object.values(offer.components)[0];
    for (const dependency of descriptor ? [...descriptor.composes,...descriptor.reads.components] : []) slots.add(dependency);
  }
  const plan = planComponentDefaults({catalog,slots:[...slots],tokens,assets,bundles:bundles.sourceBundles,installedRac:installedHeadlessLibrary(),preference:["shadcn@aria","foundry"],picks:{"components.button":"shadcn@aria"}});
  const empty:CompositeLibraryData={source,adoptedAt:"2026-10-29",values:{fills:library.fills},components:{fills:[],files:[]}};
  const adopted=applyDecisions({values,components:catalog},empty,plan.decisions,{bundles:bundles.sourceBundles});
  const profile=resolveComponents({catalog,library:{...adopted.components,source,adoptedAt:"2026-10-29"},values:{tokens,assets},evidence:{observations:{},installedRac:installedHeadlessLibrary()}});
  return {values,resolvedValues,catalog,bundles,plan,adopted,profile};
}
