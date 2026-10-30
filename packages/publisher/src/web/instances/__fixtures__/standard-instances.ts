import { LAYOUT_LEAVES } from "../../../layouts/resolve.js";
import { FORMAT_LEAVES } from "../../../formats/index.js";
import type { ConsumerInstanceLibrary, FlowInstanceBinding as InstanceBinding, InstanceRegistries, SectionFill } from "../../../core/instance-binding.js";

const section = (leaf: SectionFill["section"], ref: string, config = "default"): SectionFill => ({ section: leaf, config, content: { title: { kind: "copy", ref } } });
const pages = [
  ["home", "Home", "/"], ["about", "About", "/about"], ["contact", "Contact", "/contact"],
  ["terms", "Terms", "/terms"], ["privacy", "Privacy", "/privacy"], ["sign-in", "Sign in", "/sign-in"],
  ["not-found", "Not found", undefined], ["error", "Error", undefined],
] as const;
/** Standard v1 inventory identity only; these v2 assemblies are fixtures, not L4 adoption. */
export const STANDARD_INSTANCE_FIXTURES: readonly InstanceBinding[] = pages.map(([id, label, path]): InstanceBinding => {
  const focus = ["sign-in", "not-found", "error"].includes(id);
  const document = id === "terms" || id === "privacy";
  const fill = section(id === "sign-in" ? "sections.form" : id === "not-found" ? "sections.empty-state" : "sections.error-state", `copy.${id}.title`, id);
  return {
    instanceId: `standard.${id}`, label, ...(path === undefined ? {} : { path }), surface: "site", packIds: ["pack.standard-website"], context: { medium: "web" },
    format: "web.page.responsive",
    frame: { leaf: "frames.site-shell", config: id === "sign-in" ? "front-door" : "site" },
    layout: { leaf: id === "contact" ? "layouts.split" : "layouts.stack", config: id === "home" ? "stack.landing" : id === "contact" ? "split.default" : document ? "stack.document" : focus ? "stack.focus" : "stack.default" },
    fills: id === "contact" ? { lead: [section("sections.page-header", "copy.contact.title")], start: [section("sections.content", "copy.contact.details")], end: [section("sections.form", "copy.contact.form", "contact")] }
      : focus ? { body: [fill] }
      : { lead: [section(id === "home" ? "sections.hero" : "sections.page-header", `copy.${id}.title`)], body: [section(document ? "sections.article" : "sections.content", `copy.${id}.body`)] },
    ...(id === "sign-in" ? { states: ["loading", "empty", "error"] } : {}),
  };
});
/** Actual layout and format registries only. Frame/section projections stay absent. */
export const FIXTURE_INSTANCE_REGISTRIES: InstanceRegistries = { formats: FORMAT_LEAVES, frames: [], layouts: LAYOUT_LEAVES, sections: [], tokens: [] };
/** Empty on purpose. Missing implementations, source, and content remain real refusals. */
export const FIXTURE_INSTANCE_LIBRARY: ConsumerInstanceLibrary = { id: "fixture-library", role: "consumer", resolveFill: () => undefined, resolveContent: () => undefined };
export const FIXTURE_BREAKPOINTS = { "tokens.breakpoint.mobile": 375, "tokens.breakpoint.mobile-lg": 480, "tokens.breakpoint.tablet": 768, "tokens.breakpoint.tablet-lg": 1024, "tokens.breakpoint.desktop": 1280, "tokens.breakpoint.wide": 1440 } as const;
