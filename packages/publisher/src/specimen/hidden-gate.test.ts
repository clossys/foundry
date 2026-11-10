import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { renderSpecimenPage, SPECIMEN_HIDDEN_GATE_SCRIPT } from "./render.js";

/** Runs the gate in a frame whose element has `rects` layout boxes (null: a top-level or cross-origin page). */
function gate(rects: number | null) {
  const calls: string[] = [];
  const listeners: Record<string, () => void> = {};
  const context = {
    innerWidth: 0,
    location: { reload: () => calls.push("reload") },
    addEventListener: (type: string, listener: () => void) => { listeners[type] = listener; },
    window: {} as Record<string, unknown>,
  };
  context.window = { frameElement: rects === null ? null : { getClientRects: () => ({ length: rects }) }, stop: () => calls.push("stop") };
  runInNewContext(SPECIMEN_HIDDEN_GATE_SCRIPT, context);
  return { calls, listeners, context };
}

describe("hidden-frame gate", () => {
  it("stops a load in a frame with no layout box and reloads once the frame is laid out", () => {
    const hidden = gate(0);
    expect(hidden.calls).toEqual(["stop"]);
    hidden.listeners.resize!();
    expect(hidden.calls).toEqual(["stop"]);
    hidden.context.innerWidth = 320;
    hidden.listeners.resize!();
    expect(hidden.calls).toEqual(["stop", "reload"]);
  });

  it("leaves a laid-out frame and a top-level or cross-origin page alone", () => {
    for (const rects of [1, null]) {
      const shown = gate(rects);
      expect(shown.calls).toEqual([]);
      expect(shown.listeners).toEqual({});
    }
  });

  it("runs after the health reporter and before the stylesheet and the bundle", () => {
    const html = renderSpecimenPage({
      query: { element: "sample" }, mode: "light", assetBase: "/__specimen/assets/", nonce: "n",
      record: { id: "sample", version: 1, kind: "visual", preview: {}, contentHash: "", payload: { path: "x.tsx", files: [] } } as never,
      build: { hash: "h", js: "x", css: "y", errors: [] } as never,
    });
    const at = (needle: string) => html.indexOf(needle);
    expect(at(SPECIMEN_HIDDEN_GATE_SCRIPT)).toBeGreaterThan(at("__clossysSpecimen"));
    expect(at(SPECIMEN_HIDDEN_GATE_SCRIPT)).toBeLessThan(at('href="/__specimen/assets/h.css"'));
    expect(at(SPECIMEN_HIDDEN_GATE_SCRIPT)).toBeLessThan(at('src="/__specimen/assets/h.js"'));
    expect(html).toContain(`<script nonce="n">${SPECIMEN_HIDDEN_GATE_SCRIPT}</script>`);
  });
});
