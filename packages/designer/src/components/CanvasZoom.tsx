"use client";
import { Button } from "./Button.js";
import { Toolbar } from "./Toolbar.js";
import { Tooltip } from "./Tooltip.js";

export interface CanvasZoomProps {
  value: number; min: number; max: number;
  onChange(value: number): void; onFit(): void;
  labels: { group: string; out: string; in: string; fit: string; percent: string };
}
/** Momentary camera actions use the existing native Button group navigation. */
export function CanvasZoom({ value, min, max, onChange, onFit, labels }: CanvasZoomProps) {
  return <Toolbar aria-label={labels.group} data-studio-panel="zoom" className="items-center rounded-control border-0 p-0">
    <Tooltip trigger={<Button size="sm" variant="ghost" aria-label={labels.out} isDisabled={value <= min} onPress={() => onChange(Math.max(min, value / 1.2))}>−</Button>}>{labels.out}</Tooltip>
    <output aria-label={labels.percent} className="text-body-s tabular-nums">{Math.round(value * 100)}%</output>
    <Tooltip trigger={<Button size="sm" variant="ghost" aria-label={labels.in} isDisabled={value >= max} onPress={() => onChange(Math.min(max, value * 1.2))}>+</Button>}>{labels.in}</Tooltip>
    <Tooltip trigger={<Button size="sm" variant="ghost" onPress={onFit}>{labels.fit}</Button>}>{labels.fit}</Tooltip>
    <Tooltip trigger={<Button size="sm" variant="ghost" onPress={() => onChange(1)}>100%</Button>}>100%</Tooltip>
  </Toolbar>;
}
