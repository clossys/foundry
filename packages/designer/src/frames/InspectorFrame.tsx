import { useState, type ReactNode } from "react";
import { cx } from "../components/internal/cx.js";
import { Drawer } from "../blocks/Drawer.js";
import { ResizablePane } from "../blocks/ResizablePane.js";
import { Button } from "../components/Button.js";

export type InspectorFramePresentation = "docked" | "overlay";

export interface InspectorFrameProps {
  /** Names the complementary landmark (docked) or the sheet heading (overlay). */
  label: string;
  handleLabel: string;
  closeLabel: string;
  /** Names the control that opens the overlay sheet. */
  openLabel: string;
  /** Docked beside the content with a resize handle, or an end-edge sheet over it. @default "docked" */
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
 * as its own frame. Docked, it is a named `aside` holding a ResizablePane whose handle sits on
 * the start edge; overlay, it is an end-placed Drawer. Collapse and width are state ports the
 * host may own; the frame never persists either.
 */
export function InspectorFrame({ label, handleLabel, closeLabel, openLabel, presentation = "docked", collapsed, defaultCollapsed = false, onCollapsedChange,
  value, defaultValue, onChange, min, max, step, children, className }: InspectorFrameProps) {
  if (min > max) throw new TypeError("InspectorFrame: min must not exceed max.");
  const [ownCollapsed, setOwnCollapsed] = useState(defaultCollapsed);
  const isCollapsed = collapsed ?? ownCollapsed;
  const changeCollapsed = (next: boolean) => { if (collapsed === undefined) setOwnCollapsed(next); onCollapsedChange?.(next); };
  if (presentation === "overlay") return <Drawer placement="end" wide="sheet" heading={label} closeLabel={closeLabel}
    isOpen={!isCollapsed} onOpenChange={open => changeCollapsed(!open)} className={className}
    trigger={<Button variant="secondary" size="sm" aria-expanded={!isCollapsed}>{openLabel}</Button>}>{children}</Drawer>;
  return <aside aria-label={label} hidden={isCollapsed} data-collapsed={isCollapsed} className={cx("h-full min-h-0 shrink-0", className)}>
    {isCollapsed ? null : <ResizablePane min={min} max={max} defaultValue={defaultValue} value={value} step={step} label={label} handleLabel={handleLabel}
      handleEdge="start" onChange={onChange} className="h-full min-h-0 rounded-none border-0 border-s border-line-base p-sm">{children}</ResizablePane>}
  </aside>;
}
