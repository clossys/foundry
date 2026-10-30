"use client";
import { Minus } from "../icons/Minus.js";
import { Plus } from "../icons/Plus.js";

import { componentLeaf } from "../runtime/component-leaf.js";

const SemanticContent = componentLeaf<typeof import("./SemanticContent.js").SemanticContent>("components.semantic-content");
const Icon = componentLeaf<typeof import("./Icon.js").Icon>("components.icon");
const Button = componentLeaf<typeof import("./Button.js").Button>("components.button");
const Toolbar = componentLeaf<typeof import("./Toolbar.js").Toolbar>("components.toolbar");
const Tooltip = componentLeaf<typeof import("./Tooltip.js").Tooltip>("components.tooltip");

export interface CanvasZoomProps {
  value: number; min: number; max: number;
  onChange(value: number): void; onFit(): void;
  labels: { group: string; out: string; in: string; fit: string; percent: string };
  /** Host-formatted percentage copy, including the reset value. No locale is inferred here. */
  formatValue?: (percent: number) => string;
}
/** Momentary camera actions use the existing native Button group navigation. */
export function CanvasZoom({ value, min, max, onChange, onFit, labels, formatValue }: CanvasZoomProps) {
  if (typeof formatValue !== "function") throw new TypeError("CanvasZoom.formatValue");
  const currentLabel = formatValue(value * 100), resetLabel = formatValue(100);
  if (typeof currentLabel !== "string" || !currentLabel.trim() || typeof resetLabel !== "string" || !resetLabel.trim()) {
    throw new TypeError("CanvasZoom.formatValue.result");
  }
  const atReset = Math.round(value * 100) === 100;
  return <Toolbar aria-label={labels.group} data-studio-panel="zoom" className="items-center rounded-control border-0 p-0">
    <Tooltip trigger={<Button size="sm" variant="ghost" className="icon-control-sm rounded-control p-0" aria-label={labels.out} data-studio-control="zoom-out" isDisabled={value <= min} onPress={() => onChange(Math.max(min, value / 1.2))}><Icon glyph={Minus} decorative size="sm" /></Button>}>{labels.out}</Tooltip>
    <SemanticContent as="span" role="status" aria-label={labels.percent} className="text-body-s tabular-nums">{currentLabel}</SemanticContent>
    <Tooltip trigger={<Button size="sm" variant="ghost" className="icon-control-sm rounded-control p-0" aria-label={labels.in} data-studio-control="zoom-in" isDisabled={value >= max} onPress={() => onChange(Math.min(max, value * 1.2))}><Icon glyph={Plus} decorative size="sm" /></Button>}>{labels.in}</Tooltip>
    <Tooltip trigger={<Button size="sm" variant="ghost" data-studio-control="zoom-fit" onPress={onFit}>{labels.fit}</Button>}>{labels.fit}</Tooltip>
    {/* The readout already says 100% there; the reset keeps its place (no layout shift) but is hidden and inert. */}
    <SemanticContent as="span" data-zoom-reset="" inert={atReset} className={atReset ? "invisible" : undefined}><Tooltip trigger={<Button size="sm" variant="ghost" data-studio-control="zoom-reset" onPress={() => onChange(1)}>{resetLabel}</Button>}>{resetLabel}</Tooltip></SemanticContent>
  </Toolbar>;
}
