import sectionContracts from "./section-contracts.json" with { type: "json" };
import { STANDARD_INSTANCE_FIXTURES, FIXTURE_BREAKPOINTS } from "../../instances/__fixtures__/standard-instances.js";
import { FORMAT_LEAVES } from "../../../formats/index.js";
import { LAYOUT_LEAVES } from "../../../layouts/resolve.js";
import type { BindingSectionLeaf, ConsumerInstanceFill, ConsumerInstanceLibrary, ContentRef, FlowInstanceBinding as InstanceBinding, InstanceRegistries, LayoutRendererSource, SectionFill } from "../../../core/instance-binding.js";

/** Fixture projections only. These are not Designer registrations or F5/S4 qualification. */
export const STANDARD_PACK_FIXTURE = { fixture: true, libraryLabel: "fixture library", staticQualification: "unverified", sectionSourceHead: sectionContracts.sourceHead } as const;
const sections: readonly BindingSectionLeaf[] = sectionContracts.sections.map(section => ({
  id: section.id as BindingSectionLeaf["id"], status: "draft", contract: {
    surface: section.contract.surface as "both",
    // No adopted section config is asserted: the fixture uses the IA's unconfigured leaf.
    configs: [], slots: section.contract.slots as BindingSectionLeaf["contract"]["slots"],
  },
}));
const fill = (source: SectionFill, id: string): SectionFill => {
  const contract = sections.find(section => section.id === source.section)!;
  const content = Object.fromEntries(contract.contract.slots.filter(slot => slot.required).map(slot => [slot.name, { kind: slot.type, ref: `placeholder.${id}.${slot.name}` }]));
  return { section: source.section, content };
};
/** Preserve the P-C fixture and derive a separately labeled pack fixture with actual typed slots. */
export const STANDARD_PACK_INSTANCES: readonly InstanceBinding[] = STANDARD_INSTANCE_FIXTURES.map(source => {
  // M1 example replaces the old Auth fixture with an index; Auth is a later menu offer.
  const binding: InstanceBinding = source.instanceId === "standard.sign-in" ? { ...source, instanceId: "standard.showcase", label: "Showcase", path: "/showcase", frame: { leaf: "frames.site-shell", config: "site" }, layout: { leaf: "layouts.stack", config: "stack.index" }, fills: { lead: [{ section: "sections.page-header", content: {} }], body: [{ section: "sections.resource-list", content: {} }] } } : source;
  const fills = Object.fromEntries(Object.entries(binding.fills).map(([slot, values]) => [slot, values.map((value, index) => fill(value, `${binding.instanceId}.${slot}.${index}`))]));
  if (["standard.sign-in", "standard.not-found", "standard.error"].includes(binding.instanceId)) fills.lead = [fill({ section: "sections.page-header", content: {} }, `${binding.instanceId}.lead.0`)];
  // States remain unknown until actual section state contracts and implementations are available.
  const { states: _states, ...structure } = binding;
  return { ...structure, fills };
});

export const STANDARD_PACK_REGISTRIES: InstanceRegistries = {
  // Leaf identity comes from Frames IA; config names are the public Publisher SiteSurfaceKind projection.
  frames: [{ id: "frames.site-shell", status: "draft", contract: { surface: "site", configs: ["site", "front-door"] } }, { id: "frames.app-shell", status: "draft", contract: { surface: "app", configs: [] } }],
  formats: FORMAT_LEAVES, layouts: LAYOUT_LEAVES, sections,
  tokens: [
    { id: "tokens.spacing.lg", property: "--spacing-lg" },
    { id: "tokens.content-size.wide", property: "--ui-width-wide-max" },
    { id: "tokens.content-size.content", property: "--ui-width-content-max" },
    { id: "tokens.content-size.prose", property: "--ui-width-prose-max" },
    { id: "tokens.content-size.form", property: "--ui-width-form-max" },
    ...Object.keys(FIXTURE_BREAKPOINTS).map(id => ({ id: id as `tokens.breakpoint.${string}`, property: `--breakpoint-${id.slice("tokens.breakpoint.".length)}` })),
  ],
};

/** Source bytes come from the actual local layout closure, supplied by the fixture host. */
export function createStandardPackLibrary(renderers: Readonly<Partial<Record<InstanceBinding["layout"]["leaf"], LayoutRendererSource>>>): ConsumerInstanceLibrary {
  const id = "standard-pack-fixture-library";
  const implementations = new Map<string, ConsumerInstanceFill>();
  const refs = new Map<string, ContentRef>();
  const key = (leaf: string, config?: string) => JSON.stringify([leaf, config ?? null]);
  for (const binding of STANDARD_PACK_INSTANCES) {
    implementations.set(key(binding.frame.leaf, binding.frame.config), { library: id, leaf: binding.frame.leaf, config: binding.frame.config, headings: [], states: [], groundRead: "leadGround", headerGround: "opaque" });
    implementations.set(key(binding.layout.leaf, binding.layout.config), { library: id, leaf: binding.layout.leaf, config: binding.layout.config, headings: [], states: [], leadGround: "base", renderer: renderers[binding.layout.leaf] });
    for (const section of Object.values(binding.fills).flat()) {
      implementations.set(key(section.section), { library: id, leaf: section.section, headings: section.section === "sections.hero" || section.section === "sections.page-header" ? [1] : [], states: [], bandGround: "base" });
      for (const ref of Object.values(section.content)) refs.set(ref.ref, ref);
    }
  }
  return { id, role: "consumer", resolveFill: (leaf, config) => implementations.get(key(leaf, config)), resolveContent: ref => refs.get(ref.ref) };
}
