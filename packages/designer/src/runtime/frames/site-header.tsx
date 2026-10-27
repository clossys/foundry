/**
 * frames.site-header runtime renderer: the real SiteHeader, Brandmark and NavDisclosure
 * from JSON content (brand, nav, actions) and the selected surface/tone/nav-placement/position
 * members. Server-rendered chrome: links are real anchors, so no host port is read.
 */
import type { ReactNode } from "react";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { Brandmark, type BrandmarkSize } from "../../shell/Brandmark.js";
import { NavDisclosure } from "../../shell/NavDisclosure.js";
import { SiteHeader, type SiteHeaderActionLinkVariant, type SiteHeaderProps } from "../../shell/SiteHeader.js";
import { runtimeMember, runtimeValue, type SurfaceRendererEntry } from "../contract.js";
import { frameContent, type FrameInput, type FrameJson } from "./frame-content.js";

const read = frameContent("frames.site-header");
const SIZES: readonly BrandmarkSize[] = ["sm", "md", "lg"];
const VARIANTS: readonly SiteHeaderActionLinkVariant[] = ["primary", "secondary", "ghost"];

export function siteHeaderProps(input: Pick<FrameInput, "content" | "selection">): SiteHeaderProps {
  read.only(input, ["brand", "nav", "actions"]);
  const brand = read.record(runtimeValue(input, "brand")) ?? read.fail("brand content is required");
  const label = read.required(brand.label, "brand.label"), markSrc = read.required(brand.markSrc, "brand.markSrc"), wordmark = read.text(brand.wordmark), origin = read.text(brand.origin);
  const size = SIZES.find(value => value === brand.size) ?? "md";
  const mark = wordmark
    ? <Brandmark variant="lockup" size={size} label={label} wordmark={wordmark} markSrc={markSrc} {...(origin ? { origin } : {})} />
    : <Brandmark variant="mark" size={size} label={label} markSrc={markSrc} {...(origin ? { origin } : {})} />;
  const nav = read.record(runtimeValue(input, "nav"));
  const links = nav ? read.records(nav.links) : [];
  if (nav && !links.length) read.fail("nav.links must list at least one link");
  const actions = runtimeValue(input, "actions") === undefined ? [] : read.records(runtimeValue(input, "actions"));
  const surface = runtimeMember<NonNullable<SiteHeaderProps["surface"]>>(input, "surface", "solid");
  const position = runtimeMember<"sticky" | "static" | "">(input, "position", "");
  return {
    brand: mark,
    ...(nav ? { nav: <NavDisclosure {...(read.text(nav.label) ? { "aria-label": read.text(nav.label) } : {})} {...(read.text(nav.triggerLabel) ? { triggerLabel: read.text(nav.triggerLabel) } : {})}>
      {links.map((link, index) => <SiteHeader.ActionLink key={read.text(link.id) ?? index} variant="ghost" href={read.required(link.href, `nav.links[${index}].href`)} label={read.required(link.label, `nav.links[${index}].label`)} isCurrent={link.isCurrent === true} />)}
    </NavDisclosure> } : {}),
    ...(actions.length ? { actions: <>{actions.map((action, index) => <SiteHeader.ActionLink key={read.text(action.id) ?? index} href={read.required(action.href, `actions[${index}].href`)} label={read.required(action.label, `actions[${index}].label`)}
      variant={VARIANTS.find(value => value === action.variant) ?? "secondary"} isCurrent={action.isCurrent === true} />)}</> } : {}),
    surface,
    tone: runtimeMember(input, "tone", "base"),
    navPlacement: runtimeMember(input, "nav-placement", "centered"),
    ...(position ? { position } : {}),
  };
}

export function renderSiteHeader(input: RuntimeRenderInput<ReactNode>): ReactNode {
  return <SiteHeader {...siteHeaderProps(input)} />;
}

function sample(dataset: Parameters<SurfaceRendererEntry["sample"]>[0]): FrameJson {
  const header = dataset.frames.siteHeader;
  return {
    brand: { label: header.homeLabel, markSrc: dataset.assets.mark.src, wordmark: header.brand, size: "md" },
    nav: { label: dataset.navigation.label, triggerLabel: header.menuLabel, links: dataset.navigation.items.map((item, index) => ({ id: item.id, label: item.label, href: item.href, isCurrent: index === 0 })) },
    actions: header.actions,
  };
}

export const siteHeaderRenderer: SurfaceRendererEntry = { leaf: "frames.site-header", render: renderSiteHeader, sample };
