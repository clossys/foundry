"use client";
import { useId, useState } from "react";
import { Button } from "@clossys/designer/components";
import { DataTable, SectionHeader } from "@clossys/designer/blocks";
import type { PublisherProcessItem, PublisherProcessLane, projectPublisherChannelProcess, PublisherChannelItem } from "./publisher-channels.js";

/** One presentation of the shared projection, using the existing public table component. */
export function PublisherChannelProcess({ process, label, onOpen, openItemLabel, outputFor }: {
  readonly process: ReturnType<typeof projectPublisherChannelProcess>;
  readonly label: string;
  readonly onOpen: (item: PublisherProcessItem, opener: HTMLButtonElement) => void;
  readonly outputFor: (row: PublisherChannelItem) => { format: string; export: string; deploy: string };
  readonly openItemLabel?: (label: string, state: string) => string;
}) {
  const id = useId();
  const [expandedLanes, setExpandedLanes] = useState<ReadonlySet<string>>(new Set());
  const [expandedPages, setExpandedPages] = useState<ReadonlySet<string>>(new Set());
  const toggle = (current: ReadonlySet<string>, id: string) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; };
  const open = (item: PublisherProcessItem, inspect = false) => <Button id={`${id}-${inspect ? "inspect" : "open"}-${encodeURIComponent(item.id)}`} type="button" aria-label={inspect ? `Inspect ${item.label}` : openItemLabel?.(item.label, item.state) ?? `Open ${item.label} · ${item.state}`} onPress={event => onOpen(item, event.target as HTMLButtonElement)}>{item.label}</Button>;
  return <>
    <DataTable aria-label={`${label} lane process`} rowKey={lane => lane.id} rows={process.lanes} columns={[
      { id: "lane", header: "Lane", isRowHeader: true, cell: (lane: PublisherProcessLane) => {
        const count = lane.items.filter(item => !item.parentId).length;
        return <Button type="button" aria-expanded={expandedLanes.has(lane.id)} onPress={() => setExpandedLanes(current => toggle(current, lane.id))}>{expandedLanes.has(lane.id) ? "Collapse" : "Expand"} {lane.id} · {count} items · {count - lane.readyCount} not ready</Button>;
      } },
      ...process.stages.map(stage => ({ id: stage, header: stage, cell: (lane: PublisherProcessLane) => <>{lane.items.filter(item => !item.parentId && item.column === stage).map(item => <div key={item.id} data-publisher-item={item.id}>{open(item)}<p>{item.state} · {item.findingCount} findings</p><p>Output format: {outputFor(item.row).format}</p><p>Export: {outputFor(item.row).export} · Deploy: {outputFor(item.row).deploy}</p></div>)}</> })),
    ]} />
    {process.lanes.filter(lane => expandedLanes.has(lane.id)).map(lane => <section key={lane.id} aria-label={`${label} ${lane.id} expanded items`}>
      <SectionHeader level={3} title={`${lane.id} items`} />
      <DataTable aria-label={`${label} ${lane.id} items`} rowKey={item => item.id} rows={lane.items.filter(item => !item.parentId || expandedPages.has(item.parentId))} columns={[
        { id: "item", header: "Item", isRowHeader: true, cell: (item: PublisherProcessItem) => <>{open(item, true)}<p>{item.id}</p>{item.parentId ? <p>Parent page: {item.parentId}{item.parentSubrowId ? ` · Parent subrow: ${item.parentSubrowId}` : ""}</p> : lane.items.some(child => child.parentId === item.id) ? <Button type="button" aria-expanded={expandedPages.has(item.id)} onPress={() => setExpandedPages(current => toggle(current, item.id))}>{expandedPages.has(item.id) ? "Collapse" : "Expand"} {item.label} routes</Button> : null}</> },
        { id: "path", header: "Path / Route", cell: item => item.path ?? "Needs input" },
        { id: "frame", header: "Frame.config", cell: item => item.parentId ? "Parent page owns Frame" : item.frame ?? "Needs input" },
        { id: "layout", header: "Layout.config", cell: item => item.parentId ? "Parent page owns Layout" : item.layout ?? "Needs input" },
        ...process.stages.map(stage => ({ id: stage, header: stage, cell: (item: PublisherProcessItem) => {
          const evidence = item.stages.find(entry => entry.name === stage);
          return evidence ? <span>{!item.configured ? stage === "Configure" ? "to do" : "waiting" : evidence.status}{item.configured && evidence.reasons.length ? ` · ${evidence.reasons.join("; ")}` : ""}</span> : "Parent page owns this stage";
        } })),
        { id: "findings", header: "Findings", cell: item => `${item.findingCount} · ${item.state}` },
      ]} />
    </section>)}
  </>;
}
