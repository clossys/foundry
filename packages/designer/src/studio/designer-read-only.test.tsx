import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render, studioReady, chooseLayer } from "./__fixtures__/frame.js";
import { Studio } from "./Studio.js";
import { StudioProvider } from "./StudioProvider.js";
import { WholeStudioProvider } from "./WholeStudioProvider.js";
import { emptyLibrary, labels, smallCatalog } from "./__fixtures__/studio.js";
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
 const save=vi.fn();render(<StudioProvider catalog={smallCatalog} adapter={{load:async()=>({library:emptyLibrary()}),save}} labels={copy}><Studio/></StudioProvider>);
 await studioReady();noWrites();await controls();noWrites();expect(save).not.toHaveBeenCalled();
},120_000);
function composite(){const input=componentIntegration(),save=vi.fn();return{save,adapter:{kind:"composite" as const,catalog:{...input.catalog,values:smallCatalog},load:async()=>({library:{...input.library,values:{fills:[]}},componentOptions:input.componentOptions}),save}};}
it("all five layers share the one read-only page; no remaining control reaches adapter.save",async()=>{
 const {adapter,save}=composite();render(<WholeStudioProvider adapter={adapter} labels={{...copy,whole:{signoff:"Membership",proposed:"Proposed",contract:"Contract",contentSlots:"Slots",configurations:"Configurations",unresolved:"Unresolved",unassessed:"Unassessed"}}}><Studio/></WholeStudioProvider>);
 await studioReady();for(const layer of ["Frames","Sections","Components","Assets","Tokens"]){await chooseLayer(labels,layer,userEvent.setup());noWrites();}
 await controls();expect(save).not.toHaveBeenCalled();
},180_000);
it.each(["components.button","tokens.surface-color"])("the %s inspector exposes facts and copy, never an editor",async leaf=>{
 const {adapter,save}=composite();window.history.replaceState(null,"","?node="+leaf);
 render(<WholeStudioProvider adapter={adapter} labels={{...copy,whole:{signoff:"Membership",proposed:"Proposed",contract:"Contract",contentSlots:"Slots",configurations:"Configurations",unresolved:"Unresolved",unassessed:"Unassessed"}}}><Studio/></WholeStudioProvider>);
 await studioReady();const inspector=await waitFor(()=>{const panel=document.querySelector<HTMLElement>("[data-studio-panel=inspector]");expect(panel).toHaveAttribute("data-selected-leaf",leaf);return panel!;});
 expect(within(inspector).getByText(copy.howToChange)).toBeInTheDocument();
 for(const control of inspector.querySelectorAll('input,textarea,select,[role=radio],[role=combobox],[role=slider]')) {
   expect(control.closest("[data-studio-usage]")).not.toBeNull();
   expect(control).toHaveAttribute("role","switch");
 }
 noWrites();expect(save).not.toHaveBeenCalled();
},60_000);
