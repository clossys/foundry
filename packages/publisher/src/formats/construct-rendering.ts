import type { ReactNode } from "react";
import { emittedTokenProperties, prepareRuntimeAssembly, runtimeCellKey, runtimeHash, runtimeSnapshot } from "@clossys/designer/catalog";
import type { RuntimeAssemblyInput, RuntimeCell, RuntimeRenderInput } from "@clossys/designer/catalog";
import { surfaceRuntimeCallbacks, surfaceRuntimeRenderers, SURFACE_RUNTIME_POINTER } from "@clossys/designer/frames";
import { TOKENS } from "@clossys/designer/tokens";
import type { ContentMapConstructs } from "../content-map/contract.js";
import type { SectionFill } from "../core/instance-binding.js";
import type { ComposeDocument, SlotSpec } from "../core/types.js";
import { renderSlidesDeck } from "../slides/renderSlidesDeck.js";
import type { RenderSlidesResult } from "../slides/types.js";
import { getFormatLeaf } from "./index.js";

/** Rendering capability is distinct from page admission and delivery/export status.
 * The source remains the content map's slot-addressed SectionFill, without another registry. */
export const CONSTRUCT_FORMAT_RENDERERS = Object.freeze([
  Object.freeze({ format: "web.page.responsive" as const, definition: getFormatLeaf("web.page.responsive")!, renderer: SURFACE_RUNTIME_POINTER }),
  Object.freeze({ format: "deck.16x9" as const, definition: getFormatLeaf("deck.16x9")!, renderer: Object.freeze({ module: "@clossys/publisher/slides", export: "renderSlidesDeck" }) }),
]);
export type ConstructRenderFormat = typeof CONSTRUCT_FORMAT_RENDERERS[number]["format"];
export interface RenderedConstruct { readonly key: string; readonly construct: SectionFill }
export interface ConstructWebResult { readonly format: "web.page.responsive"; readonly sections: readonly (RenderedConstruct & { readonly node: ReactNode })[] }
export interface ConstructDeckResult { readonly format: "deck.16x9"; readonly sections: readonly RenderedConstruct[]; readonly deck: RenderSlidesResult }
export interface PreparedConstructRendering {
  readonly cells: readonly RuntimeCell[];
  readonly sourceHash: string;
  readonly runtimeHash: string;
  render(format: "web.page.responsive", cell: RuntimeCell): ConstructWebResult;
  render(format: "deck.16x9", cell: RuntimeCell): ConstructDeckResult;
}

function fail(message: string): never { throw new TypeError(`construct rendering: ${message}`); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function header(fill: SectionFill): void {
  if (Object.keys(fill).some(key => !["section", "config", "members", "content"].includes(key)) || fill.section !== "sections.section-header") fail("unsupported construct capability");
  if (fill.config !== undefined && fill.config !== "default" && !/^level-[2-6]$/.test(fill.config)) fail("unsupported header config");
  for (const [axis, value] of Object.entries(fill.members ?? {})) {
    if (axis === "align" ? !["start", "center"].includes(value) : axis === "density" ? !["compact", "standard", "display"].includes(value) : true) fail("unsupported header member");
  }
  if (!fill.content.heading || Object.entries(fill.content).some(([slot, ref]) => !["heading", "eyebrow", "description"].includes(slot) || ref.kind !== "copy" || Object.keys(ref).sort().join(",") !== "kind,ref" || !ref.ref.trim())) fail("unsupported header content reference");
}

/** Pin the manifest's executable seam to the library registry before installing
 * package callbacks. A caller callback cannot stand in for the named renderer. */
function nativeCallbacks(input: RuntimeAssemblyInput<ReactNode>): Record<string, (input: RuntimeRenderInput<ReactNode>) => ReactNode> {
  const owner = input.engine.surfaceOptions?.packages?.find(row => row.module === SURFACE_RUNTIME_POINTER.module && row.values.includes(SURFACE_RUNTIME_POINTER.export));
  if (!owner) fail("package renderer artifact evidence is unavailable");
  const leaves = input.ports.manifest.fills.map(fill => {
    const renderer = fill.renderer, source = renderer.source;
    const body = `import { ${SURFACE_RUNTIME_POINTER.export} } from ${JSON.stringify(SURFACE_RUNTIME_POINTER.module)};\nexport default ${SURFACE_RUNTIME_POINTER.export}[${JSON.stringify(fill.leaf)}].render;\n`;
    const artifact = source.dependencies["@clossys/designer"];
    if (!surfaceRuntimeRenderers[fill.leaf] || renderer.id !== `package:${fill.leaf}` || Object.keys(source.files).length !== 1 || source.files[source.entry] !== body || Object.keys(source.dependencies).join(",") !== "@clossys/designer" || artifact?.version !== owner.version || artifact.artifact !== `sha256:${owner.artifactSha256}`) fail("package renderer identity differs");
    return fill.leaf;
  });
  return surfaceRuntimeCallbacks([...new Set(leaves)]);
}

function slide(key: string, fill: SectionFill, selected: RuntimeRenderInput<ReactNode>, tablet: number): ComposeDocument {
  const display = fill.members?.density === "display", standard = fill.members?.density === "standard";
  const densityRole = display ? (selected.cell.width >= tablet ? "--text-display-l" : "--text-display-m") : standard ? "--text-h2" : "--text-h3";
  const typography = { eyebrow: display ? "--text-body-s" : "--text-caption", heading: densityRole, description: display ? "--text-body-l" : "--text-body" };
  const slots: SlotSpec[] = (["eyebrow", "heading", "description"] as const).filter(slot => fill.content[slot]).map((slot, index) => ({
    key: slot, element: slot === "description" ? "body" : slot === "heading" ? "heading" : "eyebrow", required: true,
    frame: { x: .1, y: .15 + index * .23, w: .8, h: .2 }, align: fill.members?.align === "center" ? "center" : "start",
    style: { typography: typography[slot], color: slot === "heading" ? "--color-ink-primary" : slot === "description" ? "--color-ink-secondary" : "--color-ink-muted" },
  }));
  return { id: key, channel: "slides", template: fill.section, meta: { channel: "slides", aspect: "16:9" }, layout: { slots }, bindings: slots.map(slot => ({ slot: slot.key, copyId: fill.content[slot.key]!.ref })) };
}

/** Run native selection/content/source gates once; format adapters consume only
 * the inputs that assembly delivered to the actual package Section renderer.
 * First consumed cross-format capability: text-only section-header constructs. */
export function prepareConstructRendering(constructs: ContentMapConstructs, input: RuntimeAssemblyInput<ReactNode>): PreparedConstructRendering {
  const source = freeze(runtimeSnapshot(constructs)), rows: { key: string; path: string; construct: SectionFill }[] = [];
  if (Object.keys(source).length !== Object.keys(input.binding.sections).length) fail("canonical construct slots differ");
  for (const [slot, fills] of Object.entries(source)) {
    if (!slot.trim() || !Array.isArray(fills) || fills.length !== input.binding.sections[slot]?.length) fail("canonical construct placement differs");
    fills.forEach((fill, index) => {
      header(fill);
      const selected = input.binding.sections[slot]![index]!;
      if (selected.children !== undefined || selected.leaf !== fill.section || selected.config !== (fill.config ?? null) || runtimeHash([...selected.members].sort()) !== runtimeHash(Object.entries(fill.members ?? {}).map(([axis, value]) => `${axis}.${value}`).sort()) || runtimeHash(selected.content) !== runtimeHash(fill.content)) fail("canonical construct selection differs");
      rows.push({ key: JSON.stringify([slot, index]), path: `sections.${slot}.${index}`, construct: fill });
    });
  }
  if (!rows.length) fail("at least one construct is required");
  const callbacks = nativeCallbacks(input), captured = new Map<string, { node: ReactNode; input: RuntimeRenderInput<ReactNode> }>();
  const renderers = Object.fromEntries(Object.entries(callbacks).map(([id, render]) => [id, (current: RuntimeRenderInput<ReactNode>) => {
    const node = render(current);
    if (rows.some(row => row.path === current.path)) {
      for (const content of Object.values(current.content)) if (typeof content.value !== "string" || !content.value.trim()) fail("header copy must resolve to nonempty Writer text");
      captured.set(current.path, { node, input: current });
    }
    return node;
  }]));
  const prepared = prepareRuntimeAssembly({ ...input, ports: { ...input.ports, renderers } });
  if (prepared.status !== "ready") throw new TypeError(`construct rendering: native runtime ${prepared.status}: ${prepared.findings.join("; ")}`);
  const cells = prepared.assembly.snapshot.cells;
  const documentId = input.binding.id;
  const render = (format: ConstructRenderFormat, cell: RuntimeCell): ConstructWebResult | ConstructDeckResult => {
    if (!CONSTRUCT_FORMAT_RENDERERS.some(row => row.format === format)) fail("unsupported format");
    if (!cells.some(bound => runtimeCellKey(bound) === runtimeCellKey(cell))) fail("cell outside native runtime matrix");
    captured.clear(); prepared.assembly.render(cell);
    const sections = rows.map(row => {
      const current = captured.get(row.path); if (!current) fail("native renderer omitted a construct");
      return { ...row, ...current! };
    });
    const adapters = {
      "web.page.responsive": (): ConstructWebResult => Object.freeze({ format: "web.page.responsive", sections: Object.freeze(sections.map(({ key, construct, node }) => Object.freeze({ key, construct, node }))) }),
      "deck.16x9": (): ConstructDeckResult => {
        const profile = sections[0]!.input.profile.values;
        // The existing SVG engine accepts the shipped role vocabulary. Open
        // scale outputs are not extra overrides to that renderer's contract.
        const emitted = [...emittedTokenProperties(profile)];
        const tokenOverrides = Object.fromEntries(emitted.filter(([, output]) => TOKENS[output.property]?.brandable === true).map(([id, output]) => [output.property, profile.members[id]!.css[cell.theme as "light" | "dark"] ?? profile.members[id]!.css.light]));
        const slides = sections.map(row => slide(row.key, row.construct, row.input, prepared.assembly.snapshot.breakpoints["tokens.breakpoint.tablet"]!));
        for (const role of new Set(slides.flatMap(document => document.layout!.slots.map(slot => slot.style!.typography!)))) {
          const token = TOKENS[role as keyof typeof TOKENS], output = emitted.find(([, output]) => output.property === role);
          if (!token || !output) fail("selected typography role is unavailable");
          const selected = profile.members[output![0]]!.css[cell.theme as "light" | "dark"] ?? profile.members[output![0]]!.css.light;
          if (!token.brandable && selected !== token.value) fail("selected structural typography is unsupported by the Slides renderer");
        }
        const texts = new Map<string, string>();
        for (const row of sections) for (const content of Object.values(row.input.content)) {
          const previous = texts.get(content.reference.ref);
          if (previous !== undefined && previous !== content.value) fail("one copy reference resolved inconsistently");
          texts.set(content.reference.ref, content.value as string);
        }
        const deck = renderSlidesDeck({ id: documentId, slides }, { resolveCopyId: id => texts.get(id), tokenOverrides });
        return freeze({ format: "deck.16x9", sections: rows.map(({ key, construct }) => ({ key, construct })), deck });
      },
    } satisfies Record<ConstructRenderFormat, () => ConstructWebResult | ConstructDeckResult>;
    return adapters[format]();
  };
  return Object.freeze({ cells, sourceHash: runtimeHash(source), runtimeHash: prepared.assembly.snapshot.hash, render }) as PreparedConstructRendering;
}
