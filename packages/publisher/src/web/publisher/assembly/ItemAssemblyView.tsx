"use client";
import { Link } from "@clossys/designer/components";
import { Badge, Button, Card } from "@clossys/designer/components";
import { CanvasSurface, SectionHeader, type CanvasItem } from "@clossys/designer/blocks";

import { useId, useState } from "react";
import type { InstanceRegistries } from "../../../core/instance-binding.js";
import type { PublisherPipelineItem, PublishStageStatus } from "../pipeline.js";
import { deriveItemAssembly } from "./assembly.js";
import type { AssemblyOwnerHref } from "./assembly.js";

export interface ItemAssemblyViewProps {
  readonly item: PublisherPipelineItem;
  readonly registries: InstanceRegistries;
  readonly designerHref: string;
  readonly ownerHref?: AssemblyOwnerHref;
  readonly onOpenFormats: () => void;
  /** Targets supplied by the existing item inspector; no duplicate evidence panels. */
  readonly targetPrefix: string;
}
const card = "grid min-w-0 content-start gap-sm break-words";
function StatusChip({ status }: { status: PublishStageStatus }) {
  return <Badge variant={status === "passed" ? "success" : status === "failed" ? "danger" : "warning"}>{status}</Badge>;
}

/** Fixed owner lanes fan into the instance; edges express supplied assembly inputs only. */
export function ItemAssemblyView({ item, registries, designerHref, ownerHref, onOpenFormats, targetPrefix }: ItemAssemblyViewProps) {
  const id = useId();
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const nodes = deriveItemAssembly(item, registries);
  const instanceStatus = item.state === "failed" ? "failed" : "pending";
  const checks = item.stages.find(stage => stage.name === "Checks")!;
  const inspectorId = `${targetPrefix}-inspector`;
  const checksId = `${targetPrefix}-checks`;
  const renderId = `${targetPrefix}-render`;
  return <section aria-labelledby={`${id}-title`} className="grid min-w-0 gap-lg">
    <SectionHeader id={`${id}-title`} level={3} title="Item assembly" actions={<Link href={designerHref}>Open Designer</Link>} description="Owner inputs → instance → checks → render. Status describes supplied evidence; registration and placeholder rendering do not prove runtime qualification." />
    <Card variant="outline" role="region" aria-label="Scrollable item assembly" tabIndex={0} className="min-w-0 overflow-x-auto">
      <CanvasSurface aria-label="Item assembly diagram" viewport={viewport} onViewportChange={setViewport} selection={[]} onSelectionChange={() => {}}
        itemInteraction="content" viewSize={{ width: 1232, height: 1648 }} worldBounds={{ x: 0, y: 0, width: 1232, height: 1648 }}
        items={[
          ...nodes.flatMap((node, index): CanvasItem[] => [
            { id: `owner.${node.owner}`, label: node.owner, rect: { x: 16, y: 16 + index * 232, width: 112, height: 224 } },
            { id: `input.${node.owner}`, label: `${node.owner} assembly lane`, rect: { x: 152, y: 16 + index * 232, width: 416, height: 224 } },
          ]),
          { id: "instance", label: "Assembled instance", rect: { x: 592, y: 712, width: 192, height: 224 } },
          { id: "checks", label: "Assembly check results", rect: { x: 808, y: 712, width: 192, height: 224 } },
          { id: "render", label: "Assembly render result", rect: { x: 1024, y: 712, width: 192, height: 224 } },
        ]} edges={[
          ...nodes.filter(node => node.references.length).map(node => ({ id: `${node.owner}-instance`, from: `input.${node.owner}`, to: "instance" })),
          { id: "instance-checks", from: "instance", to: "checks" }, { id: "checks-render", from: "checks", to: "render" },
        ]} renderItem={canvasItem => {
          const node = nodes.find(node => canvasItem.id === `input.${node.owner}` || canvasItem.id === `owner.${node.owner}`);
          if (node && canvasItem.id.startsWith("owner.")) return <SectionHeader level={4} title={node.owner} />;
          if (node) {
            const href = node.owner === "Format" ? undefined : ownerHref?.(node);
            return <Card variant="outline" className={`h-full overflow-y-auto ${card}`}>
              <SectionHeader level={4} title={node.summary} actions={<StatusChip status={node.status} />} />
              {node.references.length > 0 && <ul className="grid gap-xs text-sm">{node.references.map(reference => <li key={reference}>{reference}</li>)}</ul>}
              <p className="text-sm">{node.detail}</p>
              {node.findings.length > 0 && <ul className="text-sm">{node.findings.map((finding, i) => <li key={i}>{finding.code} · {finding.path}: {finding.message}</li>)}</ul>}
              {node.owner === "Format" ? <Button variant="secondary" type="button" onPress={onOpenFormats} aria-controls={`${targetPrefix}-formats`}>Open Formats</Button> : href ? <Link href={href}>Open {node.owner} in Designer</Link> : null}
            </Card>;
          }
          if (canvasItem.id === "instance") return <Card variant="outline" className={card}><SectionHeader level={4} title="Instance" /><StatusChip status={instanceStatus} /><p>{item.binding.label}</p><p className="text-sm">{item.binding.instanceId}</p><p className="text-sm">{item.binding.path ?? "No route path"}</p><Link href={`#${inspectorId}`}>Open item inspector</Link></Card>;
          if (canvasItem.id === "checks") return <Card variant="outline" className={card}><SectionHeader level={4} title="Checks" /><StatusChip status={checks.status} /><p>{item.findings.length} static findings</p><ul className="text-sm">{checks.findings.map((finding, index) => <li key={index}>{finding.code} · {finding.path}: {finding.message}</li>)}{checks.pending.map((reason, index) => <li key={`pending-${index}`}>{reason}</li>)}</ul><Link href={`#${checksId}`}>Open check evidence</Link></Card>;
          if (canvasItem.id === "render") return <Card variant="outline" className={card}><SectionHeader level={4} title="Render" /><StatusChip status="pending" /><p>Placeholder preview only</p><p className="text-sm">Frame and section runtime qualification unavailable. Ready remains pending.</p><Link href={`#${renderId}`}>Open placeholder render</Link></Card>;
          throw new TypeError("Unknown assembly canvas item");
        }} />
    </Card>
  </section>;
}
