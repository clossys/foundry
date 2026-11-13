import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render, studioReady, chooseLayer } from "./__fixtures__/frame.js";
import { Studio } from "./Studio.js";
import { StudioProvider } from "./StudioProvider.js";
import { WholeStudioProvider } from "./WholeStudioProvider.js";
import { emptyLibrary, labels, smallCatalog } from "./__fixtures__/studio.js";
import { studioTestCopy } from "./__fixtures__/copy.js";
import { componentIntegration } from "../catalog-core/__fixtures__/component-integration.js";
const copy={...labels,howToChange:"Ask the coding agent"};
afterEach(()=>{cleanup();localStorage.clear();window.history.replaceState(null,"","/");});
function noWrites(){
 for(const name of ["Change selection","Done","Choose","Generate starter",labels.resetToDefault,...Object.values(labels.autosave!)])expect(screen.queryAllByRole("button",{name,hidden:true})).toEqual([]);
 expect(document.querySelector('[data-board-mode="edit"], [data-studio-save-status], [data-studio-generate-starter]')).toBeNull();
}
async function controls(){
 for(const button of [...document.querySelectorAll<HTMLButtonElement>("[data-designer-page] button")])if(button.isConnected&&!button.disabled){fireEvent.click(button);fireEvent.keyDown(button,{key:"Enter"});fireEvent.blur(button);fireEvent.keyDown(document,{key:"Escape"});}
 for(const key of ["z","Z"])fireEvent.keyDown(document,{key,ctrlKey:true,metaKey:true});
}
it("value layers remain read-only while their real navigation and view controls are driven",async()=>{
 const save=vi.fn();render(<StudioProvider catalog={smallCatalog} adapter={{load:async()=>({library:emptyLibrary()}),save}} labels={copy}><Studio copy={studioTestCopy}/></StudioProvider>);
 await studioReady();noWrites();await controls();noWrites();expect(save).not.toHaveBeenCalled();
},120_000);
function composite(){const input=componentIntegration(),save=vi.fn();return{save,adapter:{kind:"composite" as const,catalog:{...input.catalog,values:smallCatalog},load:async()=>({library:{...input.library,values:{fills:[]}},componentOptions:input.componentOptions}),save}};}
it("all five layers share the one read-only page; no remaining control reaches adapter.save",async()=>{
 const {adapter,save}=composite();render(<WholeStudioProvider adapter={adapter} labels={{...copy,whole:{signoff:"Membership",proposed:"Proposed",contract:"Contract",contentSlots:"Slots",configurations:"Configurations",unresolved:"Unresolved",unassessed:"Unassessed"}}}><Studio copy={studioTestCopy}/></WholeStudioProvider>);
 await studioReady();for(const layer of ["Frames","Sections","Components","Assets","Themes"]){await chooseLayer(labels,layer,userEvent.setup());noWrites();}
 await controls();expect(save).not.toHaveBeenCalled();
},180_000);
it.each(["components.button","themes.background"])("?node=%s is a camera target with no inspector and no editor",async leaf=>{
 const {adapter,save}=composite();window.history.replaceState(null,"","?node="+leaf);
 render(<WholeStudioProvider adapter={adapter} labels={{...copy,whole:{signoff:"Membership",proposed:"Proposed",contract:"Contract",contentSlots:"Slots",configurations:"Configurations",unresolved:"Unresolved",unassessed:"Unassessed"}}}><Studio copy={studioTestCopy}/></WholeStudioProvider>);
 await studioReady();
 await waitFor(()=>expect(new URLSearchParams(window.location.search).get("node")).toBe(leaf));
 const page=document.querySelector<HTMLElement>("[data-designer-page]")!;
 expect(page.querySelector('[data-studio-panel=inspector], [data-studio-rail-card=inspector], [data-selected-leaf], [data-system-cell][data-selected]')).toBeNull();
 expect(within(page).queryByText(copy.howToChange)).toBeNull();
 // The only form controls left are views: the zoom slider and the explorer's layer select (its hidden native select).
 for(const control of page.querySelectorAll('input,textarea,select,[role=radio],[role=combobox]'))
   expect(control.matches('input[type=range]')||control.matches('select')&&control.closest('[data-studio-rail-card=explorer]')!==null).toBe(true);
 noWrites();expect(save).not.toHaveBeenCalled();
},60_000);
