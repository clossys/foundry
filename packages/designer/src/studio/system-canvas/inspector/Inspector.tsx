"use client";
import { useRef, useState, type ReactNode } from "react";
import { Button } from "../../../components/Button.js";
import { SemanticContent } from "../../../components/SemanticContent.js";
import type { UsageGraph } from "../../../catalog-core/usage-graph.js";
import { routeStudioLabels } from "../../route-labels.js";
import { UsagePanel, type UsagePanelLabels } from "../../usage/UsagePanel.js";
import type { StudioLabels } from "../../types.js";
import type { DesignerAgentData, InspectorIdentity } from "./types.js";
export const DEFAULT_USAGE_LABELS: UsagePanelLabels = {
  title:"Relationships",using:"Dependencies",usedWhere:"Connections",reads:"Reads",composes:"Composes",options:"Options",owns:"Owns",exceptions:"Exceptions",transitive:"Transitive",back:"Back",usedNowhere:"Used nowhere",notLinked:"Not linked",loading:"Loading",none:"None",
  layer:{tokens:"Tokens",assets:"Assets",components:"Components",sections:"Sections",frames:"Frames",pages:"Pages"},kind:{reads:"Reads",composes:"Composes",hosts:"Hosts",renders:"Renders"},evidence:{declared:"Declared",scanned:"Scanned",runtime:"Runtime"},count:count=>String(count),
};
export interface SystemInspectorProps extends DesignerAgentData {
  readonly identity?: InspectorIdentity; readonly labels: StudioLabels; readonly graph?: UsageGraph;
  readonly onNavigate:(leaf:string)=>void; readonly onClose:()=>void; readonly canNavigate:(leaf:string)=>boolean;
  readonly specimen?: ReactNode; readonly findings?: readonly {readonly code:string;readonly message:string}[];
}
/** Eight read-only parts. The unchanged UsagePanel owns both directed relationship lists and their back stack. */
export function SystemInspector({identity,labels,graph,onNavigate,onClose,canNavigate,specimen,findings=[],changeCommandFor,writeHistory,decisions}:SystemInspectorProps) {
  const history=useRef({stack:[] as string[]}),[copyState,setCopyState]=useState<"idle"|"copied"|"failed">("idle");
  if(!identity)return <SemanticContent as="section" data-studio-panel="inspector" aria-label={labels.inspectorLabel}><SemanticContent as="p">{labels.rail.inspectorEmpty}</SemanticContent></SemanticContent>;
  const command=changeCommandFor?.(identity.id),change=command ?? labels.howToChange;
  const text=labels.system??routeStudioLabels.system!;
  const rows=writeHistory?.(identity.id) ?? [],fill=identity.fill,reason=decisions?.[identity.id]?.reason;
  const facts=[[labels.inspector.representedLeaf,identity.id],[labels.layers.label,labels.layers[identity.layer as keyof StudioLabels["layers"]] ?? identity.layer],[labels.inspector.status,identity.status],[labels.inspector.relation,identity.path.join(" › ")]];
  return <SemanticContent as="section" aria-label={labels.inspectorLabel} data-studio-panel="inspector" data-selected-leaf={identity.id} className="flex min-w-0 flex-col gap-md">
    <Button variant="ghost" size="sm" onPress={onClose}>{labels.canvas.inspectorClose}</Button>
    <SemanticContent as="section" data-inspector-part="identity">
      <SemanticContent as="h2" className="text-body font-semibold">{identity.id}</SemanticContent>
      <SemanticContent as="dl">{facts.map(([name,value])=><SemanticContent as="div" key={name}><SemanticContent as="dt">{name}</SemanticContent><SemanticContent as="dd">{value}</SemanticContent></SemanticContent>)}</SemanticContent>
    </SemanticContent>
    <SemanticContent as="section" data-inspector-part="fill"><SemanticContent as="h3">{text.fill}</SemanticContent>
      <SemanticContent as="dl">{[[labels.inspector.source,fill.source],[labels.inspector.pin,fill.pin===undefined?undefined:JSON.stringify(fill.pin)],[labels.inspector.mode,fill.origin]].map(([name,value])=><SemanticContent as="div" key={name}><SemanticContent as="dt">{name}</SemanticContent><SemanticContent as="dd">{value??labels.inspector.none}</SemanticContent></SemanticContent>)}</SemanticContent>
      {reason ? <SemanticContent as="p">{reason}</SemanticContent>:null}
    </SemanticContent>
    <SemanticContent as="section" data-inspector-part="stack"><SemanticContent as="h3">{text.stack}</SemanticContent><SemanticContent as="p">{fill.root??labels.inspector.none}</SemanticContent><SemanticContent as="ul">{fill.constituents?.map(id=><SemanticContent as="li" key={id}>{id}</SemanticContent>)}</SemanticContent></SemanticContent>
    <SemanticContent as="section" data-inspector-part="dependencies"><SemanticContent as="section" data-inspector-part="connections">
      <UsagePanel id={identity.id} graph={graph} labels={labels.usage??DEFAULT_USAGE_LABELS} onNavigate={onNavigate} canNavigate={canNavigate} history={history.current}/>
    </SemanticContent></SemanticContent>
    <SemanticContent as="section" data-inspector-part="specimen"><SemanticContent as="h3">{text.specimen}</SemanticContent>{specimen??<SemanticContent as="p">{labels.previewUnavailable}</SemanticContent>}</SemanticContent>
    <SemanticContent as="section" data-inspector-part="checks"><SemanticContent as="h3">{labels.inspector.findings}</SemanticContent>{findings.length?findings.map((finding,index)=><SemanticContent as="p" key={index}><SemanticContent as="code">{finding.code}</SemanticContent> {finding.message}</SemanticContent>):<SemanticContent as="p">{labels.scorecard.noIssues}</SemanticContent>}</SemanticContent>
    <SemanticContent as="section" data-inspector-part="history"><SemanticContent as="h3">{text.history}</SemanticContent>{rows.length?<SemanticContent as="ul">{rows.map(row=><SemanticContent as="li" key={row.index}><SemanticContent as="code">{row.command}</SemanticContent><SemanticContent as="p">{row.contentHash}</SemanticContent><SemanticContent as="code">{JSON.stringify(row.inputs)}</SemanticContent></SemanticContent>)}</SemanticContent>:<SemanticContent as="p">{labels.inspector.none}</SemanticContent>}</SemanticContent>
    {change?<SemanticContent as="div" className="flex flex-col gap-xs" data-inspector-change=""><SemanticContent as="code">{change}</SemanticContent><Button size="sm" onPress={async()=>{try{if(!navigator.clipboard)throw new Error("Clipboard unavailable");await navigator.clipboard.writeText(change);setCopyState("copied");}catch{setCopyState("failed");}}}>{labels.board.copy}</Button><SemanticContent as="span" role="status">{copyState==="copied"?labels.board.copied:copyState==="failed"?labels.board.copyFailed:null}</SemanticContent></SemanticContent>:null}
  </SemanticContent>;
}
