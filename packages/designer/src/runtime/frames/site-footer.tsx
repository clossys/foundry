/**
 * frames.site-footer runtime renderer: the real SiteFooter with SiteFooter.Column groups
 * of package Links, from JSON `columns` content and the selected ground/rule members. The
 * fill maps only `columns`; links, legal and social stay unmapped and are refused, never dropped.
 */
import type { ReactNode } from "react";
import { Link } from "../../selected-components/Link.js";
import type { RuntimeRenderInput } from "../../catalog-core/runtime-ports.js";
import { SiteFooter, type SiteFooterProps } from "../../shell/SiteFooter.js";
import { runtimeMember, runtimeValue, type SurfaceRendererEntry } from "../contract.js";
import { frameContent, type FrameInput, type FrameJson } from "./frame-content.js";

const read = frameContent("frames.site-footer");

export function siteFooterProps(input: Pick<FrameInput, "content" | "selection">): SiteFooterProps {
  read.only(input, ["columns"]);
  const columns = read.records(runtimeValue(input, "columns"));
  if (runtimeValue(input, "columns") !== undefined && !columns.length) read.fail("columns must list at least one column");
  return {
    ...(columns.length ? { columns: <>{columns.map((column, index) => {
      const at = `columns[${index}]`, links = read.records(column.links);
      if (!links.length) read.fail(`${at}.links must list at least one link`);
      return <SiteFooter.Column key={read.text(column.id) ?? index} heading={read.required(column.heading, at + ".heading")}>
        {links.map((link, position) => <Link key={position} variant="muted" href={read.required(link.href, `${at}.links[${position}].href`)}>{read.required(link.label, `${at}.links[${position}].label`)}</Link>)}
      </SiteFooter.Column>;
    })}</> } : {}),
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
