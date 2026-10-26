import { Card } from "@clossys/designer/components/server";
import { PreviewViewport } from "../layouts/preview/PreviewViewport.js";
import type { FlowInstanceBinding as InstanceBinding } from "../../core/instance-binding.js";
import type { EffectivePageLayoutContract } from "../../layouts/resolve.js";
import { columnsAt } from "../../core/flow-stage.js";
import type { BreakpointValues } from "../../core/flow-stage.js";

interface Props {
  readonly binding: InstanceBinding;
  readonly contract?: EffectivePageLayoutContract;
  readonly width: 320 | 768 | 1280;
  readonly theme: "light" | "dark";
  readonly state?: string;
  readonly breakpointValues: BreakpointValues;
}

/** A diagram of assembly data, never evidence of frame/section rendering or LK12. */
export function InstancePlaceholderFrame({ binding, contract, width, theme, state, breakpointValues }: Props) {
  let columns = 1, unresolved = false;
  try { if (contract) columns = columnsAt(contract, width, breakpointValues); } catch { unresolved = true; }
  const columnClasses: Record<number, string> = { 1: "grid grid-cols-1 gap-md", 2: "grid grid-cols-2 gap-md", 3: "grid grid-cols-3 gap-md", 4: "grid grid-cols-4 gap-md", 6: "grid grid-cols-6 gap-md", 12: "grid grid-cols-12 gap-md" };
  if (!columnClasses[columns]) throw new TypeError("Unsupported registered layout column count");
  const slots = [...(contract?.slots.map(slot => slot.id) ?? []), ...Object.keys(binding.fills).filter(slot => !contract?.slots.some(entry => entry.id === slot))];
  const box = "min-w-0 break-words";
  const drawing = <div className="grid gap-md bg-surface-base p-md text-ink-primary" data-instance-placeholder={binding.instanceId}>
    <p>Frame placeholder · {binding.frame.leaf} · pending F5</p>
    <p>Sections are placeholders · pending S4</p>
    <p>{width} px · {theme} · state: {state ?? "default"} · LK12 pending</p>
    <Card variant="outline" className={box}>Header / navigation placeholder</Card>
    {binding.frame.slotFills?.context && <Card variant="outline" className={box}>Frame context · {binding.frame.slotFills.context.section}</Card>}
    <div className="grid gap-md" data-layout-placeholder={binding.layout.leaf}>
      <p>Layout diagram · {binding.layout.leaf} · {binding.layout.config}</p>
      {unresolved && <p>Reflow tokens unresolved; diagram stays in one column.</p>}
      {!contract && <p>Effective layout unavailable; showing supplied slots only.</p>}
      <div data-preview-columns={columns} className={columnClasses[columns]}>
        {slots.map(slot => <div key={slot} className="grid content-start gap-sm" data-placeholder-slot={slot}>
          <p>{slot}</p>
          {(binding.fills[slot] ?? []).length ? binding.fills[slot]!.map((fill, index) => <Card variant="outline" className={box} key={index} data-section-placeholder={fill.section}>
            <p>{index + 1}. {fill.section}</p><p>Config: {fill.config ?? "not supplied"}</p>
            {Object.entries(fill.content).map(([name, ref]) => <p key={name}>{name}: {ref.kind} · {ref.ref}</p>)}
          </Card>) : <Card variant="outline" className={box}>No fill supplied</Card>}
        </div>)}
      </div>
    </div>
    <Card variant="outline" className={box}>Footer placeholder</Card>
    {binding.frame.slotFills?.consent && <Card variant="outline" className={box}>Frame consent · {binding.frame.slotFills.consent.section}</Card>}
  </div>;
  return <PreviewViewport width={width} theme={theme} mode="instance" title={`${binding.label} · ${width} px ${theme} placeholder preview`}>{drawing}</PreviewViewport>;
}
