"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CanvasSize, Viewport } from "../../blocks/canvas/models.js";
import { minimapModel } from "../../blocks/canvas/models.js";
import { Button } from "../../components/Button.js";
import { CanvasMap } from "../../components/CanvasMap.js";
import { CanvasZoom } from "../../components/CanvasZoom.js";
import { Slider } from "../../components/Slider.js";
import { SemanticContent } from "../../components/SemanticContent.js";
import type { LayerId, Placement } from "../../catalog-core/index.js";
import type { UsageGraph } from "../../catalog-core/usage-graph.js";
import { useOptionalStudioSession } from "../StudioProvider.js";
import { useWholeStudio } from "../WholeStudioProvider.js";
import { CompactPreview } from "../previews.js";
import { Scorecard } from "../Scorecard.js";
import { routeStudioLabels } from "../route-labels.js";
import type { StudioLabels } from "../types.js";
import { useStudioUsageData } from "../usage/StudioUsage.js";
import { ExplorerTree, LayerSelect, useExplorerPlacements } from "../rail/ExplorerTree.js";
import { explorerIndex, explorerNodes } from "../rail/explorer-tree.js";
import { StudioRail } from "../rail/StudioRail.js";
import { SystemCanvas, type SystemCanvasData, type SystemCanvasHandle, type SystemCanvasView } from "./SystemCanvas.js";
import { systemLayout } from "./layout.js";
import type { SystemTarget } from "./navigation.js";
import { SYSTEM_STOPS } from "./stops.js";
import { normaliseStudioUrl, normaliseWindowLocation, replaceStudioLocation, resolverFromPlacements, type StudioUrl } from "./url.js";
import { SystemInspector } from "./inspector/Inspector.js";
import { identityFor } from "./inspector/model.js";
import type { DesignerAgentData, InspectorFill } from "./inspector/types.js";

export interface DesignerPageProps extends DesignerAgentData {
  readonly data?: SystemCanvasData;
  readonly labels?: StudioLabels;
  readonly graph?: UsageGraph;
  readonly renderSpecimen?: (leaf: string) => ReactNode;
  readonly viewSize?: CanvasSize;
  readonly initialUrl?: StudioUrl;
  readonly className?: string;
}
/** One page, one camera, one rail: no page tabs, dock registration or mutation port. */
export function DesignerPage({data:supplied,labels:hostLabels,graph:hostGraph,renderSpecimen,viewSize,initialUrl,className,...agent}:DesignerPageProps) {
  const session=useOptionalStudioSession(),whole=useWholeStudio(),inherited=useExplorerPlacements();
  const data=useMemo(()=>supplied??{placements:inherited},[supplied,inherited]),labels=hostLabels??session?.labels??routeStudioLabels;
  const layout=useMemo(()=>systemLayout(data.placements),[data.placements]);
  const resolver=useMemo(()=>resolverFromPlacements(data.placements),[data.placements]);
  const index=useMemo(()=>explorerIndex(explorerNodes(data.placements,labels.layers)),[data.placements,labels.layers]);
  const canvasTarget=useCallback((raw:SystemTarget):SystemTarget=>{
    if(raw.leaf)return raw;
    const line=raw.l2?[...layout.lines.values()].find(line=>line.id===raw.l2||line.l2===raw.l2||raw.layer+"/"+line.l2===raw.l2):undefined;
    const board=line?layout.boards.get(line.id.slice(0,line.id.lastIndexOf("/"))):raw.l1?[...layout.boards.values()].find(board=>board.id===raw.l1||board.l1===raw.l1):undefined;
    return {...raw,...(board?{l1:board.l1}:{}),...(line?{l2:line.l2}:{})};
  },[layout]);
  const [initial]=useState(()=>initialUrl?normaliseStudioUrl(initialUrl,resolver).location:{});
  const [selected,setSelected]=useState<string|undefined>(()=>initial.node&&layout.cells.has(initial.node)?initial.node:undefined);
  const [activeLayer,setActiveLayer]=useState<LayerId>(initial.layer??data.placements[0]?.layer??"frames");
  const [target,setTarget]=useState<SystemTarget|undefined>(()=>initial.node?index.get(initial.node)?.target:initial.layer?{layer:initial.layer}:undefined);
  const [camera,setCamera]=useState<SystemCanvasView>();
  const requested=useRef<SystemTarget|undefined>(undefined);
  const handle=useRef<SystemCanvasHandle>(null),latest=useRef(session); latest.current=session;
  const usage=useStudioUsageData(hostGraph),graph=usage?.graph;
  const select=useCallback((leaf:string)=>{ const layer=resolver.layerOf(leaf);if(!layer||!layout.cells.has(leaf))return;setSelected(leaf);setActiveLayer(layer);latest.current?.onNavigate({layer,leaf});replaceStudioLocation({layer,node:leaf}); },[resolver,layout]);
  const navigate=useCallback((next:SystemTarget)=>{
    setActiveLayer(next.layer);setTarget(canvasTarget(next));
    if(next.leaf)select(next.leaf);else {setSelected(undefined);latest.current?.select(undefined);latest.current?.onNavigate(next);replaceStudioLocation({layer:next.layer,node:(next.l2??next.l1)?next.layer+"/"+(canvasTarget(next).l2??canvasTarget(next).l1):undefined});}
  },[select,canvasTarget]);
  const close=useCallback(()=>{setSelected(undefined);latest.current?.select(undefined);replaceStudioLocation({layer:activeLayer});},[activeLayer]);
  useEffect(()=>{
    const read=()=>{
      const location=initialUrl?normaliseStudioUrl(initialUrl,resolver).location:normaliseWindowLocation(resolver);
      const next=location.node?index.get(location.node)?.target:location.layer?{layer:location.layer}:undefined;
      setSelected(next?.leaf);if(next)setActiveLayer(next.layer);setTarget(next?canvasTarget(next):undefined);
      if(!next)handle.current?.fit("system");
    };
    read();window.addEventListener("popstate",read);window.addEventListener("hashchange",read);
    return()=>{window.removeEventListener("popstate",read);window.removeEventListener("hashchange",read);};
  },[resolver,index,initialUrl,canvasTarget]);
  useEffect(()=>{if(target&&camera&&requested.current!==target){requested.current=target;handle.current?.navigateTo(target);}},[target,camera?.size.width,camera?.size.height]);
  useEffect(()=>{let active=true;const escape=(event:KeyboardEvent)=>{if(event.key==="Escape")queueMicrotask(()=>{if(active&&!event.defaultPrevented)close();});};document.addEventListener("keydown",escape,true);return()=>{active=false;document.removeEventListener("keydown",escape,true);};},[close]);
  const report=useCallback((next:SystemCanvasView)=>setCamera(current=>current&&current.viewport.x===next.viewport.x&&current.viewport.y===next.viewport.y&&current.viewport.zoom===next.viewport.zoom&&current.size.width===next.size.width&&current.size.height===next.size.height&&current.layer===next.layer&&current.board===next.board&&current.line===next.line&&current.range.min===next.range.min&&current.range.max===next.range.max?current:next),[]);
  const profile=whole?.evaluated?.value?.profile;
  const candidate=session?.rows.flatMap(row=>row.candidates).find(candidate=>candidate.fill.slot===selected&&(candidate.selected||candidate.inUseByDefault));
  const documents=whole?.input?[...whole.input.catalog.components.fills,...whole.input.library.components.fills,...(whole.input.catalog.surfaces?.fills??[]),...(whole.input.library.surfaces?.fills??[])]:[];
  const selectedSource=selected?profile?.components.components[selected]?.descriptor.source??Object.values(profile?.surfaces?.fills??{}).find(fill=>fill.document.$extensions["com.clossys.fill"].slot===selected)?.document.$extensions["com.clossys.fill"].source:undefined;
  const meta=documents.find(doc=>doc.$extensions["com.clossys.fill"].slot===selected&&doc.$extensions["com.clossys.fill"].source===selectedSource)?.$extensions["com.clossys.fill"]??candidate?.fill;
  const slot=whole?.contracts.slots.find(slot=>slot.id===selected)??session?.catalog.slots.find(slot=>slot.id===selected);
  const fill:InspectorFill={source:meta?.source,pin:meta?.pin,origin:meta?.mode==="derived"?"derived":meta?.author==="consumer"?"authored":meta?"adopted":undefined,status:slot?.status,constituents:meta?.builtOn,root:slot?.contract.kind==="component"?slot.contract.root:undefined};
  const specimen=(leaf:string):ReactNode=>renderSpecimen?.(leaf)??(profile?whole?.snapshot?.preview?.(leaf,profile):undefined)??(session?.rows.flatMap(row=>row.candidates).find(c=>c.fill.slot===leaf&&(c.selected||c.inUseByDefault)) ? <CompactPreview candidate={session.rows.flatMap(row=>row.candidates).find(c=>c.fill.slot===leaf&&(c.selected||c.inUseByDefault))!} labels={labels}/>:null);
  const row=layout.rows.find(row=>row.layer===activeLayer);
  const zoomTarget=selected?{layer:resolver.layerOf(selected)!,leaf:selected}:target;
  const map=camera&&row?minimapModel(row.rect,camera.viewport,camera.size):undefined;
  const zoom=(value:number)=>{if(!camera)return;const next:Viewport={...camera.viewport,zoom:Math.min(camera.range.max,Math.max(camera.range.min,value))};handle.current?.setViewport(next);};
  const checks=session?.summary?<Scorecard summary={session.summary} labels={labels} onClose={()=>{}} onIssue={leaf=>{const layer=resolver.layerOf(leaf);if(layer)navigate({layer,leaf});}}/>:<SemanticContent as="p">{whole?.evaluated?.error??labels.scorecard.target}</SemanticContent>;
  return <SemanticContent as="section" data-designer-page="" data-designer-ready={session?.ready ? "" : undefined} aria-label={labels.stageLabel} className={"relative flex h-full min-h-0 min-w-0 "+(className??"")}>
    <SemanticContent as="section" data-designer-region="canvas" aria-label={labels.canvas.label} className="relative min-h-0 min-w-0 flex-1">
      <SystemCanvas data={data} labels={{label:labels.canvas.label,hint:labels.canvas.hint,breadcrumb:labels.inspector.relation,layers:labels.layers}} studioLabels={labels} selectedLeaf={selected} edges={graph?.edges} onSelect={select} renderSpecimen={specimen} renderThumbnail={specimen} renderStaticThumbnail={agent.renderStaticThumbnail} handleRef={handle} viewSize={viewSize} onViewChange={report}/>
    </SemanticContent>
    <StudioRail labels={labels} explorer={<ExplorerTree placements={data.placements} labels={labels} activeLayer={activeLayer} selectedLeaf={selected} onNavigate={navigate} onCloseInspector={close}/>} explorerHeader={<LayerSelect placements={data.placements} labels={labels} activeLayer={activeLayer} onNavigate={navigate}/>}
      inspector={<SystemInspector {...agent} identity={selected?identityFor(data.placements,selected,fill):undefined} labels={labels} graph={graph} onClose={close} onNavigate={leaf=>{const layer=resolver.layerOf(leaf);if(layer)navigate({layer,leaf});}} canNavigate={leaf=>layout.cells.has(leaf)} specimen={selected?specimen(selected):undefined} findings={profile?.check.findings.filter(f=>f.subject===selected)}/>}
      map={map&&row&&camera?<CanvasMap label={labels.canvas.minimap} bounds={map.worldBounds} items={row.boards.map(board=>({id:board.id,label:board.label,rect:board.rect}))} viewport={camera.viewport} viewSize={camera.size} onViewportChange={next=>handle.current?.setViewport(next)}/>:<SemanticContent as="p">{labels.loading}</SemanticContent>}
      zoom={<SemanticContent as="div" className="flex flex-col gap-sm"><SemanticContent as="div" className="flex flex-wrap gap-xs">{SYSTEM_STOPS.map(stop=><Button key={stop} size="sm" variant="ghost" isDisabled={stop!=="system"&&!zoomTarget||stop==="cell"&&!selected} onPress={()=>handle.current?.fit(stop,zoomTarget)}>{(labels.system??routeStudioLabels.system!).stops[stop]}</Button>)}</SemanticContent>{camera?<><CanvasZoom value={camera.viewport.zoom} min={camera.range.min} max={camera.range.max} onChange={zoom} onFit={()=>handle.current?.fit("system")} labels={{group:labels.canvas.zoomLabel,out:labels.canvas.zoomOut,in:labels.canvas.zoomIn,fit:labels.canvas.fit,percent:labels.canvas.zoomLabel}}/><Slider label={labels.canvas.zoomLabel} value={camera.viewport.zoom} minValue={camera.range.min} maxValue={camera.range.max} step={Math.max(Number.EPSILON,(camera.range.max-camera.range.min)/100)} onChange={zoom}/></>:null}</SemanticContent>} checks={checks}/>
  </SemanticContent>;
}
