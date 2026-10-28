import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildUsageGraph } from "../../../catalog-core/usage-graph.js";
import { DesignerPage } from "../DesignerPage.js";
import { testPlacements } from "../__fixtures__/system.js";
import { createRouteStudioLabels } from "../../route-labels.js";
import { studioTestCopy } from "../../__fixtures__/copy.js";
const routeStudioLabels=createRouteStudioLabels(studioTestCopy);
const graph = buildUsageGraph({ inventory: { tokens:["tokens.accent-color"], components:["components.button","components.menu"], sections:["sections.band"], frames:["frames.site-shell"] }, selection:{},
  runtime:[{from:"components.button",to:"tokens.accent-color",kind:"reads",route:"example",selector:"button"},{from:"sections.band",to:"components.button",kind:"composes",route:"example",selector:"button"},{from:"frames.site-shell",to:"sections.band",kind:"hosts",route:"example",selector:"section"},{from:"components.menu",to:"tokens.accent-color",kind:"reads",route:"example",selector:"button"}] });
afterEach(()=>{cleanup();localStorage.clear();window.history.replaceState(null,"","/");vi.unstubAllGlobals();});
function setup(extra: Partial<React.ComponentProps<typeof DesignerPage>> = {}) {
  return render(<DesignerPage data={{placements:testPlacements}} copy={studioTestCopy} labels={{...routeStudioLabels, howToChange:"Ask the coding agent"}} graph={graph} initialUrl={{search:"?node=components.button",hash:""}} viewSize={{width:1200,height:800}} {...extra}/>);
}
it("lights exactly self plus separate uses/usedBy closures, never a sibling sharing a dependency",()=>{
  const view=setup();expect(view.container.querySelector("[data-system-canvas]")).toHaveAttribute("data-system-lit","components.button frames.site-shell sections.band tokens.accent-color");
});
it("a cross-layer connection keeps the inspector open and supports the existing back stack",async()=>{
  setup();await userEvent.click(within(document.querySelector<HTMLElement>("[data-studio-panel=inspector]")!).getByRole("button",{name:"sections.band",exact:true}));
  await waitFor(()=>expect(document.querySelector("[data-studio-panel=inspector]")).toHaveAttribute("data-selected-leaf","sections.band"));
  await userEvent.click(screen.getByRole("button",{name:"Back",exact:true}));
  expect(document.querySelector("[data-studio-panel=inspector]")).toHaveAttribute("data-selected-leaf","components.button");
});
it("shows supplied history, fallback change copy, eight inspector parts and live section specimens only in the inspector",()=>{
  setup({writeHistory:()=>[{index:2,command:"designer-library inspect",contentHash:"recorded-hash",inputs:{mode:"check"}}]});
  expect(screen.getByText("designer-library inspect")).toBeInTheDocument();expect(screen.getByText("Ask the coding agent")).toBeInTheDocument();
  expect(document.querySelectorAll("[data-inspector-part]")).toHaveLength(8);
});
it("uses the supplied command in the single copy line and closes selection on Escape",async()=>{
  setup({changeCommandFor:id=>"designer-library inspect --leaf "+id});expect(screen.getByText("designer-library inspect --leaf components.button")).toBeInTheDocument();
  fireEvent.keyDown(document,{key:"Escape"});await waitFor(()=>expect(document.querySelector("[data-studio-panel=inspector]")).not.toHaveAttribute("data-selected-leaf"));
});
