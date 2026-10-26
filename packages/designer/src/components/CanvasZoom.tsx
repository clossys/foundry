"use client";
import { Minus } from "../icons/Minus.js";
import { Plus } from "../icons/Plus.js";
import { Button } from "./Button.js";
import { IconButton } from "./IconButton.js";
import { Toolbar } from "./Toolbar.js";
import { Tooltip } from "./Tooltip.js";

export interface CanvasZoomProps {
  value: number; min: number; max: number;
  onChange(value: number): void; onFit(): void;
  labels: { group: string; out: string; in: string; fit: string; percent: string };
}
/** Momentary camera actions use the existing native Button group navigation. */
export function CanvasZoom({ value, min, max, onChange, onFit, labels }: CanvasZoomProps) {
  const atReset = Math.round(value * 100) === 100;
  return <Toolbar aria-label={labels.group} data-studio-panel="zoom" className="items-center rounded-control border-0 p-0">
    <Tooltip trigger={<IconButton size="sm" shape="square" icon={Minus} label={labels.out} isDisabled={value <= min} onPress={() => onChange(Math.max(min, value / 1.2))} />}>{labels.out}</Tooltip>
    <output aria-label={labels.percent} className="text-body-s tabular-nums">{Math.round(value * 100)}%</output>
    <Tooltip trigger={<IconButton size="sm" shape="square" icon={Plus} label={labels.in} isDisabled={value >= max} onPress={() => onChange(Math.min(max, value * 1.2))} />}>{labels.in}</Tooltip>
    <Tooltip trigger={<Button size="sm" variant="ghost" onPress={onFit}>{labels.fit}</Button>}>{labels.fit}</Tooltip>
    {/* The readout already says 100% there; the reset keeps its place (no layout shift) but is hidden and inert. */}
    <span data-zoom-reset="" inert={atReset} className={atReset ? "invisible" : undefined}><Tooltip trigger={<Button size="sm" variant="ghost" onPress={() => onChange(1)}>100%</Button>}>100%</Tooltip></span>
  </Toolbar>;
}
