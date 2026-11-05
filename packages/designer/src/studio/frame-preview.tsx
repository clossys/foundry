"use client";

import { PageBar, type PageBarProps } from "../blocks/PageBar.js";
import { SiteHeader, type SiteHeaderProps } from "../shell/SiteHeader.js";
import { resolveFrameHeaderOptions, type FrameHeaderOptions } from "../catalog-core/frame-header-options.js";

type HeaderPreviewProps = {
  /** Consumer-owned defaults are supplied as data; previews never edit a consumer library. */
  defaults?: FrameHeaderOptions;
  instance?: FrameHeaderOptions;
} & (
  | { frame: "frames.app-header"; content: Omit<PageBarProps, "position" | "surface"> }
  | { frame: "frames.site-header"; content: Omit<SiteHeaderProps, "position" | "surface"> }
);

/** Preview the real header export, with the same resolved members and token-read selection. */
export function FrameHeaderPreview(props: HeaderPreviewProps) {
  const { members } = resolveFrameHeaderOptions(props.frame, props.instance, props.defaults);
  return props.frame === "frames.app-header"
    ? <PageBar {...props.content} {...members} />
    : <SiteHeader {...props.content} {...members} />;
}
