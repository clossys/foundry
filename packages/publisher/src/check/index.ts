/**
 * The Publisher check API (export only): the page option checks and the catalog readers they take, for callers outside
 * this package. The Producer's `publisher.check` and `publisher.release` actions load the built `dist/check/index.js`
 * from the installed package and run these over a consumer's page records.
 */
export {
  INSTANCE_KEY, checkLayoutUnits, checkPageOption, inlineCopyFindings,
  type DesignerIds, type LayoutContract, type PageContract, type PageFinding, type PageOptionContent, type PlacedSection, type RoleContract,
} from "./page-sections-instance.js";
export {
  PUBLISHER_TREES, designerPackageDir, loadDefaults, loadDesignerCatalog, reservedSlugs, slotContract,
  type CandidateFile, type DesignerCatalog, type LayoutSlot, type PageSlot, type SlotContract,
} from "../catalog/ia/tree.js";
export { LAYOUT_ENGINE_MAP, checkLayoutEngineMap, layoutEngineFor, pageLayoutEngine, type LayoutEngineChoice, type LayoutEngineMap } from "../engines/layout-slots.js";
