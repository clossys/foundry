/**
 * The `frames.site-shell` surface runtime renderer. Its library fill points at Designer's
 * `SiteFrame`; the same owning registry supplies the renderer to planSurfaceRuntime.
 *
 * Content is closed JSON keyed by the fill's slots (`skip-link`, `header`, `footer`); `main` comes
 * from the route's Stage slot and `toasts` from the frame host port. Every string becomes a copy
 * reference resolved by this renderer, and the brand mark an image asset, so `SiteFrame` keeps all
 * its own checks (links, footer rules, overlay scene). Anything unmapped is refused, never dropped.
 */
import type { ReactNode } from "react";
import type { CopyRef, CopyResolution, CopyResolver } from "../../frames/site-frame/copy-contract.js";
import type { RuntimeJson, RuntimeRenderInput } from "@clossys/designer/catalog";
import type { SurfaceRendererEntry, SurfaceRendererGroup } from "../contract.js";
import type { AssetResolver } from "../../frames/site-frame/landing/web/types.js";
import type { SiteFramePresentationConfig } from "../../frames/site-frame/site-frame-contract.js";
import { SiteFrame } from "../../frames/site-frame/SiteFrame.js";
import { SITE_CHROME_GROUNDS } from "../../frames/site-frame/types.js";
import type { SiteBrandInput, SiteEnvironmentLinkInput, SiteFooterInput, SiteFrameProps, SiteIconLinkInput, SiteLinkInput, SiteShellInput } from "../../frames/site-frame/types.js";

const LEAF = "frames.site-shell";
type Json = Readonly<Record<string, RuntimeJson>>;
type Dataset = Parameters<SurfaceRendererEntry["sample"]>[0];

/** The public registry export the manifest closure names: `import { siteShellRuntimeRenderers } from "@clossys/publisher/web"`. */
export const SITE_SHELL_RUNTIME_POINTER = Object.freeze({ module: "@clossys/designer/frames", export: "surfaceRuntimeRenderers" } as const);

const fail = (message: string): never => { throw new TypeError(`${LEAF}: ${message}`); };
const text = (value: RuntimeJson | undefined): string | undefined => typeof value === "string" && value.trim() ? value : undefined;
const required = (value: RuntimeJson | undefined, at: string): string => text(value) ?? fail(`${at} must be non-empty text`);
const record = (value: RuntimeJson | undefined, at: string): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : fail(`${at} must be an object`);
const list = (value: RuntimeJson | undefined, at: string): readonly RuntimeJson[] => Array.isArray(value) ? value : fail(`${at} must be a list`);
const keys = (row: Json, at: string, allowed: readonly string[]): Json => {
  for (const key of Object.keys(row)) if (!allowed.includes(key)) fail(`${at} has no ${key} field`);
  return row;
};
function choice<T extends string>(value: RuntimeJson | undefined, at: string, values: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  return values.find(item => item === value) ?? fail(`${at} must be one of ${values.join(", ")}`);
}

const CONTENT = ["skip-link", "header", "footer"] as const;
const MEMBERS: Readonly<Record<string, SiteFramePresentationConfig>> = Object.freeze({
  "footer-placement.flow": Object.freeze({ footerPlacement: "flow" }),
  "footer-placement.overlay": Object.freeze({ footerPlacement: "overlay" }),
});

/** Every string the content names, interned as a copy reference this renderer resolves. */
function copyTable() {
  const texts: string[] = [];
  const ref = (value: string): CopyRef => { texts.push(value); return { id: `runtime-content.${texts.length - 1}` }; };
  const resolveCopy: CopyResolver = copyRef => {
    const index = /^runtime-content\.(\d+)$/.exec(copyRef.id)?.[1];
    const value = index === undefined ? undefined : texts[Number(index)];
    if (value === undefined) return undefined;
    const resolution: CopyResolution = { ref: copyRef, text: value, recordId: copyRef.id, revision: "runtime", locale: "und", source: { kind: "consumer", reference: "runtime-content" }, entryId: copyRef.id };
    return resolution;
  };
  return { ref, resolveCopy };
}

/** `SiteFrame` props for one runtime input: shell data, its resolvers, presentation from members, main and toasts. */
export function siteShellProps(input: Pick<RuntimeRenderInput<ReactNode>, "content" | "selection" | "slots" | "host" | "locale">): SiteFrameProps {
  for (const key of Object.keys(input.content)) if (!(CONTENT as readonly string[]).includes(key)) fail(`${key} content has no mapped prop`);
  let presentation: SiteFramePresentationConfig = {};
  for (const member of input.selection.members) presentation = { ...presentation, ...(MEMBERS[member] ?? fail(`${member} member has no mapped prop`)) };
  const value = (slot: string): RuntimeJson | undefined => Object.hasOwn(input.content, slot) ? input.content[slot]!.value : undefined;
  const { ref, resolveCopy } = copyTable();

  const link = (row: RuntimeJson, at: string) => {
    const fields = keys(record(row, at), at, ["label", "href"]);
    return { href: required(fields.href, `${at}.href`), label: ref(required(fields.label, `${at}.label`)) };
  };
  const links = (rows: RuntimeJson | undefined, at: string) => list(rows, at).map((row, index) => link(row, `${at}[${index}]`));
  const iconOf = (row: Json, at: string) => list(row.icon, `${at}.icon`) as unknown as SiteIconLinkInput["icon"];

  const header = keys(record(value("header"), "header"), "header", ["brand", "nav", "actions", "environments", "navPlacement", "surface", "tone", "origin"]);
  const brandRow = keys(record(header.brand, "header.brand"), "header.brand", ["label", "mark", "wordmark", "size", "plate", "tone", "markInk"]);
  const mark = keys(record(brandRow.mark, "header.brand.mark"), "header.brand.mark", ["src", "width", "height"]);
  const brandLabel = required(brandRow.label, "header.brand.label");
  const assetId = "runtime-content.brand-mark";
  const resolveAsset: AssetResolver = id => id === assetId ? { type: "image", src: mark.src, width: mark.width, height: mark.height, alt: brandLabel } : undefined;
  const wordmark = text(brandRow.wordmark);
  const plate = choice(brandRow.plate, "header.brand.plate", ["self", "shared"] as const);
  const brandTone = choice(brandRow.tone, "header.brand.tone", ["auto", "inverse"] as const);
  const markInk = choice(brandRow.markInk, "header.brand.markInk", ["image", "accent"] as const);
  const brand = {
    assetId, label: ref(brandLabel), size: choice(brandRow.size, "header.brand.size", ["sm", "md", "lg"] as const) ?? "md",
    ...(plate ? { plate } : {}), ...(brandTone ? { tone: brandTone } : {}), ...(markInk ? { markInk } : {}),
    ...(wordmark === undefined ? { variant: "mark" as const } : { variant: "lockup" as const, wordmark: ref(wordmark) }),
  } satisfies SiteBrandInput;

  let nav: SiteShellInput["nav"];
  if (header.nav !== undefined) {
    const row = keys(record(header.nav, "header.nav"), "header.nav", ["label", "triggerLabel", "closeLabel", "links"]);
    const trigger = text(row.triggerLabel);
    const close = row.closeLabel === undefined ? undefined : required(row.closeLabel, "header.nav.closeLabel");
    nav = {
      label: ref(required(row.label, "header.nav.label")), ...(trigger ? { triggerLabel: ref(trigger) } : {}), ...(close ? { closeLabel: ref(close) } : {}),
      links: list(row.links, "header.nav.links").map((item, index) => {
        const at = `header.nav.links[${index}]`, fields = keys(record(item, at), at, ["label", "href", "isCurrent"]);
        return { ...link({ label: fields.label ?? null, href: fields.href ?? null }, at), ...(fields.isCurrent === true ? { isCurrent: true } : {}) };
      }),
    };
  }
  const actions = header.actions === undefined ? undefined : list(header.actions, "header.actions").map((item, index): SiteLinkInput => {
    const at = `header.actions[${index}]`, fields = keys(record(item, at), at, ["label", "href", "emphasis", "icon"]);
    const emphasis = choice(fields.emphasis, `${at}.emphasis`, ["primary", "secondary", "ghost"] as const);
    return { ...link({ label: fields.label ?? null, href: fields.href ?? null }, at), ...(emphasis ? { emphasis } : {}), ...(fields.icon === undefined ? {} : { icon: iconOf(fields, at) }) };
  });
  // SiteFrame would fall back to its own default navigation copy ids, which runtime content cannot resolve.
  if (actions?.length && nav === undefined) fail("header.actions need header.nav");
  const environments = header.environments === undefined ? undefined : list(header.environments, "header.environments").map((item, index): SiteEnvironmentLinkInput => {
    const at = `header.environments[${index}]`, fields = keys(record(item, at), at, ["label", "href", "icon", "isCurrent"]);
    return { ...link({ label: fields.label ?? null, href: fields.href ?? null }, at), icon: iconOf(fields, at), ...(fields.isCurrent === true ? { isCurrent: true } : {}) };
  });
  const surface = choice(header.surface, "header.surface", ["solid", "transparent", "glass"] as const);
  const tone = choice(header.tone, "header.tone", ["base", "inverse"] as const);
  const navPlacement = choice(header.navPlacement, "header.navPlacement", ["leading", "centered"] as const);
  const origin = header.origin === undefined ? undefined : required(header.origin, "header.origin");

  let footer: SiteFooterInput | undefined;
  if (value("footer") !== undefined) {
    const row = keys(record(value("footer"), "footer"), "footer", ["brandBand", "rule", "ground", "columns", "links", "social", "legal"]);
    if (row.brandBand !== undefined && typeof row.brandBand !== "boolean") fail("footer.brandBand must be a boolean");
    const legal = keys(record(row.legal, "footer.legal"), "footer.legal", ["entity", "links", "linksLabel"]);
    const linksLabel = text(legal.linksLabel);
    const rule = choice(row.rule, "footer.rule", ["none", "top"] as const);
    const social = row.social === undefined ? undefined : keys(record(row.social, "footer.social"), "footer.social", ["label", "links"]);
    const socialLabel = social && text(social.label);
    footer = {
      ...(row.brandBand === undefined ? {} : { brandBand: row.brandBand as boolean }),
      ...(rule ? { rule } : {}),
      ...(row.ground === undefined ? {} : { ground: choice(row.ground, "footer.ground", SITE_CHROME_GROUNDS) }),
      ...(row.columns === undefined ? {} : { columns: list(row.columns, "footer.columns").map((item, index) => {
        const at = `footer.columns[${index}]`, fields = keys(record(item, at), at, ["heading", "links"]);
        return { heading: ref(required(fields.heading, `${at}.heading`)), links: links(fields.links, `${at}.links`) };
      }) }),
      ...(row.links === undefined ? {} : { links: links(row.links, "footer.links") }),
      ...(social ? { social: { ...(socialLabel ? { label: ref(socialLabel) } : {}), links: list(social.links, "footer.social.links").map((item, index): SiteIconLinkInput => {
        const at = `footer.social.links[${index}]`, fields = keys(record(item, at), at, ["label", "href", "icon"]);
        return { ...link({ label: fields.label ?? null, href: fields.href ?? null }, at), icon: iconOf(fields, at) };
      }) } } : {}),
      legal: { entity: ref(required(legal.entity, "footer.legal.entity")), links: legal.links === undefined ? [] : links(legal.links, "footer.legal.links"), ...(linksLabel ? { linksLabel: ref(linksLabel) } : {}) },
    } as SiteFooterInput;
  }

  const shell: SiteShellInput = {
    brand, skipLink: ref(required(value("skip-link"), "skip-link")),
    ...(nav ? { nav } : {}), ...(actions ? { actions } : {}), ...(environments ? { environments } : {}),
    ...(navPlacement ? { navPlacement } : {}), ...(surface || tone ? { header: { ...(surface ? { surface } : {}), ...(tone ? { tone } : {}) } } : {}),
    ...(footer ? { footer } : {}), ...(origin ? { origin } : {}),
  };
  const main = input.slots.main ?? [];
  // Preserve a single registered Hero element so SiteFrame can validate its overlay scene identity.
  return { ...(input.locale === undefined ? {} : { locale: input.locale }), shell, presentation, resolveCopy, resolveAsset, children: main.length === 1 ? main[0] : main, ...(input.host?.toasts === undefined ? {} : { toasts: input.host.toasts }) };
}

export function renderSiteShell(input: RuntimeRenderInput<ReactNode>): ReactNode {
  return <SiteFrame {...siteShellProps(input)} />;
}

/** Content drawn from the shared specimen dataset (Designer preview contract). */
function sample(dataset: Dataset): Json {
  const mark = dataset.assets.mark, header = dataset.frames.siteHeader;
  return {
    "skip-link": dataset.frames.app.skipLabel,
    header: {
      brand: { label: header.homeLabel, mark: { src: `/${mark.slot}/${mark.member}.svg`, width: dataset.assets.appIcon.viewBox, height: dataset.assets.appIcon.viewBox }, wordmark: header.brand, size: "md" },
      nav: { label: dataset.navigation.label, triggerLabel: header.menuLabel, closeLabel: dataset.frames.sheet.closeLabel, links: dataset.navigation.items.slice(0, 3).map((item, index) => ({ label: item.label, href: item.href, isCurrent: index === 0 })) },
      actions: [{ label: dataset.sections.callToAction.primary.label, href: dataset.sections.callToAction.primary.href, emphasis: "secondary" }],
    },
    footer: {
      brandBand: true,
      columns: dataset.frames.siteFooter.columns.map(column => ({ heading: column.heading, links: column.links.map(link => ({ label: link.label, href: link.href })) })),
      legal: { entity: header.brand, links: [] },
    },
  };
}

export const siteShellRuntimeRenderer: SurfaceRendererEntry = { leaf: LEAF, render: renderSiteShell, sample };
/** The site-shell subset of the Designer-owned surface runtime registry. */
export const siteShellRuntimeRenderers: SurfaceRendererGroup = Object.freeze({ [LEAF]: siteShellRuntimeRenderer });
/** Leaf → registry pointer, merged beside Designer's `surfaceRuntimePointers()` for `planSurfaceRuntime`. */
export function siteShellRuntimePointers(): Readonly<Record<string, typeof SITE_SHELL_RUNTIME_POINTER>> {
  return Object.freeze({ [LEAF]: SITE_SHELL_RUNTIME_POINTER });
}
/** `ConsumerRuntimePorts.renderers` entries, keyed by the descriptor id (`package:<leaf>`). */
export function siteShellRuntimeCallbacks(): Readonly<Record<string, SurfaceRendererEntry["render"]>> {
  return Object.freeze({ [`package:${LEAF}`]: renderSiteShell });
}
