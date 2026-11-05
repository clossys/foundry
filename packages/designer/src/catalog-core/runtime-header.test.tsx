/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { createContext, useContext, useState, type ReactElement } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppFrame } from "../frames/AppFrame.js";
import { PageHeaderModule } from "../shell/FrameSlots.js";
import { standardM1FixtureEngine, standardM1Runtime } from "./__fixtures__/standard-m1-runtime.js";
import { prepareRuntimeAssembly } from "./runtime-assembly.js";
import { runtimeHash } from "./runtime-ports.js";
import type { RuntimeFlowAssemblyInput } from "./runtime-assembly.js";
import type { RuntimePageHeaderModule } from "./runtime-ports.js";
const Source = createContext("missing"), callbacks = new Set<() => void>(); let available = 1440;
beforeEach(() => {
  available = 1440; localStorage.clear();
  vi.stubGlobal("matchMedia", (media: string) => ({ media, matches: media.includes("min-width") || media === "all", addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
  vi.stubGlobal("ResizeObserver", class { callback: () => void; constructor(callback: ResizeObserverCallback) { this.callback = () => callback([], this as unknown as ResizeObserver); callbacks.add(this.callback); } observe() {} unobserve() {} disconnect() { callbacks.delete(this.callback); } });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function(this: HTMLElement) { return this.hasAttribute("data-frame-header-overflow") ? available : 0; });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function(this: HTMLElement) { if (this.tagName === "NAV") return 400; if (this.tagName === "H1") return 100; if (this.hasAttribute("data-frame-header-actions")) return this.querySelector('[data-compact="true"]') ? 44 : 200; return 0; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); callbacks.clear(); });
function Action({ compact }: { compact: boolean }) { const owner = useContext(Source), [n, set] = useState(0); return <button data-compact={compact} onClick={() => set(n + 1)}>{owner}:{String(compact)}:{n}</button>; }
/** SYNTHETIC runtime metadata; actual public AppFrame/PageHeaderModule are mounted below.
 * This exercises the bounded port, not real consumer selected-surface qualification. */
function fixture(onNavigate = vi.fn()): RuntimeFlowAssemblyInput<ReactElement> {
  const source = { entry: "SYNTHETIC.tsx", files: { "SYNTHETIC.tsx": "// SYNTHETIC source identity, not an actual consumer artifact" }, dependencies: {} };
  const input = standardM1Runtime({ engine: standardM1FixtureEngine(), identity: { kind: "artifact", name: "SYNTHETIC header port", sha256: runtimeHash(source) }, source, css: [{ id: "SYNTHETIC.css", contents: "/* synthetic */" }] });
  const module: RuntimePageHeaderModule = { package: "@clossys/designer/shell", export: "PageHeaderModule", renderer: { id: "SYNTHETIC header module source", source, sourceHash: runtimeHash(source) } };
  const frame = { ...input.ports.manifest.fills[0]!, leaf: "frames.app-shell" as const, slots: ["skip-link", "main"], headerModule: module };
  input.ports = { ...input.ports, manifest: { ...input.ports.manifest, fills: [frame, ...input.ports.manifest.fills.slice(1)] }, renderers: { ...input.ports.renderers, [frame.renderer.id]: current => {
    const header = current.pageHeader!;
    return <AppFrame brand={{ markSrc: "/mark.svg", wordmark: "Example", label: "Example workspace", ...header.brand }} navigation={{ tree: [], activeId: "", label: "Workspace" }} account={{ signedOutLabel: "Signed out", sections: [] }} commands={{ heading: "Commands", searchLabel: "Search commands", closeLabel: "Close", emptyMessage: "Empty", triggerLabel: "Commands", groups: [] }} onNavigate={onNavigate}>
      <PageHeaderModule id={header.id} header={{ ...header.data, ...(header.actions ? { actions: { render: header.actions.render } } : {}) }} />{current.slots.main}
    </AppFrame>;
  } } };
  input.binding = { ...input.binding, frame: { ...input.binding.frame, leaf: frame.leaf, content: { "skip-link": input.binding.frame.content["skip-link"]! } }, sections: { body: [input.binding.sections.body![1]!] } };
  input.pageHeader = { brand: { href: "/tools/home", label: "Example workspace" }, id: "example.route", data: { title: "Tools", nav: { label: "Views", activeId: "first", items: [{ id: "first", label: "First", href: "#first" }, { id: "second", label: "Second", href: "#second" }] } }, module, actions: { renderer: { id: "SYNTHETIC actions", source, sourceHash: runtimeHash(source) }, state: { revision: 1 }, render: ({ compact }) => <Action compact={compact} /> } };
  return input;
}
describe("bounded selected Frame header port", () => {
  it("mounts one real lease inside the actual Frame, preserving owner context, compact state and native navigation", async () => {
    const navigate = vi.fn(), input = fixture(navigate), result = prepareRuntimeAssembly(input); expect(result.status, JSON.stringify(result)).toBe("ready"); if (result.status !== "ready") return;
    render(<Source.Provider value="owner">{result.assembly.render(result.assembly.snapshot.cells[0]!)}</Source.Provider>);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1); expect(screen.getByRole("heading", { name: "Tools" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "owner:false:0" }));
    act(() => { available = 660; for (const callback of callbacks) callback(); });
    expect(screen.getByRole("button", { name: "owner:true:1" })).toBeTruthy();
    act(() => { available = 1440; for (const callback of callbacks) callback(); });
    await userEvent.click(screen.getByRole("link", { name: "Second" })); await waitFor(() => expect(navigate).toHaveBeenCalledWith("#second"));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });
  it.each(["data", "module", "state", "actions", "brand"] as const)("binds fresh %s into the exact immutable snapshot", field => {
    const input = fixture(), first = prepareRuntimeAssembly(input); expect(first.status).toBe("ready"); if (first.status !== "ready") return;
    {
      const next = fixture();
      if (field === "brand") next.pageHeader = { ...next.pageHeader!, brand: { href: "/changed-home", label: "Example workspace" } };
      if (field === "data") next.pageHeader = { ...next.pageHeader!, data: { ...next.pageHeader!.data, title: "Changed" } };
      if (field === "state") next.pageHeader = { ...next.pageHeader!, actions: { ...next.pageHeader!.actions!, state: { revision: 2 } } };
      if (field === "actions") next.pageHeader = { ...next.pageHeader!, actions: { ...next.pageHeader!.actions!, renderer: { ...next.pageHeader!.actions!.renderer, id: "new exact action source" } } };
      if (field === "module") { const module = { ...next.pageHeader!.module, renderer: { ...next.pageHeader!.module.renderer, id: "new exact module source" } }; next.pageHeader = { ...next.pageHeader!, module }; next.ports = { ...next.ports, manifest: { ...next.ports.manifest, fills: next.ports.manifest.fills.map(f => f.kind === "frame" ? { ...f, headerModule: module } : f) } }; }
      const result = prepareRuntimeAssembly(next); expect(result.status, field).toBe("ready"); if (result.status === "ready") expect(result.assembly.snapshot.hash, field).not.toBe(first.assembly.snapshot.hash);
    }
  });
  it("refuses replacement/raw header fields, stale module identity and section header ports; missing support remains pending", () => {
    const input = fixture();
    expect(prepareRuntimeAssembly({ ...input, pageHeader: { ...input.pageHeader!, brand: { href: "/home", label: "Example workspace", raw: "escape" } as never } }).status).toBe("refused");
    expect(prepareRuntimeAssembly({ ...input, pageHeader: { ...input.pageHeader!, replacement: "raw" } as never }).status).toBe("refused");
    expect(prepareRuntimeAssembly({ ...input, pageHeader: { ...input.pageHeader!, module: { ...input.pageHeader!.module, export: "Fake" } as never } }).status).toBe("refused");
    expect(prepareRuntimeAssembly({ ...input, pageHeader: { ...input.pageHeader!, module: { ...input.pageHeader!.module, renderer: { ...input.pageHeader!.module.renderer, id: "stale" } } } }).status).toBe("refused");
    expect(prepareRuntimeAssembly({ ...input, binding: { ...input.binding, frame: { ...input.binding.frame, content: { ...input.binding.frame.content, header: { kind: "region", ref: "standard-m1.header" } } } } }).status).toBe("refused");
    const missing = fixture(); missing.ports = { ...missing.ports, manifest: { ...missing.ports.manifest, fills: missing.ports.manifest.fills.map(f => { const { headerModule, ...fill } = f; return fill; }) } }; expect(prepareRuntimeAssembly(missing).status).toBe("pending");
    const section = fixture(); section.ports = { ...section.ports, manifest: { ...section.ports.manifest, fills: section.ports.manifest.fills.map(f => ({ ...f, headerModule: input.pageHeader!.module })) } }; expect(prepareRuntimeAssembly(section).status).toBe("refused");
  });
});
