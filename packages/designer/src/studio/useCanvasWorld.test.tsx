import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useCanvasWorld } from "./useCanvasWorld.js";
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it("uses the actual stage ResizeObserver width rather than the viewport, and disposes observation",()=>{
  let width=1440;const notify: (()=>void)[]=[];const observe=vi.fn(),disconnect=vi.fn();
  vi.stubGlobal("ResizeObserver",class {constructor(callback:()=>void){notify.push(callback);}observe=observe;disconnect=disconnect;});
  vi.spyOn(HTMLElement.prototype,"clientWidth","get").mockImplementation(function(){return (this as HTMLElement).dataset.testid==="stage"?width:600;});
  vi.spyOn(HTMLElement.prototype,"clientHeight","get").mockReturnValue(600);
  const remove=vi.spyOn(window,"removeEventListener");
  const oldWidth=window.innerWidth;Object.defineProperty(window,"innerWidth",{value:390,configurable:true});
  function Probe(){const canvas=useCanvasWorld("tokens");return <><div data-testid="stage" ref={canvas.onSurfaceElement}><div ref={canvas.onWorldElement}/></div><output>{canvas.overlayLayout}</output></>;}
  const result=render(<Probe/>);
  expect(screen.getByRole("status")).toHaveTextContent("wide");
  width=900;act(()=>notify.forEach(fn=>fn()));expect(screen.getByRole("status")).toHaveTextContent("compact");
  width=640;act(()=>notify.forEach(fn=>fn()));expect(screen.getByRole("status")).toHaveTextContent("narrow");
  width=1200;act(()=>notify.forEach(fn=>fn()));expect(screen.getByRole("status")).toHaveTextContent("wide");
  Object.defineProperty(window,"innerWidth",{value:1440,configurable:true});width=390;
  act(()=>window.dispatchEvent(new Event("resize")));expect(screen.getByRole("status")).toHaveTextContent("narrow");
  result.unmount();expect(observe).toHaveBeenCalledTimes(2);expect(disconnect).toHaveBeenCalledOnce();expect(remove).toHaveBeenCalledWith("resize",expect.any(Function));
  Object.defineProperty(window,"innerWidth",{value:oldWidth,configurable:true});
});
