import { useState, useSyncExternalStore, type ReactNode } from "react";
import { INSPECTOR_DOCK_QUERY } from "./right-panel-config.js";
import { cx } from "../components/internal/cx.js";
import { Drawer } from "../blocks/Drawer.js";
import { ResizablePane } from "../blocks/ResizablePane.js";

import { dsAttrs } from "../catalog-core/provenance-attrs.js";

import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");
const Button = componentLeaf<typeof import("../components/Button.js").Button>("components.button");

/** DOM provenance (WIRE-3 D1): this frame root stamps its leaf and fill. */
const FRAME_STAMP = dsAttrs("frames", "frames.inspector", "foundry/frames.inspector");

function subscribeViewport(change: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(INSPECTOR_DOCK_QUERY);
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
}
function narrowViewport(): boolean {
  return typeof window.matchMedia === "function" && !window.matchMedia(INSPECTOR_DOCK_QUERY).matches;
}

export type InspectorFramePresentation = "docked" | "overlay";

export interface InspectorFrameProps {
  /** Names the complementary landmark (docked) or the sheet heading (overlay). */
  label: string;
  handleLabel: string;
  closeLabel: string;
  /** Names the control that opens the overlay sheet. */
  openLabel: string;
  /** Docked from md upward; below md an opener reveals an end-edge sheet. Overlay stays a sheet at every width. @default "docked" */
  presentation?: InspectorFramePresentation;
  /** Controlled collapsed state; omit to let the frame own it. */
  collapsed?: boolean;
  defaultCollapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /** Controlled width; omit to let the frame own it. */
  value?: number;
  defaultValue: number;
  onChange?: (width: number) => void;
  min: number;
  max: number;
  step?: number;
  children: ReactNode;
  className?: string;
}

/**
 * A standalone inspector: the end-edge complementary panel AppFrame's right panel provides,
 * as its own frame. Below md, an initially closed sheet keeps the panel reachable without consuming the stage. Docked, it is a named `aside` holding a ResizablePane whose handle sits on
 * the start edge; overlay, it is an end-placed Drawer. Collapse and width are state ports the
 * host may own; the frame never persists either.
 */
export function InspectorFrame({ label, handleLabel, closeLabel, openLabel, presentation = "docked", collapsed, defaultCollapsed = false, onCollapsedChange,
  value, defaultValue, onChange, min, max, step, children, className }: InspectorFrameProps) {
  if (min > max) throw new TypeError("InspectorFrame: min must not exceed max.");
  const narrow = useSyncExternalStore(subscribeViewport, narrowViewport, () => false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [ownCollapsed, setOwnCollapsed] = useState(defaultCollapsed);
  const isCollapsed = collapsed ?? ownCollapsed;
  const changeCollapsed = (next: boolean) => { if (collapsed === undefined) setOwnCollapsed(next); onCollapsedChange?.(next); };
  const open = presentation === "overlay" || collapsed !== undefined ? !isCollapsed : sheetOpen && !isCollapsed;
  if (presentation === "overlay" || narrow) return <Drawer placement="end" wide="sheet" heading={label} closeLabel={closeLabel}
    isOpen={open} onOpenChange={next => { setSheetOpen(next); changeCollapsed(!next); }} className={className}
    trigger={<Button variant="secondary" size="sm" aria-expanded={open}>{openLabel}</Button>}>{children}</Drawer>;
  return <SemanticContent as="aside" {...FRAME_STAMP} aria-label={label} hidden={isCollapsed} data-collapsed={isCollapsed} className={cx("hidden h-full min-h-0 shrink-0 tablet:block", className)}>
    {isCollapsed ? null : <ResizablePane min={min} max={max} defaultValue={defaultValue} value={value} step={step} label={label} handleLabel={handleLabel}
      handleEdge="start" onChange={onChange} className="h-full min-h-0 rounded-none border-0 border-s border-line-base p-sm">{children}</ResizablePane>}
  </SemanticContent>;
}
