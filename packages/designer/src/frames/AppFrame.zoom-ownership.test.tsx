// @vitest-environment jsdom
import React, { useState } from "react";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppFrame as ShellFixtureAppFrame } from "./AppFrame.js";
import { CanvasSurface } from "../blocks/canvas/CanvasSurface.js";
import { SlotModule } from "../shell/FrameSlots.js";
import type { Viewport } from "../blocks/canvas/models.js";
import type { AppFrameProps } from "./app-frame-types.js";
import { withShellCopy } from "./__fixtures__/shell-copy.js";
const AppFrame = withShellCopy(ShellFixtureAppFrame, true);



beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, get: () => 1280 });
  vi.stubGlobal("React", React);
  vi.stubGlobal("matchMedia", vi.fn((media: string) => ({
    media, get matches() {
      if (media === "all") return true;
      const match = media.match(/^\(min-width: ([\d.]+)(px|rem)\)$/);
      return match ? 1280 >= Number(match[1]) * (match[2] === "rem" ? 16 : 1) : false;
    },
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
  })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function frame(children: React.ReactNode): AppFrameProps {
  return {
    brand: { markSrc: "/mark.svg", wordmark: "Atlas", label: "Atlas workspace" },
    navigation: { label: "Workspace navigation", activeId: "home", tree: [{ id: "home", label: "Home", href: "#home" }] },
    account: { actor: { name: "Example member" }, signedOutLabel: "Signed out", sections: [{ id: "account", entries: [{ kind: "link", id: "profile", label: "Profile", href: "#profile" }] }] },
    commands: { triggerLabel: "Find a command", heading: "Commands", searchLabel: "Search commands", closeLabel: "Close commands", emptyMessage: "No commands", groups: [] },
    rightPanel: { label: "Inspector", handleLabel: "Resize inspector", min: 200, max: 400, defaultValue: 300, children: <button>Panel action</button> },
    children,
  };
}
function Canvas({ initial }: { initial: number }) {
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: initial });
  return <>
    <CanvasSurface aria-label="Board canvas" viewport={viewport} onViewportChange={setViewport} selection={[]} onSelectionChange={() => {}}
      worldBounds={{ x: 0, y: 0, width: 800, height: 600 }} items={[]} itemInteraction="content" minZoom={.12} maxZoom={2} viewSize={{ width: 800, height: 600 }}>
      <button>Board action</button>
    </CanvasSurface>
    <output aria-label="Camera zoom">{viewport.zoom}</output>
    <SlotModule id="canvas-zoom" slot="dock-strip" label="Canvas zoom"><button>Dock zoom control</button></SlotModule>
  </>;
}
const cameraZoom = () => Number(screen.getByRole("status", { name: "Camera zoom" }).textContent);
function wheel(target: Element, deltaY: number, ctrlKey: boolean) {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 200, clientY: 150, deltaY, ctrlKey });
  act(() => { target.dispatchEvent(event); });
  return event.defaultPrevented;
}
/** Safari trackpad pinch: a cancelable start, scaled changes and an end, each with a pointer position. */
function gesture(target: Element, scale: number) {
  return (["gesturestart", "gesturechange", "gestureend"] as const).map((type, index) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { scale: { value: index === 0 ? 1 : scale }, clientX: { value: 200 }, clientY: { value: 150 } });
    act(() => { target.dispatchEvent(event); });
    return event.defaultPrevented;
  });
}
function targets() {
  const root = document.querySelector("[data-application-frame]")!;
  return {
    header: root.querySelector('[data-application-frame-region="header"]')!,
    navigation: root.querySelector('[data-application-frame-region="navigation"]')!,
    panel: screen.getByRole("button", { name: "Panel action", hidden: true }),
    dock: screen.getByRole("button", { name: "Dock zoom control" }),
    canvas: screen.getByRole("button", { name: "Board action" }),
  };
}
const routed = new Set(["dock", "canvas"]);

describe("AppFrame zoom gesture ownership", () => {
  it.each([[.12, -100, 1.5], [2, 100, .5]])("at zoom %s, prevents every pinch and ctrl+wheel and routes only canvas and dock chrome to the camera", (initial, deltaY, scale) => {
    render(<AppFrame {...frame(<Canvas initial={initial} />)} />);
    for (const [name, target] of Object.entries(targets())) {
      const before = cameraZoom();
      expect(wheel(target, deltaY, true), `${name} ctrl+wheel`).toBe(true);
      const afterWheel = cameraZoom();
      expect(afterWheel !== before, `${name} ctrl+wheel camera`).toBe(routed.has(name));
      expect(gesture(target, scale), `${name} gesture`).toEqual([true, true, true]);
      expect(cameraZoom() !== afterWheel, `${name} gesture camera`).toBe(routed.has(name));
      expect(cameraZoom()).toBeGreaterThanOrEqual(.12); expect(cameraZoom()).toBeLessThanOrEqual(2);
    }
  });
  it("leaves plain wheel scrolling to the header, navigation, right panel and dock", () => {
    render(<AppFrame {...frame(<Canvas initial={1} />)} />);
    for (const [name, target] of Object.entries(targets()).filter(([name]) => name !== "canvas")) expect(wheel(target, 40, false), `${name} plain wheel`).toBe(false);
    expect(cameraZoom()).toBe(1);
  });
});
