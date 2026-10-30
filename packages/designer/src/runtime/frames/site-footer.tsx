/** Registered footer runtime: selected native links, grouped columns and an explicit legal row. */
import type { ReactNode } from "react";
import type { RuntimeRenderInput, RuntimeJson } from "../../catalog-core/runtime-ports.js";
import { SiteFooter, type SiteFooterProps, type SiteFooterLegalLink } from "../../shell/SiteFooter.js";
import { runtimeMember, runtimeValue, type SurfaceRendererEntry } from "../contract.js";
import { frameContent, type FrameInput, type FrameJson } from "./frame-content.js";

const read = frameContent("frames.site-footer");
function record(value: RuntimeJson | undefined, at: string, keys: readonly string[]): FrameJson {
  const found = read.record(value) ?? read.fail(`${at} must be an object`);
  for (const key of Object.keys(found)) if (!keys.includes(key)) read.fail(`${at} has an unsupported field`);
  return found;
}
function records(value: RuntimeJson | undefined, at: string): readonly FrameJson[] {
  if (!Array.isArray(value) || value.some(item => !read.record(item))) read.fail(`${at} must be a list of objects`);
  return value as readonly FrameJson[];
}
function link(value: FrameJson, at: string): SiteFooterLegalLink {
  const row = record(value, at, ["href", "label"]);
  const href = read.required(row.href, at + ".href");
  let target: URL;
  try { target = new URL(href, "https://example.invalid/"); } catch { return read.fail(`${at}.href must be a safe destination`); }
  if (/^[\u0000-\u0020]|[\u0000-\u0020]$|[\t\n\r\\]/.test(href) || !["http:", "https:", "mailto:", "tel:"].includes(target.protocol)) read.fail(`${at}.href must be a safe destination`);
  let fragment = target.hash.slice(1);
  try { for (let count = 0; count < 3; count++) { const decoded = decodeURIComponent(fragment); if (decoded === fragment) break; fragment = decoded; } } catch { read.fail(`${at}.href has an invalid fragment`); }
  if (fragment.toLowerCase() === "privacy-choices") read.fail(`${at} must use legal.privacyChoices for the reserved control`);
  return { href, label: read.required(row.label, at + ".label") };
}

export function siteFooterProps(input: Pick<FrameInput, "content" | "selection">): SiteFooterProps {
  read.only(input, ["columns", "links", "legal"]);
  const columnValue = runtimeValue(input, "columns");
  const columns = columnValue === undefined ? [] : records(columnValue, "columns");
  if (columnValue !== undefined && !columns.length) read.fail("columns must list at least one column");
  const flatValue = runtimeValue(input, "links"), legalValue = runtimeValue(input, "legal");
  const flat = flatValue === undefined ? [] : records(flatValue, "links").map((row, index) => link(row, `links[${index}]`));
  if (flatValue !== undefined && legalValue === undefined) read.fail("links require legal.entity");
  const legal = legalValue === undefined ? undefined : record(legalValue, "legal", ["entity", "links", "linksLabel", "privacyChoices"]);
  const legalLinks = legal?.links === undefined ? [] : records(legal.links, "legal.links").map((row, index) => link(row, `legal.links[${index}]`));
  const privacyChoices = legal?.privacyChoices === undefined ? undefined : record(legal.privacyChoices, "legal.privacyChoices", ["label"]);
  return {
    ...(columns.length ? { columns: <>{columns.map((column, index) => {
      const at = `columns[${index}]`;
      const row = record(column, at, ["id", "heading", "links"]), links = records(row.links, at + ".links");
      if (!links.length) read.fail(`${at}.links must list at least one link`);
      return <SiteFooter.Column key={read.text(row.id) ?? index} heading={read.required(row.heading, at + ".heading")}>
        {links.map((entry, position) => { const resolved = link(entry, `${at}.links[${position}]`); return <SiteFooter.Link key={position} variant="link" href={resolved.href}>{resolved.label}</SiteFooter.Link>; })}
      </SiteFooter.Column>;
    })}</> } : {}),
    ...(legal ? { secondary: <SiteFooter.Legal entity={read.required(legal.entity, "legal.entity")}
      links={[...flat, ...legalLinks, ...(privacyChoices ? [{ href: "#privacy-choices", label: read.required(privacyChoices.label, "legal.privacyChoices.label") }] : [])]}
      {...(legal.linksLabel === undefined ? {} : { linksLabel: read.required(legal.linksLabel, "legal.linksLabel") })} /> } : {}),
    ground: runtimeMember(input, "ground", "base"),
    rule: runtimeMember<"on" | "off">(input, "rule", "off") === "on" ? "top" : "none",
  };
}

export function renderSiteFooter(input: RuntimeRenderInput<ReactNode>): ReactNode {
  return <SiteFooter {...siteFooterProps(input)} />;
}
function sample(dataset: Parameters<SurfaceRendererEntry["sample"]>[0]): FrameJson {
  return { columns: dataset.frames.siteFooter.columns };
}
export const siteFooterRenderer: SurfaceRendererEntry = { leaf: "frames.site-footer", render: renderSiteFooter, sample };
