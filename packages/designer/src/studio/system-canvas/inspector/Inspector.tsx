"use client";
import { useRef, useState, type ReactNode } from "react";
import { EmptyState } from "../../../blocks/EmptyState.js";
import { Button } from "../../../components/Button.js";
import { SemanticContent } from "../../../components/SemanticContent.js";
import type { UsageGraph } from "../../../catalog-core/usage-graph.js";
import { createRouteStudioLabels } from "../../route-labels.js";
import { readStudioCopy, readStudioFinding, readStudioMessage, studioCopyNeed, type StudioCopyBinding, type StudioCopyRef } from "../../copy-binding.js";
import { createStudioUsageLabels } from "../../usage/copy-labels.js";
import { StudioDataValue } from "../../data-value.js";
import { UsagePanel } from "../../usage/UsagePanel.js";
import type { StudioLabels } from "../../types.js";
import type { DesignerAgentData, InspectorIdentity } from "./types.js";
export interface SystemInspectorProps extends DesignerAgentData {
  readonly copy: StudioCopyBinding;
  readonly identity?: InspectorIdentity; readonly labels: StudioLabels; readonly graph?: UsageGraph;
  readonly onNavigate:(leaf:string)=>void; readonly onClose:()=>void; readonly canNavigate:(leaf:string)=>boolean;
  readonly specimen?: ReactNode; readonly findings?: readonly {readonly code:string;readonly message:string; readonly copy?: StudioCopyRef}[];
}
/** Eight read-only parts. The unchanged UsagePanel owns both directed relationship lists and their back stack. */
export function SystemInspector({identity,labels,copy,graph,onNavigate,onClose,canNavigate,specimen,findings=[],changeCommandFor,writeHistory,decisions}:SystemInspectorProps) {
  if(!copy||typeof copy.locale!=="string"||!copy.locale||typeof copy.resolver!=="function")studioCopyNeed("studio.copy.binding");
  const history=useRef({stack:[] as string[]}),[copyState,setCopyState]=useState<"idle"|"copied"|"failed">("idle");
  if(!identity)return <SemanticContent as="section" data-studio-panel="inspector" aria-label={labels.inspectorLabel}><EmptyState title={labels.rail.inspectorEmpty} className="min-w-0 wrap-anywhere"/></SemanticContent>;
  const command=changeCommandFor?.(identity.id),change=command ?? labels.howToChange;
  const text=labels.system??createRouteStudioLabels(copy).system!;
  const rows=writeHistory?.(identity.id) ?? [],fill=identity.fill,reason=decisions?.[identity.id]?.reason;
  const field = (name: string) => readStudioMessage(copy, `designer.inspector.fields.${name}`);
  const path = identity.pathIds?.length ? <span className="flex flex-wrap gap-xs">{identity.pathIds.map(id => <span key={id}>{readStudioMessage(copy, `designer.ia.${identity.layer}.${id}`)}</span>)}</span>
    : identity.path.length ? readStudioMessage(copy, `studio.inspector.path.${identity.id}`) : null;
  const reasonRef = decisions?.[identity.id]?.reasonRef;
  const facts: readonly (readonly [string,ReactNode])[]=[
    [field("itemId"),<StudioDataValue kind="identifier" value={identity.id}/>],
    [field("layer"),labels.layers[identity.layer as keyof StudioLabels["layers"]]??<StudioDataValue kind="identifier" value={identity.layer}/>],
    [labels.inspector.status,<StudioDataValue kind="status" value={identity.status}/>],
    [field("path"),path],
  ];
  const fillFacts: readonly (readonly [string,ReactNode])[]=[
    [labels.inspector.source,fill.source===undefined?labels.inspector.none:<StudioDataValue kind="source" value={fill.source}/>],
    [labels.inspector.pin,fill.pin===undefined?labels.inspector.none:<StudioDataValue kind="hash" value={fill.pin}/>],
    [field("origin"),fill.origin===undefined?labels.inspector.none:<StudioDataValue kind="status" value={fill.origin}/>],
  ];
  return <SemanticContent as="section" aria-label={labels.inspectorLabel} data-studio-panel="inspector" data-selected-leaf={identity.id} className="flex min-w-0 flex-col gap-md wrap-anywhere">
    <Button variant="ghost" size="sm" onPress={onClose}>{labels.canvas.inspectorClose}</Button>
    <SemanticContent as="section" data-inspector-part="identity">
      <SemanticContent as="h2" className="text-body font-semibold"><StudioDataValue kind="identifier" value={identity.id}/></SemanticContent>
      <SemanticContent as="dl">{facts.map(([name,value])=><SemanticContent as="div" key={name}><SemanticContent as="dt" className="text-ink-muted">{name}</SemanticContent><SemanticContent as="dd" className="min-w-0 wrap-anywhere">{value}</SemanticContent></SemanticContent>)}</SemanticContent>
    </SemanticContent>
    <SemanticContent as="section" data-inspector-part="fill"><SemanticContent as="h3">{text.fill}</SemanticContent>
      <SemanticContent as="dl">{fillFacts.map(([name,value])=><SemanticContent as="div" key={name}><SemanticContent as="dt" className="text-ink-muted">{name}</SemanticContent><SemanticContent as="dd" className="min-w-0 wrap-anywhere">{value??labels.inspector.none}</SemanticContent></SemanticContent>)}</SemanticContent>
      {reason ? <SemanticContent as="dl"><SemanticContent as="dt" className="text-ink-muted">{field("reason")}</SemanticContent><SemanticContent as="dd" className="min-w-0 wrap-anywhere">{reasonRef ? readStudioCopy(copy, reasonRef) : readStudioMessage(copy,`studio.inspector.reason.${identity.id}`)}</SemanticContent></SemanticContent>:null}
    </SemanticContent>
    <SemanticContent as="section" data-inspector-part="stack"><SemanticContent as="h3">{text.stack}</SemanticContent><SemanticContent as="dl"><SemanticContent as="dt" className="text-ink-muted">{field("root")}</SemanticContent><SemanticContent as="dd" className="min-w-0 wrap-anywhere">{fill.root===undefined?labels.inspector.none:<StudioDataValue kind="identifier" value={fill.root}/>}</SemanticContent></SemanticContent><SemanticContent as="ul">{fill.constituents?.map(id=><SemanticContent as="li" key={id}><StudioDataValue kind="identifier" value={id}/></SemanticContent>)}</SemanticContent></SemanticContent>
    <SemanticContent as="section" data-inspector-part="dependencies"><SemanticContent as="section" data-inspector-part="connections">
      <UsagePanel copy={copy} id={identity.id} graph={graph} labels={labels.usage??createStudioUsageLabels(copy)} onNavigate={onNavigate} canNavigate={canNavigate} history={history.current}/>
    </SemanticContent></SemanticContent>
    <SemanticContent as="section" data-inspector-part="specimen"><SemanticContent as="h3">{text.specimen}</SemanticContent>{specimen??<SemanticContent as="p">{labels.previewUnavailable}</SemanticContent>}</SemanticContent>
    <SemanticContent as="section" data-inspector-part="checks"><SemanticContent as="h3">{labels.inspector.findings}</SemanticContent>{findings.length?findings.map((finding,index)=><SemanticContent as="p" key={index}><SemanticContent as="code"><StudioDataValue kind="identifier" value={finding.code}/></SemanticContent> {readStudioFinding(copy, finding, `studio.inspector.finding.${finding.code}`)}</SemanticContent>):<SemanticContent as="p">{labels.scorecard.noIssues}</SemanticContent>}</SemanticContent>
    <SemanticContent as="section" data-inspector-part="history"><SemanticContent as="h3">{text.history}</SemanticContent>{rows.length?<SemanticContent as="ul">{rows.map(row=><SemanticContent as="li" key={row.index}><SemanticContent as="dl">{([
      ["historyIndex", <StudioDataValue kind="number" value={row.index}/>],
      ["historyCommand", <StudioDataValue kind="command" value={row.command}/>],
      ["historyContentHash", <StudioDataValue kind="hash" value={row.contentHash}/>],
      ["historyInputs", <StudioDataValue kind="json" value={row.inputs}/>],
    ] as const).map(([name, value]) => <SemanticContent as="div" key={name}><SemanticContent as="dt" className="text-ink-muted">{field(name)}</SemanticContent><SemanticContent as="dd" className="min-w-0 wrap-anywhere">{value}</SemanticContent></SemanticContent>)}</SemanticContent></SemanticContent>)}</SemanticContent>:<SemanticContent as="p">{labels.inspector.none}</SemanticContent>}</SemanticContent>
    {change?<SemanticContent as="div" className="flex flex-col gap-xs" data-inspector-change=""><SemanticContent as="code">{command!==undefined?<StudioDataValue kind="command" value={command}/>:change}</SemanticContent><Button size="sm" onPress={async()=>{try{if(!navigator.clipboard)throw new Error("Clipboard unavailable");await navigator.clipboard.writeText(change);setCopyState("copied");}catch{setCopyState("failed");}}}>{labels.board.copy}</Button><SemanticContent as="span" role="status">{copyState==="copied"?labels.board.copied:copyState==="failed"?labels.board.copyFailed:null}</SemanticContent></SemanticContent>:null}
  </SemanticContent>;
}
