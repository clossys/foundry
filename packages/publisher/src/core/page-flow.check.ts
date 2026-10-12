import { checkPageFlow, sectionWeight, resolveActionEmphasis } from "./index.js";
import type { SectionedViewDocument, ResolvedSectionedViewDocument, SectionWeight } from "./index.js";
const authored: SectionedViewDocument = { id: "page", sectionGroundRhythm: "view", sections: [{ id: "band", kind: "content-section", heading: { id: "example.heading" }, block: { type: "items", recipe: "features", items: [] } }] };
const resolved: ResolvedSectionedViewDocument = { id: "page", resolutions: [], sections: [{ id: "band", kind: "content-section", ground: "base", size: "standard", layout: "split-end", heading: "Example", block: { type: "items", arrangement: "rows", order: "none", reveal: "all", treatment: "rule", scale: "item", items: [] } }] };
const authoredWeight: SectionWeight = sectionWeight(authored.sections[0]!);
const resolvedWeight: SectionWeight = sectionWeight(resolved.sections[0]!);
resolveActionEmphasis(authored.sections[0]!, 0);
resolveActionEmphasis(resolved.sections[0]!, 0);
checkPageFlow(authored, { callToAction: { href: "/start" } });
// @ts-expect-error weights are derived; callers cannot pass an authored weight override.
sectionWeight({ id: "band", kind: "content-section", heading: { id: "example.heading" }, weight: "A" });
void [authoredWeight, resolvedWeight];
