/**
 * Static render of a SitePlan through Designer's own package runtime renderers
 * (`surfaceRuntimeRenderers`), inside the consumer's selected component library.
 * The renderer supplies no markup, class or text of its own beyond the document shell
 * (head metadata, stylesheet link and the theme attribute script).
 */
import { createElement, Fragment, type ReactNode } from "react";
import { agentModule } from "../server/cells.js";
import type { BuildReport, PlannedPage, PlannedSurface } from "./site-plan.js";

type Renderer = { render(input: unknown): ReactNode };
export interface SiteRuntime {
  /** Designer's registered renderers, keyed by leaf. */
  readonly renderers: Readonly<Record<string, Renderer>>;
  /** Wraps a node in every provider the selected components read (package and selected-runtime graphs). */
  readonly wrap: (node: ReactNode) => ReactNode;
  readonly profile: unknown;
  readonly consumer: string;
  readonly locale: string;
  readonly hash: (value: unknown) => string;
  /** The consumer's Designer theme is applied, so Foundry's unbranded dev notice must not show. */
  readonly brandBound?: boolean;
}
export interface RenderedPage { readonly id: string; readonly path: string; readonly html: string }

const HOST_BODY_CLASS = "m-0 font-body";
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** Light/dark from `?theme=`, else the OS preference, on both theme hooks the stylesheets use. */
export const THEME_SCRIPT = "(()=>{const q=new URLSearchParams(location.search).get('theme');const t=q==='dark'||q==='light'?q:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');const r=document.documentElement;r.dataset.theme=t;r.classList.toggle('dark',t==='dark');r.style.colorScheme=t;})()";

async function staticMarkup(node: ReactNode): Promise<{ html: string; errors: string[] }> {
  const { prerenderToNodeStream } = await import("react-dom/static");
  const errors: string[] = [];
  const { prelude } = await prerenderToNodeStream(node, { onError: error => { errors.push(error instanceof Error ? error.message : String(error)); } });
  let html = "";
  for await (const chunk of prelude) html += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  return { html, errors };
}

function surfaceInput(runtime: SiteRuntime, surface: PlannedSurface, path: string, slots: Readonly<Record<string, readonly ReactNode[]>>) {
  const content: Record<string, unknown> = {}, refs: Record<string, unknown> = {};
  for (const [name, row] of Object.entries(surface.content)) {
    const reference = { kind: row.kind, ref: row.ref };
    content[name] = { reference, value: row.value, hash: runtime.hash(row.value) };
    refs[name] = reference;
  }
  const kind = surface.leaf.startsWith("frames.") ? "frame" : "section";
  return {
    locale: runtime.locale, path,
    fill: { kind, library: runtime.consumer, fill: surface.fill, leaf: surface.leaf, config: surface.config, slots: [...surface.slots].sort(), members: [...surface.members].sort(), states: ["default"], renderer: { id: `package:${surface.leaf}` } },
    cell: { theme: "light", state: "default", width: 1440 },
    selection: { leaf: surface.leaf, fill: surface.fill, config: surface.config, members: [...surface.members], content: refs },
    content, slots, profile: runtime.profile,
  };
}

function renderSurface(runtime: SiteRuntime, surface: PlannedSurface, path: string, slots: Readonly<Record<string, readonly ReactNode[]>> = {}): ReactNode {
  const renderer = runtime.renderers[surface.leaf];
  if (!renderer) throw new Error(`${surface.leaf}: no package runtime renderer`);
  return renderer.render(surfaceInput(runtime, surface, path, slots));
}

/** Visible text of rendered markup, for the dropped-copy check. */
export function visibleText(html: string): string {
  return html.replace(/<(script|style)[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}
const squash = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * Render each page: every planned Section is first rendered alone, so one refusal empties only its
 * own slot (and is reported) instead of the page. Bound Writer texts that never reach the output
 * are reported as unrendered keys.
 */
export async function renderSite(pages: readonly PlannedPage[], runtime: SiteRuntime, report: BuildReport, stylesheet: string): Promise<RenderedPage[]> {
  const rendered: RenderedPage[] = [];
  for (const page of pages) {
    const sections: ReactNode[] = [];
    const texts: { key: string; text: string }[] = [];
    for (const [index, section] of page.sections.entries()) {
      const path = `sections.main.${index}`;
      let node: ReactNode;
      try {
        const header = section.header ? renderSurface(runtime, section.header, `${path}.header`) : null;
        node = createElement(Fragment, { key: section.slot }, header, renderSurface(runtime, section, path));
        const trial = await staticMarkup(runtime.wrap(node));
        if (trial.errors.length) throw new Error(trial.errors[0]);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        report.emptySlots.push({ page: page.id, slot: section.slot, section: section.leaf, reason: `renderer refused: ${reason}` });
        for (const text of section.texts) report.unboundKeys.push({ page: page.id, key: text.key, reason: `${section.leaf} did not render` });
        continue;
      }
      sections.push(node);
      texts.push(...section.texts);
      const row = report.pages.find(item => item.id === page.id);
      if (row && !row.sections.includes(section.leaf)) row.sections.push(section.leaf);
    }
    let body: string;
    if (page.frame) {
      try {
        const result = await staticMarkup(runtime.wrap(renderSurface(runtime, page.frame, "frame", { main: sections })));
        if (result.errors.length) throw new Error(result.errors[0]);
        body = result.html;
        texts.push(...page.frame.texts);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        report.emptySlots.push({ page: page.id, slot: `${page.id}/frame`, section: page.frame.leaf, reason: `renderer refused: ${reason}` });
        body = (await staticMarkup(runtime.wrap(createElement(Fragment, null, ...sections)))).html;
      }
    } else body = (await staticMarkup(runtime.wrap(createElement(Fragment, null, ...sections)))).html;
    const shown = visibleText(body);
    for (const text of texts) if (!shown.includes(squash(visibleText(text.text)))) report.unboundKeys.push({ page: page.id, key: text.key, reason: "bound but not rendered by the selected renderer" });
    // Report rows keep their original placement order regardless of render outcome.
    const row = report.pages.find(item => item.id === page.id);
    if (row) row.sections = page.sections.map(section => section.leaf).filter(leaf => !report.emptySlots.some(slot => slot.page === page.id && slot.section === leaf && slot.reason.startsWith("renderer refused")));
    const head = [
      '<meta charset="utf-8">', '<meta name="viewport" content="width=device-width, initial-scale=1">',
      ...(page.meta.title ? [`<title>${escapeHtml(page.meta.title)}</title>`] : []),
      ...(page.meta.description ? [`<meta name="description" content="${escapeHtml(page.meta.description)}">`] : []),
      `<script>${THEME_SCRIPT}</script>`, `<link rel="stylesheet" href="${escapeHtml(stylesheet)}">`,
    ].join("");
    // `m-0 font-body` are the host candidates the selection stylesheet compiles for every host body (Studio sets the same).
    const document = /^<html[\s>]/.test(body) ? body : `<!doctype html><html lang="${escapeHtml(runtime.locale)}"${runtime.brandBound ? ' data-brand-bound=""' : ""}><head>${head}</head><body class="${HOST_BODY_CLASS}">${body}</body></html>`;
    rendered.push({ id: page.id, path: page.path, html: document.startsWith("<!doctype") ? document : `<!doctype html>${document}` });
  }
  return rendered;
}

/** Load Designer's renderers and the provider pair for a compiled consumer selection. */
export async function siteRuntime(options: { profile: any; selected: Record<string, any>; consumer: string; locale: string }): Promise<SiteRuntime> {
  const [frames, components, ports] = await Promise.all([
    agentModule("designer", "frames/index.js"),
    agentModule("designer", "catalog-core/resolve-components.js"),
    agentModule("designer", "catalog-core/runtime-ports.js"),
  ]);
  const profile = options.profile;
  const descriptors = Object.fromEntries(Object.entries(profile.components.components as Record<string, any>).map(([leaf, component]) => [leaf, components.componentDescriptorHash(component.descriptor)]));
  const value = { profile, modules: options.selected.componentModules, descriptors, selectionHash: profile.components.selectionHash };
  const SelectedProvider = options.selected.ComponentProvider;
  return {
    renderers: frames.surfaceRuntimeRenderers,
    profile, consumer: options.consumer, locale: options.locale, hash: ports.runtimeHash,
    wrap: node => createElement(frames.ConsumerComponentProvider, { value }, SelectedProvider ? createElement(SelectedProvider, { profile }, node) : node),
  };
}
