import { act, createContext, StrictMode, useContext, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FrameModuleOutlet, FrameSlotProvider, FrameSlotOutlet, SlotModule, useFrameSlotModules } from "./FrameSlots.js";
afterEach(cleanup);
const Source = createContext("missing");
function Stateful() { const context = useContext(Source); const [count, setCount] = useState(0); return <button onClick={() => setCount(count + 1)}>{context}:{count}</button>; }
describe("frame slot leases", () => {
  it("keeps the module's original provider context and state through registry updates", async () => {
    function Fixture({ order = 0 }: { order?: number }) { return <FrameSlotProvider><FrameSlotOutlet slot="dock-strip" /><Source.Provider value="camera"><SlotModule id="zoom" slot="dock-strip" label="Zoom" order={order}><Stateful /></SlotModule></Source.Provider></FrameSlotProvider>; }
    const view = render(<StrictMode><Fixture /></StrictMode>);
    await userEvent.click(screen.getByRole("button", { name: "camera:0" }));
    view.rerender(<StrictMode><Fixture order={1} /></StrictMode>);
    expect(screen.getByRole("button", { name: "camera:1" })).toBeTruthy();
    expect(document.querySelectorAll('[data-frame-module="zoom"]')).toHaveLength(1);
  });
  it("orders leases deterministically and cleans up unmounted modules", () => {
    function Fixture({ show = true }: { show?: boolean }) { return <FrameSlotProvider><FrameSlotOutlet slot="dock-strip" />{show && <><SlotModule id="b" slot="dock-strip" label="B"><span>B</span></SlotModule><SlotModule id="a" slot="dock-strip" label="A"><span>A</span></SlotModule></>}</FrameSlotProvider>; }
    const view = render(<Fixture />);
    expect([...document.querySelectorAll("[data-frame-module]")].map(node => node.getAttribute("data-frame-module"))).toEqual(["a", "b"]);
    view.rerender(<Fixture show={false} />); expect(document.querySelectorAll("[data-frame-module]")).toHaveLength(0);
  });
  it("rejects conflicting ids and unsupported slots visibly", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => render(<FrameSlotProvider><SlotModule id="same" slot="dock-tab" label="A">A</SlotModule><SlotModule id="same" slot="dock-tab" label="B">B</SlotModule></FrameSlotProvider>)).toThrow("already leased");
      expect(() => render(<FrameSlotProvider><SlotModule id="bad" slot={"floating" as never} label="Bad">X</SlotModule></FrameSlotProvider>)).toThrow("invalid");
    } finally { log.mockRestore(); }
  });
  it("reports a missing provider during both client and server rendering", () => {
    function ReadModules() { useFrameSlotModules("dock-tab"); return null; }
    const examples = [<SlotModule id="zoom" slot="dock-strip" label="Zoom">Zoom</SlotModule>, <ReadModules />, <FrameModuleOutlet id="zoom" />];
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const example of examples) {
        expect(() => render(example)).toThrow("FrameSlotProvider");
        expect(() => renderToString(example)).toThrow("FrameSlotProvider");
      }
    } finally { log.mockRestore(); }
  });
  it("hydrates provider markup without recoverable errors, then leases into the outlet with source context", async () => {
    const tree = <FrameSlotProvider><FrameSlotOutlet slot="dock-strip" /><Source.Provider value="hydrated-camera"><SlotModule id="zoom" slot="dock-strip" label="Zoom"><Stateful /></SlotModule></Source.Provider></FrameSlotProvider>;
    const host = document.createElement("div"); host.innerHTML = renderToString(tree); document.body.append(host);
    expect(host.querySelector("button")).toBeNull();
    const recoverable = vi.fn(); let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => { root = hydrateRoot(host, tree, { onRecoverableError: recoverable }); });
      expect(recoverable).not.toHaveBeenCalled();
      expect(host.querySelector("button")).toHaveTextContent("hydrated-camera:0");
      await userEvent.click(host.querySelector("button")!);
      expect(host.querySelector("button")).toHaveTextContent("hydrated-camera:1");
    } finally { await act(async () => root?.unmount()); host.remove(); }
  });
});
