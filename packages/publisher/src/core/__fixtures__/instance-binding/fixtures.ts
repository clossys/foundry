import { LAYOUT_LEAVES } from "../../../layouts/index.js";
import { FORMAT_LEAVES } from "../../../formats/index.js";
import type { ContentRef, ConsumerInstanceFill, ConsumerInstanceLibrary, FlowInstanceBinding as InstanceBinding, InstanceRegistries } from "../../instance-binding.js";

type Mutable<T> = T extends readonly (infer U)[] ? Mutable<U>[] : T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T;
export const CLEAN_SOURCE = 'export function Layout() { return <div className="grid gap-lg" style={{gap: "var(--spacing-lg)"}} />; }';
export const key = (leaf: string, config?: string) => JSON.stringify([leaf, config ?? null]);
export function instanceFixture() {
  const binding: Mutable<InstanceBinding> = {
    instanceId: "example.home", label: "Home", path: "/", surface: "site", packIds: ["pack.example"],
    format: "web.page.responsive",
    context: { medium: "web" }, frame: { leaf: "frames.site-shell", config: "site" },
    layout: { leaf: "layouts.stack", config: "stack.landing" },
    fills: {
      lead: [{ section: "sections.hero", config: "default", content: { title: { kind: "copy", ref: "copy.title" } } }],
      body: [{ section: "sections.content", config: "default", content: { title: { kind: "copy", ref: "copy.title" } } }],
    }, states: ["loading"],
  };
  const section = (id: "sections.hero" | "sections.content" | "sections.stats") => ({
    id, status: "stable" as const,
    contract: { surface: "both" as const, configs: ["default"], slots: [{ name: "title", type: "copy" as const, required: true }], states: ["loading"], container: "adaptive" as const },
  });
  const registries: Mutable<InstanceRegistries> = {
    formats: structuredClone(FORMAT_LEAVES) as Mutable<InstanceRegistries>["formats"],
    frames: [
      { id: "frames.site-shell", status: "stable", contract: { surface: "site", configs: ["site", "minimal"] } },
      { id: "frames.app-shell", status: "stable", contract: { surface: "app", configs: ["page"] } },
    ],
    layouts: structuredClone(LAYOUT_LEAVES) as Mutable<InstanceRegistries>["layouts"],
    sections: [section("sections.hero"), section("sections.content"), section("sections.stats")],
    tokens: [{ id: "tokens.spacing.lg", property: "--spacing-lg" }, { id: "tokens.breakpoint.tablet", property: "--breakpoint-tablet" }],
  };
  const fills = new Map<string, Mutable<ConsumerInstanceFill>>();
  const put = (leaf: string, config: string | undefined, extra: Partial<Mutable<ConsumerInstanceFill>> = {}) => {
    const fill: Mutable<ConsumerInstanceFill> = { library: "consumer", leaf, ...(config === undefined ? {} : { config }), headings: [], states: ["loading"], ...extra };
    fills.set(key(leaf, config), fill); return fill;
  };
  put("frames.site-shell", "site", { groundRead: "leadGround", headerGround: "glass" });
  put("frames.site-shell", "minimal", { groundRead: "leadGround", headerGround: "opaque" });
  put("frames.app-shell", "page", { groundRead: "leadGround", headerGround: "opaque", headings: [1] });
  put("layouts.stack", "stack.landing", { leadGround: "base", renderer: { entry: "Layout.tsx", files: { "Layout.tsx": CLEAN_SOURCE } } });
  put("sections.hero", "default", { headings: [1], bandGround: "base" });
  put("sections.content", "default", { headings: [2], bandGround: "base" });
  put("sections.stats", "default", { headings: [2], bandGround: "base" });
  const content = new Map<string, ContentRef>([["copy.title", { kind: "copy", ref: "copy.title" }]]);
  const library: ConsumerInstanceLibrary = {
    id: "consumer", role: "consumer",
    resolveFill: (leaf, config) => fills.get(key(leaf, config)),
    resolveContent: reference => content.get(reference.ref),
  };
  return { binding, registries, library, fills, content, put };
}
/** Exercises the actual registered bento preset with consumer-owned section fills. */
export function tileFixture() {
  const fixture = instanceFixture();
  fixture.binding.layout = { leaf: "layouts.bento", config: "bento.default" };
  fixture.binding.fills = { lead: fixture.binding.fills.lead!, tiles: Array.from({ length: 3 }, () => ({ section: "sections.stats" as const, config: "default", span: "1x1" as const, content: { title: { kind: "copy" as const, ref: "copy.title" } } })) };
  fixture.put("layouts.bento", "bento.default", { leadGround: "base", renderer: { entry: "Layout.tsx", files: { "Layout.tsx": CLEAN_SOURCE } } });
  return fixture;
}

/** Split keeps the first hero in its start slot when the optional lead is absent. */
export function splitFixture() {
  const fixture = instanceFixture();
  fixture.binding.layout = { leaf: "layouts.split", config: "split.default" };
  fixture.binding.fills = { start: fixture.binding.fills.lead!, end: fixture.binding.fills.body! };
  fixture.put("layouts.split", "split.default", { leadGround: "base", renderer: { entry: "Layout.tsx", files: { "Layout.tsx": CLEAN_SOURCE } } });
  return fixture;
}
