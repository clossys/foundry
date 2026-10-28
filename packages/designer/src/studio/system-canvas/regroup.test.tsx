import { studioTestCopy } from "../__fixtures__/copy.js";
import { expect, it } from "vitest";
import { loadBuildCatalog, type Placement, type PlacementNode } from "../../catalog-core/index.js";
import { checkFrozenLeafSets } from "../../catalog-core/leaf-freeze.js";
import { trailAt } from "./breadcrumb.js";
import { centreOn } from "./stops.js";
import { systemLayout } from "./layout.js";
import { identityFor } from "./inspector/model.js";
import { normaliseStudioUrl, resolverFromPlacements } from "./url.js";
it("regroups a Sections leaf without changing its identity, fill, URL, frozen membership or any leaf id",()=>{
 const build=loadBuildCatalog(), before=build.placements, after=structuredClone(before) as Placement[];
 const leaves:(PlacementNode & {leaves:string[]})[]=[];
 const visit=(nodes:readonly PlacementNode[])=>nodes.forEach(node=>{"leaves" in node?leaves.push(node as PlacementNode & {leaves:string[]}):visit(node.children);});
 visit(after.find(p=>p.layer==="sections")!.nodes);
 const from=leaves.find(n=>n.leaves.includes("sections.pagination"))!,to=leaves.find(n=>n!==from)!;
 expect(from).toBeDefined();expect(to).toBeDefined();from.leaves.splice(from.leaves.indexOf("sections.pagination"),1);to.leaves.push("sections.pagination");
 const a=systemLayout(before),b=systemLayout(after),leaf="sections.pagination",cell=b.cells.get(leaf)!;
 expect(cell.l2).toBe(to.id);
 expect(trailAt(b,centreOn(cell.rect,{width:800,height:600},1),{width:800,height:600}).line?.label).toBe(to.label);expect(cell.line).not.toBe(a.cells.get(leaf)!.line);expect([...b.cells.keys()].sort()).toEqual([...a.cells.keys()].sort());
 for(const placements of [before,after]) {
  expect(checkFrozenLeafSets(placements,build.slots,["tokens","assets","components"])).toEqual([]);
  expect(normaliseStudioUrl({search:"?node="+leaf,hash:""},resolverFromPlacements(placements)).location.node).toBe(leaf);
  for(const id of systemLayout(placements).cells.keys())expect(id).toMatch(/^(tokens|assets|components|sections|frames)\.[a-z0-9-]+$/);
 }
 const info={source:"foundry",pin:"recorded",origin:"composed"};
 expect(identityFor(after,leaf,info).path).toContain(to.label);
 expect(identityFor(after,leaf,info).id).toBe(identityFor(before,leaf,info).id);
 expect(identityFor(after,leaf,info).fill).toEqual(identityFor(before,leaf,info).fill);
});

import { createRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { SystemCanvas, type SystemCanvasHandle } from "./SystemCanvas.js";
import { testLabels } from "./__fixtures__/system.js";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("keeps the mounted cell keyed by leaf when its L2 changes",()=>{
 vi.stubGlobal("matchMedia",()=>({matches:true,addEventListener(){},removeEventListener(){}}));
 const before=loadBuildCatalog().placements,after=structuredClone(before) as Placement[];
 const parts=after.find(p=>p.layer==="sections")!.nodes.find(n=>"children" in n&&n.children.some(c=>"leaves" in c&&c.leaves.includes("sections.pagination")))!;
 if(!("children" in parts))throw new Error("Expected L1");
 const from=parts.children.find(n=>"leaves" in n&&n.leaves.includes("sections.pagination"))!,to=parts.children.find(n=>n!==from&&"leaves" in n)!;
 if(!("leaves" in from)||!("leaves" in to))throw new Error("Expected L2");
 from.leaves=from.leaves.filter(id=>id!=="sections.pagination");to.leaves=[...to.leaves,"sections.pagination"];
 const handle=createRef<SystemCanvasHandle>();
 const page=(placements:readonly Placement[])=><SystemCanvas copy={studioTestCopy} data={{placements}} labels={testLabels} viewSize={{width:1200,height:800}} handleRef={handle} renderStaticThumbnail={leaf=><span data-stable-probe={leaf}/>}/>;
 const view=render(page(before));act(()=>handle.current!.fit("cell",{layer:"sections",leaf:"sections.pagination"}));
 const cell=view.container.querySelector('[data-system-cell="sections.pagination"]');expect(cell).not.toBeNull();
 const probe=cell!.querySelector("[data-stable-probe]");expect(probe).not.toBeNull();
 view.rerender(page(after));
 expect(view.container.querySelector('[data-system-cell="sections.pagination"]')).toBe(cell);
 expect(cell!.querySelector("[data-stable-probe]")).toBe(probe);
});
