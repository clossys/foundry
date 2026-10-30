"use client";
import { Badge, Card, CardContent, Tree } from "@clossys/designer/components";

import { DetailView, Panel, SectionHeader } from "@clossys/designer/blocks";
import { useId, useState } from "react";
import type { ConsumerInstanceLibrary, FlowInstanceBinding as InstanceBinding } from "../../core/instance-binding.js";
import { FORMAT_IA } from "../../formats/index.js";
import type { FormatIA, FormatId, FormatLeaf, FormatSize } from "../../formats/contract.js";
import { PublisherCompositionsView } from "../compositions/PublisherCompositionsView.js";
import type { BreakpointValues } from "../../core/flow-stage.js";

export interface PublisherFormatsViewProps {
  /** The same injected registry used by instance checks; no implicit registry fallback. */
  readonly formats: readonly FormatLeaf[];
  readonly selectedFormatId?: FormatId;
  readonly onSelectFormat?: (id: FormatId) => void;
  readonly ia?: FormatIA;
  readonly instances: readonly InstanceBinding[];
  readonly library: ConsumerInstanceLibrary;
  readonly breakpointValues: BreakpointValues;
  readonly designerHref: string;
  readonly packLabels?: Readonly<Record<string, string>>;
  readonly fixtureLibrary?: boolean;
  /** @default "Final deliveries" */
  readonly deliveriesLabel?: string;
  /** @default "Choose editable or flat" */
  readonly fidelityChoiceLabel?: string;
}
function sizeLabel(size: FormatSize): string {
  switch (size.kind) {
    case "responsive": return "Responsive · breakpoint tokens";
    case "fixed": return `${size.width}${size.height === undefined ? "" : ` × ${size.height}`} ${size.unit}`;
    case "paper": return `${size.width} × ${size.height} ${size.unit}`;
    case "aspect-ratio": return `${size.width}:${size.height}`;
  }
}

/** Generation configuration: medium > family > leaf, with existing layout contracts inside each format. */
export function PublisherFormatsView({ formats, ia = FORMAT_IA, instances, library, breakpointValues, designerHref, packLabels, selectedFormatId, onSelectFormat, fixtureLibrary = false, deliveriesLabel = "Final deliveries", fidelityChoiceLabel = "Choose editable or flat" }: PublisherFormatsViewProps) {
  const id = useId();
  const [chosen, setChosen] = useState<FormatId>();
  const placements = ia.nodes.flatMap(medium => medium.children.flatMap(family => family.leaves));
  const available = placements.flatMap(formatId => {
    const format = formats.find(format => format.id === formatId);
    return format ? [format] : [];
  });
  const selected = available.find(format => format.id === (selectedFormatId ?? chosen)) ?? available[0];
  const members = selected ? instances.filter(instance => instance.format === selected.id) : [];
  const usedBy = [...new Set([...(selected?.usedByPacks ?? []), ...members.flatMap(instance => instance.packIds)])];
  return <section aria-labelledby={`${id}-title`} className="grid min-w-0 gap-lg text-ink-primary">
    <SectionHeader id={`${id}-title`} title="Formats" actions={fixtureLibrary ? <Badge variant="secondary">fixture library</Badge> : undefined}
      description="Generation configuration · medium, family, format. Layouts are the allowed compositions within a format." />
    <div className="grid min-w-0 gap-lg desktop:grid-cols-[var(--ui-layout-sidebar-w)_minmax(0,1fr)]">
      <Card><CardContent><nav aria-label="Formats by medium and family">
        <Tree aria-label="Formats by medium and family" selectionMode="single" defaultExpandedKeys={ia.nodes.flatMap(medium => [medium.id, ...medium.children.map(family => family.id)])} selectedKeys={selected ? [selected.id] : []} onSelectionChange={keys => {
          if (keys === "all") return;
          const id = String([...keys][0] ?? "");
          if (available.some(format => format.id === id)) { setChosen(id as FormatId); onSelectFormat?.(id as FormatId); }
        }}>
          {ia.nodes.map(medium => <Tree.Node key={medium.id} id={medium.id} textValue={medium.label} expandLabel={medium.label} label={medium.label}>
            {medium.children.map(family => <Tree.Node key={family.id} id={family.id} textValue={family.label} expandLabel={family.label} label={family.label}>
              {family.leaves.flatMap(formatId => {
                const format = formats.find(format => format.id === formatId);
                return format ? [<Tree.Node key={format.id} id={format.id} textValue={format.label} expandLabel={format.label} label={<span className="grid gap-xs"><strong>{format.label}</strong><span className="text-sm">{format.id} · {format.status === "concept" ? "concept only" : "built"}</span></span>} />] : [];
              })}
            </Tree.Node>)}
          </Tree.Node>)}
        </Tree>
      </nav></CardContent></Card>
      {selected ? <section aria-labelledby={`${id}-selected`} className="grid min-w-0 content-start gap-lg">
        <Panel header={<SectionHeader id={`${id}-selected`} level={3} title={selected.label} actions={<Badge>{selected.status === "concept" ? "Concept only" : "Built"}</Badge>} />}>
          <p>{selected.id}</p>
          <DetailView fields={[
            { label: "Output type", value: selected.outputType.toUpperCase() },
            { label: "Size / aspect ratio", value: sizeLabel(selected.size) },
            ...(selected.size.kind === "responsive" ? [{ label: "Breakpoints", value: <ul>{selected.size.breakpoints.map(token => <li key={token}>{token} · {breakpointValues[token] === undefined ? "unresolved" : `${breakpointValues[token]} px`}</li>)}</ul> }] : []),
            ...(selected.fps !== undefined ? [{ label: "Frame rate", value: `${selected.fps} fps` }] : []),
            { label: "Arrangement model", value: selected.arrangement },
            { label: "Frames", value: selected.frames.length ? selected.frames.join(" · ") : "None registered" },
            { label: "Used by packs", value: usedBy.length ? usedBy.map(pack => packLabels?.[pack] ?? pack).join(" · ") : "No pack references" },
          ]} />
          <section aria-label={deliveriesLabel}><SectionHeader level={4} title={deliveriesLabel} /><ul>{selected.deliveries.map(delivery => <li key={delivery.id}>{delivery.label} · {delivery.status}{delivery.fidelityChoices && <span> · {fidelityChoiceLabel}: {delivery.fidelityChoices.join(" / ")}</span>}</li>)}</ul></section>
          {selected.heldCompositions.length > 0 && <p>Held compositions: {selected.heldCompositions.join(", ")}</p>}
          {selected.status === "concept" ? <p>Concept configuration only. No renderer is available; instances cannot use this format.</p> : <p>{members.length} instance references · static and rendered evidence determine readiness in each pack.</p>}
        </Panel>
        <section aria-labelledby={`${id}-compositions`} className="grid min-w-0 gap-md"><SectionHeader id={`${id}-compositions`} level={3} title="Allowed compositions" />
          {selected.status === "concept" ? <p>No compositions or instance previews are available for a concept format.</p> : <PublisherCompositionsView
            library={{ id: library.id, role: library.role, resolveFill: (leaf, config) => library.resolveFill(leaf, config), instances: members }}
            breakpointValues={breakpointValues} designerHref={designerHref} allowedLayoutIds={selected.allowedCompositions} />}
        </section>
      </section> : <p>No registered formats supplied.</p>}
    </div>
  </section>;
}
