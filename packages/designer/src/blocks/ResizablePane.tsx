import { useId, useState, type ReactNode } from "react";
import type { ResizeHandleProps } from "../components/ResizeHandle.js";
import { Panel, type PanelProps } from "./Panel.js";
import type { SectionGround } from "./section-ground.js";

import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("../components/SemanticContent.js").SemanticContent>("components.semantic-content");
const ResizeHandle = componentLeaf<typeof import("../components/ResizeHandle.js").ResizeHandle>("components.resize-handle");

export interface ResizablePaneProps extends Omit<PanelProps, "onChange" | "defaultValue" | "children" | "role" | "aria-label" | "aria-labelledby"> {
  /** Surrounding ground for the resize handle's existing focus treatment. */
  ground?: SectionGround;
  min: number;
  max: number;
  defaultValue: number;
  /** When supplied, the host owns the current value; changes are reported without overwriting it. */
  value?: number;
  step?: number;
  /** Separator orientation: vertical resizes inline width, horizontal resizes block height. */
  orientation?: ResizeHandleProps["orientation"];
  /** Place the separator at the pane's leading or trailing edge. @default "end" */
  handleEdge?: ResizeHandleProps["edge"];
  label: string;
  handleLabel: string;
  onChange?: (value: number) => void;
  children: ReactNode;
}

/** Panel and ResizeHandle composition with supplied bounds; it never persists layout. */
export function ResizablePane({
  min, max, defaultValue, value, step, orientation = "vertical", handleEdge = "end",
  label, handleLabel, onChange, children, style, ground = "base", ...rest
}: ResizablePaneProps) {
  const generatedId = useId();
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  if (handleEdge !== "start" && handleEdge !== "end") throw new TypeError("ResizablePane: unknown handle edge.");
  const bounded = Math.min(max, Math.max(min, value ?? uncontrolled));
  const dimension = orientation === "vertical" ? { inlineSize: bounded } : { blockSize: bounded };
  const change = (next: number) => {
    const clamped = Math.min(max, Math.max(min, next));
    if (value === undefined) setUncontrolled(clamped);
    onChange?.(clamped);
  };
  const handle = <ResizeHandle
    key="handle" value={bounded} min={min} max={max} resetValue={defaultValue} step={step}
    orientation={orientation} edge={handleEdge} label={handleLabel}
    className={ground === "inverse" ? "focus-visible:outline-accent-on-inverse" : undefined}
    aria-controls={rest.id ?? generatedId} onChange={change}
  />;
  return (
    <Panel
      {...rest} id={rest.id ?? generatedId} role="region" aria-label={label}
      style={{ ...style, ...dimension }}
    >
      <SemanticContent as="div" className={orientation === "vertical" ? "flex h-full min-h-0 min-w-0" : "flex h-full min-h-0 min-w-0 flex-col"}>
        {handleEdge === "start" ? handle : null}
        <SemanticContent as="div" className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</SemanticContent>
        {handleEdge === "end" ? handle : null}
      </SemanticContent>
    </Panel>
  );
}
