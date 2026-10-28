"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CanvasSize, Viewport } from "../../blocks/canvas/models.js";
import { minimapModel } from "../../blocks/canvas/models.js";
import { Button } from "../../components/Button.js";
import { CanvasMap } from "../../components/CanvasMap.js";
import { CanvasZoom } from "../../components/CanvasZoom.js";
import { Slider } from "../../components/Slider.js";
import { SemanticContent } from "../../components/SemanticContent.js";
import { ShellCopyProvider } from "../../components/Banner.copy-context.js";
import type { BuildCatalogData, CompositeEngineInput, CompositeResolved, LayerId, Placement } from "../../catalog-core/index.js";
import { planSurfaceDefaults, type SurfaceDefaultCandidateDocument, type SurfaceDefaultsInput } from "../../catalog-core/surface-defaults.js";
import type { UsageGraph } from "../../catalog-core/usage-graph.js";
import { useOptionalStudioSession } from "../StudioProvider.js";
import { useWholeStudio } from "../WholeStudioProvider.js";
import { CompactPreview } from "../previews.js";
import { Scorecard } from "../Scorecard.js";
import { createRouteStudioLabels } from "../route-labels.js";
import { readStudioCopy, readStudioMessage, studioCopyNeed, type StudioCopyBinding } from "../copy-binding.js";
import type { CompositeStudioSnapshot, StudioLabels } from "../types.js";
import { adoptedPackagePreview, plannedSurfacePreview } from "../library-board-adapter.js";
import { planSurfacePreviews, type PlannedSurfacePreviews } from "../planned-surface-previews.js";
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
  /** The host supplies its locale and Writer resolver; no locale is inferred here. */
  readonly copy: StudioCopyBinding;
  readonly graph?: UsageGraph;
  readonly renderSpecimen?: (leaf: string) => ReactNode;
  readonly viewSize?: CanvasSize;
  readonly initialUrl?: StudioUrl;
  readonly className?: string;
}

/** Preview-only defaults: the catalog's eligible package compositions, never a library mutation or approval. */
export function designerSurfacePreviews(input: CompositeEngineInput, contracts: BuildCatalogData, hosted?: CompositeStudioSnapshot["plannedPreviews"]): PlannedSurfacePreviews {
  const slots = contracts.slots.filter(slot => slot.layer === "sections" || slot.layer === "frames") as SurfaceDefaultsInput["catalog"]["slots"];
  const fills = (input.catalog.surfaces?.fills ?? []) as unknown as readonly SurfaceDefaultCandidateDocument[];
  const plan = planSurfaceDefaults({ catalog: { slots, fills }, slots: slots.map(slot => slot.id), preference: ["foundry"] });
  const defaults = planSurfacePreviews({ plan, fills });
  const previews = { ...defaults.previews, ...hosted?.previews };
  return { previews, sampleState: hosted?.sampleState ?? defaults.sampleState,
    unrenderable: [...defaults.unrenderable, ...plan.rows.filter(row => row.status === "not-chosen").map(row => ({ slot: row.slot, reason: row.reasons.join("; ") }))]
      .filter(row => !Object.hasOwn(previews, row.slot)),
  };
}

/** A selected surface always resolves its actual descriptor; another source's planned row is never substituted. */
export function designerSurfacePreview(leaf: string, profile: CompositeResolved | undefined, planned: PlannedSurfacePreviews | undefined): { node: ReactNode; state: string } | undefined {
  if (profile?.surfaces?.fills[leaf as `sections.${string}`]) {
    const actual = planned ? { ...planned, previews: Object.fromEntries(Object.entries(planned.previews).filter(([id]) => id !== leaf)) } : undefined;
    return adoptedPackagePreview(leaf, profile, actual);
  }
  return plannedSurfacePreview(planned, leaf);
}

/** One page, one camera, one rail: no page tabs, dock registration or mutation port. */
export function DesignerPage({data:supplied,labels:hostLabels,copy,graph:hostGraph,renderSpecimen,viewSize,initialUrl,className,...agent}:DesignerPageProps) {
  const session=useOptionalStudioSession(),whole=useWholeStudio(),inherited=useExplorerPlacements();
  if(!copy||typeof copy.locale!=="string"||!copy.locale||typeof copy.resolver!=="function")studioCopyNeed("studio.copy.binding");
  const data=useMemo(()=>supplied??{placements:inherited},[supplied,inherited]);
  const labels=useMemo(()=>hostLabels??session?.labels??createRouteStudioLabels(copy),[hostLabels,session?.labels,copy]);
  const systemLabels=labels.system??createRouteStudioLabels(copy).system!;
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
  const surfaces=useMemo(()=>whole?.input?designerSurfacePreviews(whole.input,whole.contracts,whole.snapshot?.plannedPreviews):whole?.snapshot?.plannedPreviews,[whole?.input,whole?.contracts,whole?.snapshot?.plannedPreviews]);
  const shellCopy=useMemo(()=>(ref:Parameters<typeof readStudioCopy>[1])=>({ref,text:readStudioCopy(copy,ref,ref.values)}),[copy]);
  const candidate=session?.rows.flatMap(row=>row.candidates).find(candidate=>candidate.fill.slot===selected&&(candidate.selected||candidate.inUseByDefault));
  const documents=whole?.input?[...whole.input.catalog.components.fills,...whole.input.library.components.fills,...(whole.input.catalog.surfaces?.fills??[]),...(whole.input.library.surfaces?.fills??[])]:[];
  const selectedSource=selected?profile?.components.components[selected]?.descriptor.source??Object.values(profile?.surfaces?.fills??{}).find(fill=>fill.document.$extensions["com.clossys.fill"].slot===selected)?.document.$extensions["com.clossys.fill"].source:undefined;
  const meta=documents.find(doc=>doc.$extensions["com.clossys.fill"].slot===selected&&doc.$extensions["com.clossys.fill"].source===selectedSource)?.$extensions["com.clossys.fill"]??candidate?.fill;
  const slot=whole?.contracts.slots.find(slot=>slot.id===selected)??session?.catalog.slots.find(slot=>slot.id===selected);
  const fill:InspectorFill={source:meta?.source,pin:meta?.pin,origin:meta?.mode==="derived"?"derived":meta?.author==="consumer"?"authored":meta?"adopted":undefined,status:slot?.status,constituents:meta?.builtOn,root:slot?.contract.kind==="component"?slot.contract.root:undefined};
  const specimen=(leaf:string):ReactNode=>{
    let node=renderSpecimen?.(leaf)??(profile?whole?.snapshot?.preview?.(leaf,profile):undefined);
    if(node==null&&(leaf.startsWith("sections.")||leaf.startsWith("frames."))){
      const surface=designerSurfacePreview(leaf,profile,surfaces);
      const adopted=Boolean(profile?.surfaces?.fills[leaf as `sections.${string}`]);
      node=surface?<SemanticContent as="div" data-surface-preview={leaf} data-preview-state={adopted?"selected":"planned"} className={leaf.startsWith("frames.")?"h-full min-h-0 min-w-0":"min-w-0"}>
        {!adopted&&labels.plannedPreview?<SemanticContent as="p" className="text-caption text-ink-secondary">{labels.plannedPreview}</SemanticContent>:null}{surface.node}
      </SemanticContent>:<SemanticContent as="div" data-preview-gap={leaf} data-preview-reason={surfaces?.unrenderable.find(row=>row.slot===leaf)?.reason??(adopted?"selected surface has no supported runtime preview":undefined)} className="flex min-h-0 flex-col gap-sm rounded-control border border-line-base p-md"><SemanticContent as="p">{adopted?labels.previewUnavailable:labels.noFill}</SemanticContent></SemanticContent>;
    }
    if(node==null){const value=session?.rows.flatMap(row=>row.candidates).find(c=>c.fill.slot===leaf&&(c.selected||c.inUseByDefault));if(value)node=<CompactPreview candidate={value} labels={labels}/>;}
    return node==null?null:<ShellCopyProvider resolver={shellCopy}>{node}</ShellCopyProvider>;
  };
  const row=layout.rows.find(row=>row.layer===activeLayer);
  const zoomTarget=selected?{layer:resolver.layerOf(selected)!,leaf:selected}:target;
  const map=camera&&row?minimapModel(row.rect,camera.viewport,camera.size):undefined;
  const zoom=(value:number)=>{if(!camera)return;const next:Viewport={...camera.viewport,zoom:Math.min(camera.range.max,Math.max(camera.range.min,value))};handle.current?.setViewport(next);};
  const checks=session?.summary?<Scorecard copy={copy} summary={session.summary} labels={labels} onClose={()=>{}} onIssue={leaf=>{const layer=resolver.layerOf(leaf);if(layer)navigate({layer,leaf});}}/>:<SemanticContent as="p">{whole?.evaluated?.error?readStudioMessage(copy,"studio.evaluation.error"):labels.scorecard.target}</SemanticContent>;
  return <SemanticContent as="section" data-designer-page="" data-designer-ready={session?.ready ? "" : undefined} aria-label={labels.stageLabel} className={"relative flex h-full min-h-0 min-w-0 "+(className??"")}>
    <SemanticContent as="section" data-designer-region="canvas" aria-label={labels.canvas.label} className="relative min-h-0 min-w-0 flex-1">
      <SystemCanvas copy={copy} data={data} labels={{label:labels.canvas.label,hint:labels.canvas.hint,breadcrumb:labels.inspector.relation,layers:labels.layers}} studioLabels={labels} selectedLeaf={selected} edges={graph?.edges} onSelect={select} renderSpecimen={specimen} renderThumbnail={specimen} renderStaticThumbnail={agent.renderStaticThumbnail} handleRef={handle} viewSize={viewSize} onViewChange={report}/>
    </SemanticContent>
    <StudioRail labels={labels} explorer={<ExplorerTree copy={copy} placements={data.placements} labels={labels} activeLayer={activeLayer} selectedLeaf={selected} onNavigate={navigate} onCloseInspector={close}/>} explorerHeader={<LayerSelect placements={data.placements} labels={labels} activeLayer={activeLayer} onNavigate={navigate}/>}
      inspector={<SystemInspector {...agent} copy={copy} identity={selected?identityFor(data.placements,selected,fill):undefined} labels={labels} graph={graph} onClose={close} onNavigate={leaf=>{const layer=resolver.layerOf(leaf);if(layer)navigate({layer,leaf});}} canNavigate={leaf=>layout.cells.has(leaf)} specimen={selected?specimen(selected):undefined} findings={profile?.check.findings.filter(f=>f.subject===selected)}/>}
      map={map&&row&&camera?<CanvasMap label={labels.canvas.minimap} bounds={map.worldBounds} items={row.boards.map(board=>({id:board.id,label:readStudioMessage(copy,`studio.ia.board.${board.id}`),rect:board.rect}))} viewport={camera.viewport} viewSize={camera.size} onViewportChange={next=>handle.current?.setViewport(next)}/>:<SemanticContent as="p">{labels.loading}</SemanticContent>}
      zoom={<SemanticContent as="div" className="flex flex-col gap-sm"><SemanticContent as="div" className="flex flex-wrap gap-xs">{SYSTEM_STOPS.map(stop=><Button key={stop} size="sm" variant="ghost" isDisabled={stop!=="system"&&!zoomTarget||stop==="cell"&&!selected} onPress={()=>handle.current?.fit(stop,zoomTarget)}>{systemLabels.stops[stop]}</Button>)}</SemanticContent>{camera?<><CanvasZoom value={camera.viewport.zoom} min={camera.range.min} max={camera.range.max} onChange={zoom} onFit={()=>handle.current?.fit("system")} formatValue={labels.canvas.zoom} labels={{group:labels.canvas.zoomLabel,out:labels.canvas.zoomOut,in:labels.canvas.zoomIn,fit:labels.canvas.fit,percent:labels.canvas.zoomLabel}}/><Slider label={labels.canvas.zoomLabel} value={camera.viewport.zoom} minValue={camera.range.min} maxValue={camera.range.max} step={Math.max(Number.EPSILON,(camera.range.max-camera.range.min)/100)} onChange={zoom}/></>:null}</SemanticContent>} checks={checks}/>
  </SemanticContent>;
}
