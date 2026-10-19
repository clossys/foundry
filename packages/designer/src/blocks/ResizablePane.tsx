import { useId, useState, type ReactNode } from "react";
import { ResizeHandle, type ResizeHandleProps } from "../atoms/ResizeHandle.js";
import { Panel, type PanelProps } from "./Panel.js";

export interface ResizablePaneProps extends Omit<PanelProps, "onChange" | "defaultValue" | "children" | "role" | "aria-label" | "aria-labelledby"> {
  min: number;
  max: number;
  defaultValue: number;
  /** When supplied, the host owns the current value; changes are reported without overwriting it. */
  value?: number;
  step?: number;
  /** Separator orientation: vertical resizes inline width, horizontal resizes block height. */
  orientation?: ResizeHandleProps["orientation"];
  label: string;
  handleLabel: string;
  onChange?: (value: number) => void;
  children: ReactNode;
}

/** Panel and ResizeHandle composition with supplied bounds; it never persists layout. */
export function ResizablePane({
  min, max, defaultValue, value, step, orientation = "vertical",
  label, handleLabel, onChange, children, style, ...rest
}: ResizablePaneProps) {
  const generatedId = useId();
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const bounded = Math.min(max, Math.max(min, value ?? uncontrolled));
  const dimension = orientation === "vertical" ? { inlineSize: bounded } : { blockSize: bounded };
  const change = (next: number) => {
    const clamped = Math.min(max, Math.max(min, next));
    if (value === undefined) setUncontrolled(clamped);
    onChange?.(clamped);
  };
  return (
    <Panel
      {...rest} id={rest.id ?? generatedId} role="region" aria-label={label}
      style={{ ...style, ...dimension }}
    >
      <div className={orientation === "vertical" ? "flex h-full min-h-0 min-w-0" : "flex h-full min-h-0 min-w-0 flex-col"}>
        <div className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</div>
        <ResizeHandle
          value={bounded} min={min} max={max} resetValue={defaultValue} step={step}
          orientation={orientation} label={handleLabel}
          className={rest.ground === "inverse" ? "focus-visible:outline-accent-on-inverse" : undefined}
          aria-controls={rest.id ?? generatedId} onChange={change}
        />
      </div>
    </Panel>
  );
}
